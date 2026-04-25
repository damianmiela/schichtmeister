import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import { plannerJsonErrors } from "@/lib/api/validation";
import { validateScheduleAssignments } from "@/lib/api/planningScheduleValidation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { formatRuleViolations } from "@/lib/schedule/formatRuleViolations";
import { snapshotCurrentVersion } from "@/lib/schedule/versionSnapshot";
import type { AssignmentInput } from "@/lib/planning/types";
import type { ManualPlacementInput } from "@/lib/schedule/generateDraftSchedule";
import { loadGenerateContext } from "@/lib/schedule/generateDraftSchedule";
import {
  buildSolverPayload,
  assignmentsToPrismaInputs,
  callScorer,
  type SolverPayload,
} from "@/lib/schedule/solverClient";
import {
  logGenerationStart,
  logGenerationComplete,
  logGenerationError,
} from "@/lib/logging/generationLogger";

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

/**
 * Run a single /solve-stream call against the Python solver, forwarding
 * progress events (optionally tagged with `variant`) and returning the final
 * result payload.  Thin wrapper shared by the single-run and Mehrfach-Lauf
 * paths.
 */
async function runSolverStream(args: {
  payload: SolverPayload;
  variant: string | null;           // e.g. "A" | "B" | null (null = single run)
  send: (data: Record<string, unknown>) => void;
  timeoutMs: number;
}): Promise<{
  result: Record<string, unknown> | null;
  httpStatus: number;
  errorText?: string;
}> {
  const { payload, variant, send, timeoutMs } = args;
  const tagged = (ev: Record<string, unknown>) =>
    variant ? { ...ev, variant } : ev;
  const solverResp = await fetch(`${SOLVER_URL}/solve-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!solverResp.ok || !solverResp.body) {
    const errBody = await solverResp.text().catch(() => "");
    return { result: null, httpStatus: solverResp.status, errorText: errBody };
  }
  const reader = solverResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: Record<string, unknown> | null = null;
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
          result = event.data as Record<string, unknown>;
        } else {
          send(tagged(event));
        }
      } catch {
        // skip malformed
      }
    }
  }
  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer.trim());
      if (event.type === "result") {
        result = event.data as Record<string, unknown>;
      } else {
        send(tagged(event));
      }
    } catch {
      // skip
    }
  }
  return { result, httpStatus: solverResp.status };
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
  // Mehrfach-Lauf: generation is now "raceCount sequential CP-SAT runs with
  // distinct seeds, keep the best". raceCount=1 is a normal single run
  // (unchanged wall-clock). raceCount>1 spawns N races A, B, C, …; each with
  // full num_workers. Total wall-clock ≈ raceCount × maxSolveTimeSeconds.
  // Default 1, clamped 1-10.
  const raceCount = (() => {
    const n =
      typeof body?.raceCount === "number" && Number.isFinite(body.raceCount)
        ? Math.floor(body.raceCount)
        : 1;
    return Math.max(1, Math.min(10, n));
  })();
  const multiRun = raceCount > 1;

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

  // ── System log: generation start ──
  const genStartTime = Date.now();
  const monthStr = schedule.periodStart.toISOString().slice(0, 7);
  logGenerationStart({
    userId,
    scheduleId,
    month: monthStr,
    employeeCount: genCtx.employees.length,
    profileCount: genCtx.profiles.length,
    staffingRuleCount: genCtx.mergedStaffing.size,
    manualPlacementCount: manualPlacements.length,
    maxSolveTimeSeconds: payload.maxSolveTimeSeconds,
  });

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

        // Each race gets its OWN perPhaseTimeoutMs budget via the per-fetch
        // AbortSignal.timeout(); total wall-clock is ~raceCount × perPhaseTimeoutMs.
        const perPhaseTimeoutMs = ((payload.maxSolveTimeSeconds ?? 120) + 60) * 1000;
        console.log(
          `[generate-stream] Calling solver at ${SOLVER_URL}/solve-stream, ` +
          `raceCount=${raceCount}, perPhaseTimeout=${perPhaseTimeoutMs}ms, ` +
          `previousAssignments=${payload.previousAssignments?.length ?? 0}`,
        );

        // ── Per-race record ──
        type RunRecord = {
          variant: string;          // "A".."J" (or "Einzellauf" for N=1)
          label: string;            // user-visible label, e.g. "Rennen A"
          result: Record<string, unknown>;
          randomSeed?: number;
          numWorkers: number;
        };
        const runs: RunRecord[] = [];
        // Best feasible run found so far — this drives the 🏆 trophy in the UI
        // and is what we persist at the end.
        let bestRun: RunRecord | null = null;

        // Pre-compute variant labels (A, B, …) so the UI can build its
        // stacked slot table up-front from the very first race_starting event.
        const variantLabels: string[] = [];
        for (let i = 0; i < raceCount; i++) {
          variantLabels.push(String.fromCharCode(65 + i)); // 'A' + i
        }
        // Timestamp-derived seeds: distinct per race and per invocation so we
        // genuinely sample the objective landscape. Prime stride decorrelates
        // sibling seeds within a single generation.
        const seedBase = Date.now();
        const seedFor = (idx: number) =>
          (seedBase + idx * 97) & 0x7fffffff;

        const isFeasibleRun = (r: RunRecord) =>
          r.result.status === "OPTIMAL" || r.result.status === "FEASIBLE";

        // ── Main loop: N sequential races, keep best-so-far ──
        for (let i = 0; i < raceCount; i++) {
          const variantLabel = multiRun ? variantLabels[i]! : "Einzellauf";
          const runLabel = multiRun ? `Rennen ${variantLabels[i]}` : "Einzellauf";
          const seed = seedFor(i);

          // race_starting marker (only for multi-run; single-run UI uses the
          // standard single-progress path).
          if (multiRun) {
            send({
              type: "progress",
              stage: "race_starting",
              label: `Rennen ${variantLabel} von ${raceCount} (seed=${seed})…`,
              pct: Math.round((i / raceCount) * 100),
              currentVariant: variantLabel,
              variantIndex: i + 1,
              totalVariants: raceCount,
              variantLabels,
              // Trophy tracker — tells the UI which row currently holds 🏆.
              bestSoFarVariant: bestRun?.variant ?? null,
              bestSoFarObjective:
                bestRun && typeof bestRun.result.objectiveValue === "number"
                  ? (bestRun.result.objectiveValue as number)
                  : null,
            });
          }

          const racePayload: SolverPayload = {
            ...payload,
            randomSeed: seed,
            numWorkers: 4, // sequential → each race gets full CPU
          };
          console.log(
            `[generate-stream] Race ${variantLabel} starting: seed=${seed}`,
          );
          const raceAttempt = await runSolverStream({
            payload: racePayload,
            variant: multiRun ? variantLabel : null,
            send,
            timeoutMs: perPhaseTimeoutMs,
          });

          if (raceAttempt.httpStatus === 200 && raceAttempt.result) {
            const record: RunRecord = {
              variant: variantLabel,
              label: runLabel,
              result: raceAttempt.result,
              randomSeed: seed,
              numWorkers: 4,
            };
            runs.push(record);

            // Update best-so-far: lower objective wins; first feasible beats
            // nothing; never let an infeasible run dethrone a feasible one.
            if (isFeasibleRun(record)) {
              const thisObj =
                typeof record.result.objectiveValue === "number"
                  ? (record.result.objectiveValue as number)
                  : Number.POSITIVE_INFINITY;
              const bestObj =
                bestRun && typeof bestRun.result.objectiveValue === "number"
                  ? (bestRun.result.objectiveValue as number)
                  : Number.POSITIVE_INFINITY;
              if (!bestRun || !isFeasibleRun(bestRun) || thisObj < bestObj) {
                bestRun = record;
              }
            } else if (bestRun == null) {
              bestRun = record; // placeholder so we always have *something*
            }

            if (multiRun) {
              const finalObj =
                typeof record.result.objectiveValue === "number"
                  ? (record.result.objectiveValue as number)
                  : null;
              send({
                type: "progress",
                stage: "race_finished",
                label: `${runLabel}: fertig`,
                pct: Math.round(((i + 1) / raceCount) * 100),
                currentVariant: variantLabel,
                variantIndex: i + 1,
                totalVariants: raceCount,
                variantFinalObjective: finalObj,
                variantStatus: record.result.status,
                bestSoFarVariant: bestRun?.variant ?? null,
                bestSoFarObjective:
                  bestRun && typeof bestRun.result.objectiveValue === "number"
                    ? (bestRun.result.objectiveValue as number)
                    : null,
              });
            }
          } else {
            console.error(
              `[generate-stream] Race ${variantLabel} failed: ` +
                `status=${raceAttempt.httpStatus} ` +
                `err=${(raceAttempt.errorText ?? "").slice(0, 200)}`,
            );
            if (multiRun) {
              send({
                type: "progress",
                stage: "race_finished",
                label: `${runLabel}: fehlgeschlagen`,
                pct: Math.round(((i + 1) / raceCount) * 100),
                currentVariant: variantLabel,
                variantIndex: i + 1,
                totalVariants: raceCount,
                variantFinalObjective: null,
                variantStatus: "ERROR",
                bestSoFarVariant: bestRun?.variant ?? null,
                bestSoFarObjective:
                  bestRun && typeof bestRun.result.objectiveValue === "number"
                    ? (bestRun.result.objectiveValue as number)
                    : null,
              });
            } else {
              // Single-run path: a failed race is fatal (matches old behaviour).
              send({
                type: "error",
                error:
                  `Solver returned ${raceAttempt.httpStatus}: ` +
                  `${(raceAttempt.errorText ?? "").slice(0, 200)}`,
              });
              controller.close();
              return;
            }
          }
        }

        // If EVERY race failed, surface an error so the UI stops gracefully.
        if (!bestRun) {
          send({
            type: "error",
            error: "Alle Läufe fehlgeschlagen — kein Ergebnis verfügbar.",
          });
          controller.close();
          return;
        }

        // Winner = best-so-far. Persisted plan is whichever race had the
        // lowest feasible objective.
        const winnerRun = bestRun;
        const solverResult = winnerRun.result;

        if (multiRun) {
          const summaryRows = runs.map((r) => ({
            variant: r.variant,
            label: r.label,
            status: r.result.status,
            objectiveValue:
              typeof r.result.objectiveValue === "number"
                ? (r.result.objectiveValue as number)
                : null,
            qualityMetrics: r.result.qualityMetrics ?? null,
          }));
          send({
            type: "progress",
            stage: "runs_complete",
            label: `Gewinner: ${winnerRun.label} (obj=${
              typeof solverResult.objectiveValue === "number"
                ? Math.round(solverResult.objectiveValue as number).toLocaleString("de-DE")
                : "N/A"
            })`,
            pct: 95,
            multiRun: {
              winnerVariant: winnerRun.variant,
              runs: summaryRows,
            },
          });
        }

        send({
          type: "progress",
          stage: "saving",
          label: "Speichere Ergebnisse...",
          pct: 90,
        });

        const solverStatus = solverResult.status as string;
        const solverAssignments =
          (solverResult.assignments as {
            employeeId: string;
            date: string;
            shiftProfileId: string;
            stationNumber: number | null;
          }[]) ?? [];
        console.log(`[generate-stream] Solver status: ${solverStatus}, assignments: ${solverAssignments.length}, reason: ${solverResult.reason ?? "none"}`);

        // Load employee names for human-readable debug/preflight output
        const empRows = await prisma.employee.findMany({
          where: { facilityId },
          select: { id: true, firstName: true, lastName: true },
        });
        const employeeNames = new Map(
          empRows.map((e) => [e.id, `${e.lastName}, ${e.firstName}`]),
        );

        // Pre-flight diagnostic — detect cheap, obvious conflicts
        const preflightIssues = preflightManualPlacements(payload, employeeNames);

        // Build debug log (infeasibility-aware + preflight issues).
        // In a Mehrfach-Lauf, pass all runs + winner so the log prepends a
        // table that lets reviewers see all races side-by-side.
        const debugLog = buildDebugLog(
          solverResult,
          payload,
          employeeNames,
          preflightIssues,
          multiRun
            ? {
                runs: runs.map((r) => ({
                  variant: r.variant,
                  label: r.label,
                  result: r.result,
                  randomSeed: r.randomSeed,
                  numWorkers: r.numWorkers,
                })),
                winnerVariant: winnerRun.variant,
              }
            : null,
        );

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

          // ── System log: generation failed (infeasible) ──
          logGenerationError({
            userId,
            scheduleId,
            error: `Solver ${solverStatus}: ${(solverResult.reason as string) ?? "keine Begründung"}`,
            status: solverStatus,
            conflictingConstraints: (solverResult.conflictingConstraints as string[]) ?? [],
          });

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
              infeasible: true,
              infeasibleReason: (solverResult.reason as string) ?? null,
              preflightIssues,
              manualPlacementCount: payload.manualPlacements.length,
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
            // Auto-snapshot current state before replacing assignments
            await snapshotCurrentVersion(scheduleId, "Vor Neugenerierung", tx);
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

        // Snapshot the newly generated state and mark it as current
        await snapshotCurrentVersion(scheduleId, "Automatisch generiert", undefined, true);

        // ── System log: generation complete ──
        // In a Mehrfach-Lauf we log ONE event per race (A, B, …), tagged
        // with a shared comparisonId so the activity log can pair them up,
        // and a `winner: true` flag on whichever race was picked. The field
        // name stays "comparisonId" for schema compatibility.
        const comparisonId = multiRun
          ? `${scheduleId}:${genStartTime}`
          : undefined;

        for (const r of runs) {
          const isWinner = r === winnerRun;
          const objVal =
            typeof r.result.objectiveValue === "number"
              ? (r.result.objectiveValue as number)
              : undefined;
          const qm = r.result.qualityMetrics as
            | {
                maxOverSollH?: number;
                avgAbsDeviationH?: number;
                blWeekViolations?: number;
                peakEmployeeId?: string | null;
                peakEmployeeDeltaH?: number;
                employeesOutsideRange?: number;
              }
            | null
            | undefined;
          const qualityMetrics = qm && typeof qm === "object"
            ? {
                maxOverSollH: qm.maxOverSollH ?? 0,
                avgAbsDeviationH: qm.avgAbsDeviationH ?? 0,
                blWeekViolations: qm.blWeekViolations ?? 0,
                peakEmployeeId: qm.peakEmployeeId ?? null,
                peakEmployeeDeltaH: qm.peakEmployeeDeltaH ?? 0,
                employeesOutsideRange: qm.employeesOutsideRange ?? 0,
              }
            : undefined;

          const runAssignments = Array.isArray(r.result.assignments)
            ? (r.result.assignments as unknown[])
            : [];
          const runUnfulfilled = Array.isArray(r.result.unfulfilledWishes)
            ? (r.result.unfulfilledWishes as string[])
            : [];

          logGenerationComplete({
            userId,
            scheduleId,
            status: r.result.status as string,
            // Only the winner reflects the end-to-end (persist + validate + score)
            // wall time; losers just report the raw solve time reported by Python.
            solveTimeMs: isWinner
              ? Date.now() - genStartTime
              : typeof r.result.solveTimeMs === "number"
                ? (r.result.solveTimeMs as number)
                : 0,
            assignmentCount: isWinner
              ? solverAssignments.length
              : runAssignments.length,
            warningCount: isWinner ? allWarnings.length : 0,
            unmetStaffingCount: 0,
            unfulfilledWishCount: runUnfulfilled.length,
            objectiveValue: objVal,
            // Multi-run fields (undefined when raceCount === 1)
            variant: multiRun ? "race" : undefined,
            comparisonId,
            winner: multiRun ? isWinner : undefined,
            qualityMetrics,
            randomSeed: r.randomSeed,
            numWorkers: r.numWorkers,
          });
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
            // Expose multi-run summary so the UI can confirm which race won
            multiRun: multiRun
              ? {
                  winnerVariant: winnerRun.variant,
                  runs: runs.map((r) => ({
                    variant: r.variant,
                    label: r.label,
                    status: r.result.status,
                    objectiveValue:
                      typeof r.result.objectiveValue === "number"
                        ? (r.result.objectiveValue as number)
                        : null,
                    qualityMetrics: r.result.qualityMetrics ?? null,
                    randomSeed: r.randomSeed ?? null,
                    numWorkers: r.numWorkers,
                  })),
                }
              : undefined,
          },
        });
      } catch (e) {
        console.error("generate-stream error", e);
        logGenerationError({
          userId,
          scheduleId,
          error: e instanceof Error ? e.message : "Unbekannter Fehler",
        });
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

/**
 * Pre-flight check — runs BEFORE the solver and detects obvious conflicts
 * among manual placements and other inputs. Returns an array of
 * human-readable German issue strings (empty if none).
 *
 * This is best-effort: we only flag issues that are cheap and clearly
 * impossible. The authoritative infeasibility check is still the solver.
 */
function preflightManualPlacements(
  payload: SolverPayload,
  employeeNames: Map<string, string>,
): string[] {
  const issues: string[] = [];
  const profMap = new Map(payload.shiftProfiles.map((p) => [p.id, p]));
  const empMap = new Map(payload.employees.map((e) => [e.id, e]));
  const mps = payload.manualPlacements;

  const nameFor = (id: string) => employeeNames.get(id) ?? id.slice(0, 8);
  const profNameFor = (id: string) => profMap.get(id)?.name ?? "?";

  // 1) Duplicate placements (same employee + date, different profile)
  const byEmpDay = new Map<string, typeof mps>();
  for (const mp of mps) {
    const k = `${mp.employeeId}|${mp.date}`;
    const arr = byEmpDay.get(k) ?? [];
    arr.push(mp);
    byEmpDay.set(k, arr);
  }
  for (const [k, arr] of byEmpDay) {
    if (arr.length > 1) {
      const [empId, date] = k.split("|");
      const profs = arr.map((m) => profNameFor(m.shiftProfileId)).join(", ");
      issues.push(`${nameFor(empId!)} am ${date}: mehrere Vorgaben am gleichen Tag (${profs}).`);
    }
  }

  // 2) Placement on a blocked date (Frei-Vorgabe or Absence)
  const blockedSet = new Set(payload.blockedDates.map((b) => `${b.employeeId}|${b.date}`));
  for (const mp of mps) {
    if (blockedSet.has(`${mp.employeeId}|${mp.date}`)) {
      issues.push(
        `${nameFor(mp.employeeId)} am ${mp.date}: ${profNameFor(mp.shiftProfileId)} kollidiert mit Frei-Vorgabe oder Abwesenheit.`,
      );
    }
  }

  // 3) Placement on a date in the employee's unavailableDates list (DB absences)
  for (const mp of mps) {
    const emp = empMap.get(mp.employeeId);
    if (!emp) {
      issues.push(`${nameFor(mp.employeeId)} am ${mp.date}: Mitarbeiter nicht im Generator-Kontext (evtl. inaktiv).`);
      continue;
    }
    if (emp.unavailableDates.includes(mp.date)) {
      issues.push(
        `${nameFor(mp.employeeId)} am ${mp.date}: ${profNameFor(mp.shiftProfileId)} fällt in Abwesenheit.`,
      );
    }
  }

  // Note: we intentionally do NOT flag issues for disallowed shift profiles,
  // stations outside assignedStations, or rest-hour conflicts between manual
  // placements. Manual placements are the planner's authoritative override —
  // the solver honors them verbatim and may relax other rules to accommodate
  // them (violations are reported as warnings after solve).

  return issues;
}

/** Per-run record passed to buildDebugLog when a Mehrfach-Lauf happened. */
type DebugLogRunRecord = {
  variant: string;            // "A".."J"
  label: string;              // "Rennen A" …
  result: Record<string, unknown>;
  randomSeed?: number;
  numWorkers: number;
};

/** Build a debug log string from the solver result. */
function buildDebugLog(
  response: Record<string, unknown>,
  payload: SolverPayload,
  employeeNames: Map<string, string>,
  preflightIssues: string[],
  comparison: {
    runs: DebugLogRunRecord[];
    winnerVariant: string;   // "A".."J" — which race won
  } | null,
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

  const isInfeasible = response.status === "INFEASIBLE" || response.status === "UNKNOWN";
  const nameFor = (id: string) => employeeNames.get(id) ?? id.slice(0, 8);

  const lines: string[] = [];

  // ── Mehrfach-Lauf header (only when >1 race happened) ──
  if (comparison && comparison.runs.length > 0) {
    lines.push("=== Mehrfach-Lauf ===");
    const winnerRun = comparison.runs.find(
      (r) => r.variant === comparison.winnerVariant,
    );
    const winnerObj =
      winnerRun && typeof winnerRun.result.objectiveValue === "number"
        ? (winnerRun.result.objectiveValue as number)
        : null;
    lines.push(
      `Gewinner: ${winnerRun?.label ?? `Rennen ${comparison.winnerVariant}`}` +
        (winnerObj != null
          ? ` (obj=${Math.round(winnerObj).toLocaleString("de-DE")})`
          : ""),
    );
    lines.push(
      "Kriterium: niedrigstes objectiveValue (CP-SAT minimiert) aus allen Läufen. " +
        "Jeder Lauf startet mit eigenem Seed; nur der Gewinner wird gespeichert.",
    );
    lines.push("");
    // Table: one row per run
    lines.push(
      `  ${"Lauf".padEnd(22)}  ${"Status".padEnd(10)}  ${"obj".padStart(14)}  ` +
        `${"Zuw".padStart(5)}  ${"max+h".padStart(7)}  ${"Ø|Δ|h".padStart(7)}  ` +
        `${"BL-Gap".padStart(6)}  ${"außerh.".padStart(7)}  Seed/NW`,
    );
    lines.push("  " + "-".repeat(100));
    for (const r of comparison.runs) {
      const isW = r.variant === comparison.winnerVariant;
      const marker = isW ? "🏆 " : "   ";
      const obj =
        typeof r.result.objectiveValue === "number"
          ? Math.round(r.result.objectiveValue as number).toLocaleString("de-DE")
          : "—";
      const asn = Array.isArray(r.result.assignments)
        ? (r.result.assignments as unknown[]).length
        : 0;
      const qm = r.result.qualityMetrics as
        | {
            maxOverSollH?: number;
            avgAbsDeviationH?: number;
            blWeekViolations?: number;
            employeesOutsideRange?: number;
          }
        | null
        | undefined;
      const maxOver =
        qm && typeof qm.maxOverSollH === "number"
          ? qm.maxOverSollH.toFixed(1)
          : "—";
      const avgAbs =
        qm && typeof qm.avgAbsDeviationH === "number"
          ? qm.avgAbsDeviationH.toFixed(1)
          : "—";
      const blGap =
        qm && typeof qm.blWeekViolations === "number"
          ? String(qm.blWeekViolations)
          : "—";
      const outside =
        qm && typeof qm.employeesOutsideRange === "number"
          ? String(qm.employeesOutsideRange)
          : "—";
      const seedNw =
        r.randomSeed != null
          ? `seed=${r.randomSeed}, nw=${r.numWorkers}`
          : `nw=${r.numWorkers}`;
      lines.push(
        `${marker}${r.label.padEnd(20)}  ${String(r.result.status ?? "—").padEnd(10)}  ` +
          `${obj.padStart(14)}  ${String(asn).padStart(5)}  ${maxOver.padStart(7)}  ` +
          `${avgAbs.padStart(7)}  ${blGap.padStart(6)}  ${outside.padStart(7)}  ${seedNw}`,
      );
    }
    // Spread between best and worst feasible run — gives reviewers a sense
    // of how much the seed landscape varies.
    const feasibleObjs = comparison.runs
      .filter(
        (r) => r.result.status === "OPTIMAL" || r.result.status === "FEASIBLE",
      )
      .map((r) =>
        typeof r.result.objectiveValue === "number"
          ? (r.result.objectiveValue as number)
          : null,
      )
      .filter((v): v is number => v != null);
    if (feasibleObjs.length >= 2) {
      const minObj = Math.min(...feasibleObjs);
      const maxObj = Math.max(...feasibleObjs);
      const spread = maxObj - minObj;
      const pct = minObj > 0 ? (spread / minObj) * 100 : 0;
      lines.push("");
      lines.push(
        `  Spreizung (beste ↔ schlechteste feasible): ${Math.round(spread).toLocaleString("de-DE")} ` +
          `(${pct.toFixed(2)}%).`,
      );
    }
    lines.push("");
    lines.push(
      "Hinweis: Nur der Gewinner wurde gespeichert; die übrigen Läufe sind nach Ende verworfen.",
    );
    lines.push("");
    lines.push("");
  }

  // ── Standard CP-SAT run block (unchanged) ──
  lines.push(
    `=== CP-SAT Solver Run${
      comparison ? ` — Gewinner-Lauf: Rennen ${comparison.winnerVariant}` : ""
    } ===`,
    `Status: ${response.status}`,
    `Solve time: ${((response.solveTimeMs as number) ?? 0).toFixed(1)}ms`,
    `Objective: ${response.objectiveValue ?? "N/A"}`,
    `Employees: ${payload.employees.length}`,
    `Shift profiles: ${payload.shiftProfiles.length}`,
    `Manual placements: ${payload.manualPlacements.length}`,
    `Blocked dates: ${payload.blockedDates.length}`,
    `Assignments created: ${assignments.length}`,
  );

  if (isInfeasible) {
    lines.push("");
    lines.push(
      `⚠️  Der Solver hat KEINE zulässige Lösung gefunden — es wurden keine Dienste eingetragen.`,
    );
    lines.push(
      `Die unten aufgeführten Vorgaben sind deshalb nicht eingeplant (das bedeutet NICHT, dass sie ungültig sind).`,
    );
  }

  if (preflightIssues.length > 0) {
    lines.push("");
    lines.push(`--- Vorab-Prüfung: ${preflightIssues.length} mögliche Konflikt(e) ---`);
    for (const issue of preflightIssues) {
      lines.push(`  • ${issue}`);
    }
  }

  if (payload.manualPlacements.length > 0) {
    lines.push("");
    lines.push(`--- Manuelle Vorgaben (${payload.manualPlacements.length}) ---`);
    for (const mp of payload.manualPlacements) {
      const prof = profMap.get(mp.shiftProfileId);
      const profName = prof?.name ?? "?";
      const matched = assignments.find(
        (a) => a.employeeId === mp.employeeId && a.date === mp.date,
      );
      const prefix = `  ${nameFor(mp.employeeId)} ${mp.date}: ${profName} Station=${mp.stationNumber ?? "egal"}`;
      if (matched) {
        const mProf = profMap.get(matched.shiftProfileId);
        const mName = mProf?.name ?? "?";
        const shiftOk = matched.shiftProfileId === mp.shiftProfileId;
        const stationOk =
          mp.stationNumber == null ||
          matched.stationNumber === mp.stationNumber;
        lines.push(
          `${prefix} → eingeplant als ${mName} Station=${matched.stationNumber ?? "?"} ${shiftOk && stationOk ? "✓" : "⚠ Abweichung"}`,
        );
      } else if (isInfeasible) {
        lines.push(`${prefix} → nicht eingeplant (Solver INFEASIBLE)`);
      } else {
        lines.push(`${prefix} → nicht eingeplant!`);
      }
    }
  }

  if (isInfeasible) {
    lines.push("");
    lines.push(`--- Mögliche Ursachen prüfen ---`);
    lines.push(`  1. Vorgaben untereinander: kollidieren manuelle Einträge (Ruhezeit, gleicher Tag)?`);
    lines.push(`  2. Abwesenheiten: liegen Vorgaben auf Krank-/Urlaubs-Tagen?`);
    lines.push(`  3. Personalbesetzung: zwingen Vorgaben so viele Mitarbeiter auf einen Tag, dass die Max-Besetzung überschritten würde?`);
    lines.push(`  4. Qualifikationen: sind für die geforderten Stationen genug qualifizierte Mitarbeiter verfügbar?`);
    lines.push(`  5. Wochenend-Regel (alternierend): zu viele Vorgaben am gleichen Wochenende?`);
    lines.push(`  6. Mini-Job-Stunden: würden Vorgaben die Monats-Stundenobergrenze sprengen?`);
    lines.push(`  7. Ketten-/Ruhetage-Regeln: zu viele Tage hintereinander ohne Ruhe?`);
  }

  return lines.join("\n");
}
