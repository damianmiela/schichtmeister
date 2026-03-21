import { NextResponse } from "next/server";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import {
  loadGenerateContext,
  runGreedyScheduleGeneration,
} from "@/lib/schedule/generateDraftSchedule";

/**
 * Replaces the roster: **deletes all assignments** on this schedule (Entwurf or veröffentlicht), then
 * runs a deterministic greedy fill. Calling twice yields the same result for the same DB state.
 */
type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id: scheduleId } = await context.params;
  const facilityId = session!.user.facilityId;
  const userId = session!.user.id;

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

  const report = await prisma.$transaction(async (tx) => {
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
    );
  });

  const rows = await prisma.assignment.findMany({
    where: { scheduleId },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  return NextResponse.json({
    createdAssignments: report.createdAssignments,
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
