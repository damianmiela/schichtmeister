import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import { plannerJsonErrors } from "@/lib/api/validation";
import { validateScheduleAssignments } from "@/lib/api/planningScheduleValidation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { formatRuleViolations } from "@/lib/schedule/formatRuleViolations";
import type { AssignmentInput } from "@/lib/planning/types";
import type { GenerateReport, ManualPlacementInput } from "@/lib/schedule/generateDraftSchedule";
import { loadGenerateContext } from "@/lib/schedule/generateDraftSchedule";
import { runCpsatGeneration, SolverError, callScorer, buildSolverPayload, type CpsatGenerateResult } from "@/lib/schedule/solverClient";

// 28 days = ~4 weeks back. Covers the 3 prior weekends needed by the
// 4-window alternating-weekends rule, plus a buffer for partial weeks.
// (Was 7 — only included the immediately-prior weekend.)
const BOUNDARY_DAYS = 28;

/**
 * Replaces the roster: **deletes all assignments** on this schedule, then
 * runs the CP-SAT solver to generate an optimal schedule.
 */
type RouteCtx = { params: Promise<{ id: string }> };

/** Safe, JSON-serializable diagnostics for the UI (no stack traces). */
function serializeGenerateError(e: unknown): Record<string, unknown> {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      kind: "PrismaClientKnownRequestError",
      code: e.code,
      message: e.message,
      meta: e.meta as Record<string, unknown>,
    };
  }
  if (e instanceof Prisma.PrismaClientValidationError) {
    return { kind: "PrismaClientValidationError", message: e.message };
  }
  if (e instanceof Prisma.PrismaClientUnknownRequestError) {
    return { kind: "PrismaClientUnknownRequestError", message: e.message };
  }
  if (e instanceof Prisma.PrismaClientInitializationError) {
    return { kind: "PrismaClientInitializationError", message: e.message };
  }
  if (e instanceof Prisma.PrismaClientRustPanicError) {
    return { kind: "PrismaClientRustPanicError", message: e.message };
  }
  if (e instanceof Error) {
    return { kind: e.name || "Error", message: e.message };
  }
  return { kind: "unknown", message: String(e) };
}

const VALID_SHIFT_TYPES = new Set(["EARLY", "LATE", "NIGHT", "BL"]);

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
      const sn = typeof item.stationNumber === "number" && item.stationNumber >= 1 && item.stationNumber <= 3
        ? item.stationNumber
        : undefined;
      out.push({
        employeeId: item.employeeId,
        date: item.date,
        stationNumber: sn,
        shiftProfileId: typeof item.shiftProfileId === "string" ? item.shiftProfileId : undefined,
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

  // Load previous month's last 7 days of assignments for cross-month boundary checks
  let previousAssignments: { employeeId: string; date: string; shiftProfileId: string }[] = [];
  try {
    const prevSchedule = await prisma.schedule.findFirst({
      where: { facilityId, periodEnd: { lt: schedule.periodStart } },
      orderBy: { periodEnd: "desc" },
    });
    console.log("[generate] prevSchedule:", prevSchedule?.id ?? "NONE");
    if (prevSchedule) {
      const cutoff = new Date(schedule.periodStart);
      cutoff.setUTCDate(cutoff.getUTCDate() - BOUNDARY_DAYS);
      const prevRows = await prisma.assignment.findMany({
        where: { scheduleId: prevSchedule.id, date: { gte: cutoff, lt: schedule.periodStart }, dayStatus: null },
      });
      console.log("[generate] boundary assignments loaded:", prevRows.length);
      for (const a of prevRows) {
        // Skip pure absence rows (no shift profile) — boundary checks operate on real shifts only.
        if (!a.shiftProfileId) continue;
        previousAssignments.push({
          employeeId: a.employeeId,
          date: toIsoDateOnly(a.date),
          shiftProfileId: a.shiftProfileId,
        });
      }
    }
  } catch (boundaryErr) {
    console.error("[generate] ERROR loading boundary assignments:", boundaryErr);
    previousAssignments = [];
  }

  const TX_MAX_WAIT_MS = 20_000;
  const TX_TIMEOUT_MS = 300_000;

  let report: GenerateReport | CpsatGenerateResult;

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    select: { minRestHours: true, miniJobMaxMonthlyHours: true, maxSolveTimeSeconds: true, ruleOverridesJson: true },
  });

  try {
    report = await prisma.$transaction(
      async (tx) => {
        return runCpsatGeneration(
          tx,
          schedule.id,
          schedule.periodStart,
          schedule.periodEnd,
          userId,
          genCtx,
          facility,
          manualPlacements,
          blockedDates,
          previousAssignments,
        );
      },
      { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS },
    );
  } catch (e) {
    console.error("POST /api/schedules/[id]/generate", e);
    if (e instanceof SolverError) {
      return NextResponse.json(
        { error: `CP-SAT Solver: ${e.message}`, details: { status: e.status } },
        { status: e.status >= 500 ? 502 : 500 },
      );
    }
    const isTxTimeout =
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034";
    return NextResponse.json(
      {
        error: isTxTimeout
          ? "Zeitlimit der Datenbanktransaktion überschritten."
          : "Generierung fehlgeschlagen.",
        details: serializeGenerateError(e),
      },
      { status: 500 },
    );
  }

  // ── Shared post-generation: validate + persist ────────────────────
  const rows = await prisma.assignment.findMany({
    where: { scheduleId },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  // Pure absence rows are not part of the planning input.
  const assignmentInputs: AssignmentInput[] = rows
    .filter((a) => a.shiftProfileId != null)
    .map((a) => ({
      id: a.id,
      date: a.date,
      shiftProfileId: a.shiftProfileId as string,
      employeeId: a.employeeId,
    }));

  let ruleWarnings: import("@/lib/schedule/formatRuleViolations").FormattedWarning[] = [];
  const v = await validateScheduleAssignments(
    prisma,
    facilityId,
    { periodStart: schedule.periodStart, periodEnd: schedule.periodEnd },
    assignmentInputs,
  );
  if (v.ok) {
    const allMessages = [...v.result.errors, ...v.result.warnings];
    if (allMessages.length > 0) {
      const emps = await prisma.employee.findMany({
        where: { facilityId },
        select: { id: true, firstName: true, lastName: true },
      });
      const empNames = new Map(emps.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
      ruleWarnings = formatRuleViolations(allMessages, empNames);
    }
  }

  // Generator emits string[]; wrap each as count=1 so the new structured
  // shape works end-to-end without losing per-violation accuracy on the
  // rule-engine side.
  const generatorOnlyWarnings = report.warnings
    .filter((w) => !w.startsWith("Überstunden:") && !w.includes("vorhanden –"))
    .map((w) => ({ message: w, count: 1 }));
  const allWarnings: import("@/lib/schedule/formatRuleViolations").FormattedWarning[] = [
    ...generatorOnlyWarnings,
    ...ruleWarnings,
    ...(report.unmetStaffing.length > 0
      ? [{
          message: `${report.unmetStaffing.length} Bedarfsslots nur teilweise oder gar nicht besetzt.`,
          count: report.unmetStaffing.length,
        }]
      : []),
  ];

  // Preserve savedEntries from existing preGenWishesJson
  let existingSavedEntries: unknown[] | undefined;
  if (schedule.preGenWishesJson) {
    try {
      const parsed = JSON.parse(schedule.preGenWishesJson);
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

  // ── Build score report (fire-and-forget style, non-blocking on failure) ──
  let scoreReport: string | null = null;
  try {
    // Build employee name map
    const allEmps = await prisma.employee.findMany({
      where: { facilityId },
      select: {
        id: true, firstName: true, lastName: true, status: true,
        contractType: true, isFullTimeBl: true, targetHoursPercent: true,
        targetHours: true, targetHoursPeriod: true,
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

    const staffingRequirements = [...genCtx.mergedStaffing.entries()].map(([key, entry]) => ({
      key,
      ...entry,
    }));

    const currentAssignments = rows
      .filter((a) => !a.dayStatus) // Exclude absence markers from scoring
      .filter((a) => a.shiftProfileId != null)
      .map((a) => ({
        employeeId: a.employeeId,
        date: toIsoDateOnly(a.date),
        shiftProfileId: a.shiftProfileId as string,
        shiftType: profileShiftTypes[a.shiftProfileId as string] ?? "?",
        stationNumber: a.stationNumber,
      }));

    let solverPayload: Record<string, unknown> | null = null;
    try {
      const facilitySlice = await prisma.facility.findUniqueOrThrow({
        where: { id: facilityId },
        select: { minRestHours: true, miniJobMaxMonthlyHours: true, maxSolveTimeSeconds: true, ruleOverridesJson: true },
      });
      // Pass the real manualPlacements / blockedDates so the score
      // report's solverPayload matches what the solver actually ran with.
      // Without this the downstream scorer sees empty wishes / manual
      // placements and produces misleading diagnostics.
      solverPayload = buildSolverPayload(
        scheduleId,
        schedule.periodStart,
        schedule.periodEnd,
        genCtx,
        facilitySlice,
        manualPlacements,
        blockedDates,
      ) as unknown as Record<string, unknown>;
    } catch {
      // Non-critical: proceed without solver payload
    }

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
      solverPayload,
    };

    scoreReport = await callScorer(debugJson);
  } catch {
    // Score generation is non-critical — proceed without it
  }

  try {
    await prisma.schedule.update({
      where: { id: scheduleId },
      data: {
        warningsJson: allWarnings.length > 0 ? JSON.stringify(allWarnings) : null,
        generationLog: report.debugLog || null,
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
      return NextResponse.json(
        {
          error:
            "Der Dienstplan wurde inzwischen gelöscht oder ist nicht mehr verfügbar.",
        },
        { status: 404 },
      );
    }
    throw e;
  }

  return NextResponse.json({
    createdAssignments: report.createdAssignments,
    manualPlacementsApplied: report.manualPlacementsApplied,
    unmetStaffing: report.unmetStaffing,
    unfulfilledWishes: report.unfulfilledWishes,
    warnings: allWarnings,
    assignments: rows.map((a) => ({
      id: a.id,
      scheduleId: a.scheduleId,
      date: toIsoDateOnly(a.date),
      shiftProfileId: a.shiftProfileId,
      employeeId: a.employeeId,
    })),
  });
}
