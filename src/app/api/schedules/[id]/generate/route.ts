import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import type { GenerateReport, ManualPlacementInput } from "@/lib/schedule/generateDraftSchedule";
import {
  loadGenerateContext,
  runGreedyScheduleGeneration,
} from "@/lib/schedule/generateDraftSchedule";

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

  let report: GenerateReport;
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

  const allWarnings = [
    ...report.warnings,
    ...(report.unmetStaffing.length > 0
      ? [`${report.unmetStaffing.length} Bedarfsslots nur teilweise oder gar nicht besetzt.`]
      : []),
  ];

  await prisma.schedule.update({
    where: { id: scheduleId },
    data: { warningsJson: JSON.stringify(allWarnings) },
  });

  const rows = await prisma.assignment.findMany({
    where: { scheduleId },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  return NextResponse.json({
    createdAssignments: report.createdAssignments,
    manualPlacementsApplied: report.manualPlacementsApplied,
    unmetStaffing: report.unmetStaffing,
    unfulfilledWishes: report.unfulfilledWishes,
    warnings: report.warnings,
    assignments: rows.map((a) => ({
      id: a.id,
      scheduleId: a.scheduleId,
      date: toIsoDateOnly(a.date),
      shiftProfileId: a.shiftProfileId,
      employeeId: a.employeeId,
    })),
  });
}
