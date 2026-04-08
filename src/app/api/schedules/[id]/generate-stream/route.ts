import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import { plannerJsonErrors } from "@/lib/api/validation";
import { validateScheduleAssignments } from "@/lib/api/planningScheduleValidation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { formatRuleViolations } from "@/lib/schedule/formatRuleViolations";
import type { AssignmentInput } from "@/lib/planning/types";
import type { ManualPlacementInput } from "@/lib/schedule/generateDraftSchedule";
import { loadGenerateContext } from "@/lib/schedule/generateDraftSchedule";
import {
  buildSolverPayload,
  assignmentsToPrismaInputs,
  callScorer,
  type SolverPayload,
} from "@/lib/schedule/solverClient";

type RouteCtx = { params: Promise<{ id: string }> };

const VALID_SHIFT_TYPES = new Set(["EARLY", "LATE", "NIGHT", "BL"]);

const SOLVER_URL = process.env.SOLVER_URL ?? "http://solver:8000";

function parseManualPlacements(raw: unknown): ManualPlacementInput[] {
  if (!Array.isArray(raw)) return [];
  const out: ManualPlacementInput[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof item.employeeId === "string" &&
      typeof item.date === "string" &&
      typeof item.shiftType === "string" &&
      VALID_SHIFT_TYPES.has(item.shiftType) &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.date)
    ) {
      const sn =
        typeof item.stationNumber === "number" &&
        item.stationNumber >= 1 &&
        item.stationNumber <= 3
          ? item.stationNumber
          : undefined;
      out.push({
        employeeId: item.employeeId,
        date: item.date,
        stationNumber: sn,
        shiftProfileId:
          typeof item.shiftProfileId === "string"
            ? item.shiftProfileId
            : undefined,
        shiftType: item.shiftType,
      });
    }
  }
  return out;
}

type BlockedDateInput = { employeeId: string; date: string };

function parseBlockedDates(raw: unknown): BlockedDateInput[] {
  if (!Array.isArray(raw)) return [];
  const out: BlockedDateInput[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof item.employeeId === "string" &&
      typeof item.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.date)
    ) {
      out.push({ employeeId: item.employeeId, date: item.date });
    }
  }
  return out;
}

type AbsenceInput = { employeeId: string; type: "KRANK" | "URLAUB"; startDate: string; endDate: string };

function parseAbsences(raw: unknown): AbsenceInput[] {
  if (!Array.isArray(raw)) return [];
  const out: AbsenceInput[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof item.employeeId === "string" &&
      typeof item.type === "string" &&
      (item.type === "KRANK" || item.type === "URLAUB") &&
      typeof item.startDate === "string" &&
      typeof item.endDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.startDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.endDate)
    ) {
      out.push({
        employeeId: item.employeeId,
        type: item.type,
        startDate: item.startDate,
        endDate: item.endDate,
      });
    }
  }
  return out;
}

/** Helper to resolve manual placement profile ID. */
function resolveManualPlacementProfile(
  mp: ManualPlacementInput,
  profiles: { id: string; shiftType: string; isActive: boolean }[],
): string | null {
  if (mp.shiftProfileId) {
    const exact = profiles.find(
      (p) => p.id === mp.shiftProfileId && p.isActive,
    );
    if (exact) return exact.id;
  }
  const match = profiles.find(
    (p) => p.shiftType === mp.shiftType && p.isActive,
  );
  return match?.id ?? null;
}

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id: scheduleId } = await context.params;
  const facilityId = session!.user.facilityId;
  const userId = session!.user.id;

  const body = await request.json().catch(() => ({}));
  const manualPlacements = parseManualPlacements(body?.manualPlacements);
  const blockedDates = parseBlockedDates(body?.blockedDates);
  const clientAbsences = parseAbsences(body?.absences);
  const clientMaxSolveTime = typeof body?.maxSolveTimeSeconds === "number"
    ? Math.max(30, Math.min(3600, body.maxSolveTimeSeconds))
    : null;

  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, facilityId },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const genCtx = await loadGenerateContext(
    prisma,
    facilityId,
    schedule.periodStart,
    schedule.periodEnd,
  );

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: {
      minRestHours: true,
      miniJobMaxMonthlyHours: true,
      maxSolveTimeSeconds: true,
      ruleOverridesJson: true,
    },
  });

  // Load previous month's last 7 days for cross-month boundary checks
  const BOUNDARY_DAYS = 7;
  let previousAssignments: { employeeId: string; date: string; shiftProfileId: string }[] = [];
  try {
    const prevSchedule = await prisma.schedule.findFirst({
      where: { facilityId, periodEnd: { lt: schedule.periodStart } },
      orderBy: { periodEnd: "desc" },
    });
    console.log("[generate-stream] prevSchedule:", prevSchedule?.id ?? "NONE");
    if (prevSchedule) {
      const cutoff = new Date(schedule.periodStart);
      cutoff.setUTCDate(cutoff.getUTCDate() - BOUNDARY_DAYS);
      const prevRows = await prisma.assignment.findMany({
        where: { scheduleId: prevSchedule.id, date: { gte: cutoff, lt: schedule.periodStart }, dayStatus: null },
      });
      console.log("[generate-stream] boundary assignments loaded:", prevRows.length);
      for (const a of prevRows) {
        previousAssignments.push({
          employeeId: a.employeeId,
          date: toIsoDateOnly(a.date),
          shiftProfileId: a.shiftProfileId,
        });
      }
    }
  } catch (boundaryErr) {
    console.error("[generate-stream] ERROR loading boundary assignments:", boundaryErr);
    previousAssignments = [];
  }

  console.log("[generate-stream] Building solver payload...");
  const payload = buildSolverPayload(
    scheduleId,
    schedule.periodStart,
    schedule.periodEnd,
    genCtx,
    facility,
    manualPlacements,
    blockedDates,
    clientAbsences,
    previousAssignments,
  );

  // Allow client to override solve time limit per generation
  if (clientMaxSolveTime != null) {
    payload.maxSolveTimeSeconds = clientMaxSolveTime;
  }

  // NOTE: Absences are NOT persisted to EmployeeAbsence table.
  // They are passed as blockedDates to the solver and stored as K/U
  // assignment records. "Leeren" clears assignments, giving a clean slate.

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseEvent(data)));
      };

      try {
        send({
          type: "progress",
          stage: "loading",
          label: "Lade Mitarbeiterdaten...",
          pct: 3,
        });

        // Call solver streaming endpoint
        // Timeout = configured solve time + 60s buffer for model build + result extraction
        const solverTimeoutMs = ((payload.maxSolveTimeSeconds ?? 120) + 60) * 1000;
        console.log(`[generate-stream] Calling solver at ${SOLVER_URL}/solve-stream, timeout=${solverTimeoutMs}ms, previousAssignments=${payload.previousAssignments?.length ?? 0}`);
        const solverResp = await fetch(`${SOLVER_URL}/solve-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(solverTimeoutMs),
        });
        console.log(`[generate-stream] Solver response status: ${solverResp.status}, hasBody: ${!!solverResp.body}`);

        if (!solverResp.ok || !solverResp.body) {
          const errBody = await solverResp.text().catch(() => "");
          console.error(`[generate-stream] Solver error: ${solverResp.status} — ${errBody.slice(0, 500)}`);
          send({
            type: "error",
            error: `Solver returned ${solverResp.status}: ${errBody.slice(0, 200)}`,
          });
          controller.close();
          return;
        }

        // Read NDJSON from solver and forward as SSE
        const reader = solverResp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let solverResult: Record<string, unknown> | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const event = JSON.parse(trimmed);
              if (event.type === "result") {
                solverResult = event.data;
                send({
                  type: "progress",
                  stage: "saving",
                  label: "Speichere Ergebnisse...",
                  pct: 90,
                });
              } else {
                send(event);
              }
            } catch {
              // skip malformed lines
            }
          }
        }
        // process any remaining buffer
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer.trim());
            if (event.type === "result") {
              solverResult = event.data;
            } else {
              send(event);
            }
          } catch {
            // skip
          }
        }

        if (!solverResult) {
          console.error("[generate-stream] No solver result received from stream");
          send({ type: "error", error: "Solver lieferte kein Ergebnis." });
          controller.close();
          return;
        }

        const solverStatus = solverResult.status as string;
        const solverAssignments =
          (solverResult.assignments as {
            employeeId: string;
            date: string;
            shiftProfileId: string;
            stationNumber: number | null;
          }[]) ?? [];
        console.log(`[generate-stream] Solver status: ${solverStatus}, assignments: ${solverAssignments.length}, reason: ${solverResult.reason ?? "none"}`);

        // Build debug log
        const debugLog = buildDebugLog(solverResult, payload);

        if (
          solverStatus === "INFEASIBLE" ||
          solverStatus === "UNKNOWN"
        ) {
          console.log(`[generate-stream] Solver returned ${solverStatus}, reason: ${solverResult.reason ?? "none"}, conflicts: ${JSON.stringify(solverResult.conflictingConstraints ?? [])}`);

          // Save log even on failure (schedule may have been deleted mid-run)
          try {
            await prisma.schedule.update({
              where: { id: scheduleId },
              data: { generationLog: debugLog },
            });
          } catch (e) {
            if (
              e instanceof Prisma.PrismaClientKnownRequestError &&
              e.code === "P2025"
            ) {
              send({
                type: "error",
                error:
                  "Der Dienstplan wurde inzwischen gelöscht oder ist nicht mehr verfügbar.",
              });
              controller.close();
              return;
            }
            throw e;
          }

          send({
            type: "complete",
            result: {
              createdAssignments: 0,
              manualPlacementsApplied: 0,
              unmetStaffing: [],
              unfulfilledWishes: [],
              warnings: [
                `CP-SAT: Keine zulässige Lösung gefunden. ${(solverResult.reason as string) ?? ""}`,
              ],
            },
          });
          controller.close();
          return;
        }

        // Save assignments to DB
        const prismaInputs = assignmentsToPrismaInputs(
          solverAssignments,
          scheduleId,
          userId,
        );

        // Build K/U absence assignment records (show as K/U in plan, count toward Ist hours)
        const absenceInputs: Prisma.AssignmentCreateManyInput[] = [];
        if (clientAbsences.length > 0) {
          // Need a placeholder shiftProfileId (required field) — use the first active profile
          const fallbackProfileId = genCtx.profiles.find((p) => p.isActive)?.id;
          if (fallbackProfileId) {
            for (const abs of clientAbsences) {
              const statusCode = abs.type === "KRANK" ? "K" : "U";
              const [sy, sm, sd] = abs.startDate.split("-").map(Number);
              const [ey, em, ed] = abs.endDate.split("-").map(Number);
              let t = Date.UTC(sy!, sm! - 1, sd!);
              const end = Date.UTC(ey!, em! - 1, ed!);
              while (t <= end) {
                const dt = new Date(t);
                absenceInputs.push({
                  scheduleId,
                  date: dt,
                  shiftProfileId: fallbackProfileId,
                  employeeId: abs.employeeId,
                  createdByUserId: userId,
                  dayStatus: statusCode,
                  stationNumber: null,
                  markingRow2: null,
                  markingRow3: null,
                });
                t += 24 * 60 * 60 * 1000;
              }
            }
          }
        }

        const allInputs = [...prismaInputs, ...absenceInputs];

        await prisma.$transaction(
          async (tx) => {
            await tx.assignment.deleteMany({ where: { scheduleId } });
            if (allInputs.length > 0) {
              await tx.assignment.createMany({ data: allInputs });
            }
          },
          { maxWait: 20_000, timeout: 300_000 },
        );

        send({
          type: "progress",
          stage: "validating",
          label: "Validiere Regeln...",
          pct: 94,
        });

        // Validate
        const rows = await prisma.assignment.findMany({
          where: { scheduleId },
          orderBy: [{ date: "asc" }, { id: "asc" }],
        });

        const assignmentInputs: AssignmentInput[] = rows.map((a) => ({
          id: a.id,
          date: a.date,
          shiftProfileId: a.shiftProfileId,
          employeeId: a.employeeId,
        }));

        let ruleWarnings: string[] = [];
        const v = await validateScheduleAssignments(
          prisma,
          facilityId,
          {
            periodStart: schedule.periodStart,
            periodEnd: schedule.periodEnd,
          },
          assignmentInputs,
        );
        if (v.ok) {
          const allMessages = [...v.result.errors, ...v.result.warnings];
          if (allMessages.length > 0) {
            const emps = await prisma.employee.findMany({
              where: { facilityId },
              select: { id: true, firstName: true, lastName: true },
            });
            const empNames = new Map(
              emps.map((e) => [e.id, `${e.firstName} ${e.lastName}`]),
            );
            ruleWarnings = formatRuleViolations(allMessages, empNames);
          }
        }

        send({
          type: "progress",
          stage: "scoring",
          label: "Erstelle Qualitätsbericht...",
          pct: 96,
        });

        // Score report
        let scoreReport: string | null = null;
        try {
          const allEmps = await prisma.employee.findMany({
            where: { facilityId },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              status: true,
              contractType: true,
              isFullTimeBl: true,
              targetHoursPercent: true,
              targetHours: true,
              targetHoursPeriod: true,
            },
          });
          const employeeNames: Record<string, string> = {};
          for (const e of allEmps) {
            employeeNames[e.id] = `${e.firstName} ${e.lastName}`;
          }
          const profileNames: Record<string, string> = {};
          const profileShiftTypes: Record<string, string> = {};
          for (const p of genCtx.profiles) {
            profileNames[p.id] = p.name;
            profileShiftTypes[p.id] = p.shiftType;
          }
          const staffingRequirements = [
            ...genCtx.mergedStaffing.entries(),
          ].map(([key, entry]) => ({ key, ...entry }));
          const currentAssignments = rows
            .filter((a) => !a.dayStatus) // Exclude absence markers from scoring
            .map((a) => ({
              employeeId: a.employeeId,
              date: toIsoDateOnly(a.date),
              shiftProfileId: a.shiftProfileId,
              shiftType: profileShiftTypes[a.shiftProfileId] ?? "?",
              stationNumber: a.stationNumber,
            }));
          const debugJson = {
            schedule: {
              id: schedule.id,
              periodStart: toIsoDateOnly(schedule.periodStart),
              periodEnd: toIsoDateOnly(schedule.periodEnd),
            },
            employeeNames,
            profileNames,
            staffingRequirements,
            currentAssignments,
            solverPayload: payload as unknown as Record<string, unknown>,
          };
          scoreReport = await callScorer(debugJson);
        } catch {
          // Non-critical
        }

        // Count manual placements applied
        const mpApplied = manualPlacements.filter((mp) => {
          const pid = resolveManualPlacementProfile(mp, genCtx.profiles);
          return solverAssignments.some(
            (a) =>
              a.employeeId === mp.employeeId &&
              a.date === mp.date &&
              a.shiftProfileId === pid,
          );
        }).length;

        const allWarnings = [...ruleWarnings];

        // Preserve savedEntries from existing preGenWishesJson
        const existingWishesRaw = schedule.preGenWishesJson;
        let existingSavedEntries: unknown[] | undefined;
        if (existingWishesRaw) {
          try {
            const parsed = JSON.parse(existingWishesRaw);
            if (Array.isArray(parsed?.savedEntries)) existingSavedEntries = parsed.savedEntries;
          } catch { /* ignore */ }
        }
        const preGenWishes: Record<string, unknown> = {
          shiftWishes: manualPlacements.map((mp) => ({
            employeeId: mp.employeeId,
            date: mp.date,
          })),
          freiDates: blockedDates.map((bd) => ({
            employeeId: bd.employeeId,
            date: bd.date,
          })),
        };
        if (existingSavedEntries?.length) preGenWishes.savedEntries = existingSavedEntries;

        try {
          await prisma.schedule.update({
            where: { id: scheduleId },
            data: {
              warningsJson:
                allWarnings.length > 0
                  ? JSON.stringify(allWarnings)
                  : null,
              generationLog: debugLog || null,
              scoreReport: scoreReport || null,
              preGenWishesJson:
                (preGenWishes.shiftWishes as unknown[]).length > 0 ||
                (preGenWishes.freiDates as unknown[]).length > 0 ||
                (existingSavedEntries?.length ?? 0) > 0
                  ? JSON.stringify(preGenWishes)
                  : null,
            },
          });
        } catch (e) {
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === "P2025"
          ) {
            send({
              type: "error",
              error:
                "Der Dienstplan wurde inzwischen gelöscht oder ist nicht mehr verfügbar.",
            });
            controller.close();
            return;
          }
          throw e;
        }

        send({
          type: "complete",
          result: {
            createdAssignments: solverAssignments.length,
            manualPlacementsApplied: mpApplied,
            unmetStaffing: [],
            unfulfilledWishes:
              (solverResult.unfulfilledWishes as string[]) ?? [],
            warnings: allWarnings,
          },
        });
      } catch (e) {
        console.error("generate-stream error", e);
        send({
          type: "error",
          error:
            e instanceof Error ? e.message : "Generierung fehlgeschlagen.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/** Build a simple debug log string from the solver result. */
function buildDebugLog(
  response: Record<string, unknown>,
  payload: SolverPayload,
): string {
  const profMap = new Map(
    payload.shiftProfiles.map((p) => [p.id, p]),
  );
  const assignments = (response.assignments ?? []) as {
    employeeId: string;
    date: string;
    shiftProfileId: string;
    stationNumber: number | null;
  }[];

  const lines: string[] = [
    `=== CP-SAT Solver Run ===`,
    `Status: ${response.status}`,
    `Solve time: ${((response.solveTimeMs as number) ?? 0).toFixed(1)}ms`,
    `Objective: ${response.objectiveValue ?? "N/A"}`,
    `Employees: ${payload.employees.length}`,
    `Shift profiles: ${payload.shiftProfiles.length}`,
    `Manual placements: ${payload.manualPlacements.length}`,
    `Assignments created: ${assignments.length}`,
  ];

  if (payload.manualPlacements.length > 0) {
    lines.push(`--- Manual placement details ---`);
    for (const mp of payload.manualPlacements) {
      const prof = profMap.get(mp.shiftProfileId);
      const profName = prof?.name ?? "?";
      const matched = assignments.find(
        (a) => a.employeeId === mp.employeeId && a.date === mp.date,
      );
      if (matched) {
        const mProf = profMap.get(matched.shiftProfileId);
        const mName = mProf?.name ?? "?";
        const shiftOk = matched.shiftProfileId === mp.shiftProfileId;
        const stationOk =
          mp.stationNumber == null ||
          matched.stationNumber === mp.stationNumber;
        lines.push(
          `  ${mp.employeeId.slice(0, 8)} ${mp.date}: wanted ${profName} station=${mp.stationNumber ?? "egal"} → got ${mName} station=${matched.stationNumber ?? "?"} ${shiftOk && stationOk ? "OK" : "MISMATCH!"}`,
        );
      } else {
        lines.push(
          `  ${mp.employeeId.slice(0, 8)} ${mp.date}: wanted ${profName} station=${mp.stationNumber ?? "egal"} → NOT FOUND!`,
        );
      }
    }
  }

  return lines.join("\n");
}
