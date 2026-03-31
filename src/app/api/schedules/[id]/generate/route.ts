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
import {
  loadGenerateContext,
  runGreedyScheduleGeneration,
} from "@/lib/schedule/generateDraftSchedule";
import { runCpsatGeneration, SolverError, type CpsatGenerateResult } from "@/lib/schedule/solverClient";

/**
 * Replaces the roster: **deletes all assignments** on this schedule (Entwurf or veröffentlicht), then
 * runs a deterministic greedy fill. Calling twice yields the same result for the same DB state.
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

const VALID_SHIFT_TYPES = new Set(["EARLY", "LATE", "NIGHT"]);

function parseManualPlacements(raw: unknown): ManualPlacementInput[] {
  if (!Array.isArray(raw)) return [];
  const out: ManualPlacementInput[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof item.employeeId === "string" &&
      typeof item.date === "string" &&
      typeof item.stationNumber === "number" &&
      item.stationNumber >= 1 &&
      item.stationNumber <= 3 &&
      typeof item.shiftType === "string" &&
      VALID_SHIFT_TYPES.has(item.shiftType) &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.date)
    ) {
      out.push({
        employeeId: item.employeeId,
        date: item.date,
        stationNumber: item.stationNumber,
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
  const engine: "greedy" | "cpsat" =
    body?.engine === "cpsat" ? "cpsat" : "greedy";
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

  const TX_MAX_WAIT_MS = 20_000;
  const TX_TIMEOUT_MS = 300_000;

  let report: GenerateReport | CpsatGenerateResult;

  if (engine === "cpsat") {
    // ── CP-SAT path ───────────────────────────────────────────────
    const facility = await prisma.facility.findUniqueOrThrow({
      where: { id: facilityId },
      select: { minRestHours: true, miniJobMaxMonthlyHours: true, ruleOverridesJson: true },
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
          );
        },
        { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS },
      );
    } catch (e) {
      console.error("POST /api/schedules/[id]/generate (cpsat)", e);
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
            ? "CP-SAT: Zeitlimit der Datenbanktransaktion überschritten."
            : "CP-SAT Generierung fehlgeschlagen.",
          details: serializeGenerateError(e),
        },
        { status: 500 },
      );
    }
  } else {
    // ── Greedy path (unchanged) ───────────────────────────────────
    try {
      report = await prisma.$transaction(
        async (tx) => {
          await tx.assignment.deleteMany({ where: { scheduleId } });
          return runGreedyScheduleGeneration(
            tx,
            facilityId,
            {
              id: schedule.id,
              periodStart: schedule.periodStart,
              periodEnd: schedule.periodEnd,
            },
            userId,
            genCtx,
            manualPlacements,
            blockedDates,
          );
        },
        { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS },
      );
    } catch (e) {
      console.error("POST /api/schedules/[id]/generate", e);
      const isTxTimeout =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034";
      const details = serializeGenerateError(e);
      return NextResponse.json(
        {
          error: isTxTimeout
            ? "Generierung hat das Zeitlimit überschritten. Bitte erneut versuchen oder die Periode aufteilen."
            : "Generierung fehlgeschlagen.",
          details,
        },
        { status: 500 },
      );
    }
  }

  // ── Shared post-generation: validate + persist ────────────────────
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

  const generatorOnlyWarnings = report.warnings.filter(w =>
    !w.startsWith("Überstunden:") && !w.includes("vorhanden –")
  );
  const allWarnings = [
    ...generatorOnlyWarnings,
    ...ruleWarnings,
    ...(report.unmetStaffing.length > 0
      ? [`${report.unmetStaffing.length} Bedarfsslots nur teilweise oder gar nicht besetzt.`]
      : []),
  ];

  const preGenWishes = {
    shiftWishes: manualPlacements.map((mp) => ({
      employeeId: mp.employeeId,
      date: mp.date,
    })),
    freiDates: blockedDates.map((bd) => ({
      employeeId: bd.employeeId,
      date: bd.date,
    })),
  };

  await prisma.schedule.update({
    where: { id: scheduleId },
    data: {
      warningsJson: allWarnings.length > 0 ? JSON.stringify(allWarnings) : null,
      generationLog: report.debugLog || null,
      preGenWishesJson:
        preGenWishes.shiftWishes.length > 0 || preGenWishes.freiDates.length > 0
          ? JSON.stringify(preGenWishes)
          : null,
    },
  });

  return NextResponse.json({
    engine,
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
