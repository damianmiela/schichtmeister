import { NextRequest, NextResponse } from "next/server";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { validateScheduleAssignments } from "@/lib/api/planningScheduleValidation";
import { formatRuleViolations } from "@/lib/schedule/formatRuleViolations";
import type { AbsenceInput, AssignmentInput } from "@/lib/planning/types";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * POST /api/schedules/[id]/revalidate?employeeId=xxx
 *
 * Re-runs the full validation engine on the current assignments and
 * saves updated warnings to the schedule. Called when the schedule page
 * is opened so warnings stay up-to-date after day-view edits.
 *
 * If `employeeId` query param is provided, returns ONLY warnings that
 * involve that specific employee (filtered at the RuleMessage level
 * before formatting).
 */
export async function POST(request: NextRequest, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id: scheduleId } = await context.params;
  const facilityId = session!.user.facilityId;
  const employeeIdFilter = request.nextUrl.searchParams.get("employeeId");

  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, facilityId },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Dienstplan nicht gefunden." }, { status: 404 });
  }

  const allRows = await prisma.assignment.findMany({
    where: { scheduleId },
  });

  // Separate real shifts from absence/status markers (K, U, FREI, etc.)
  const ABSENCE_STATUSES = new Set(["K", "U", "LZ", "MS", "KU"]);
  const assignmentInputs: AssignmentInput[] = [];
  const dayStatusRows: { employeeId: string; date: Date; dayStatus: string }[] = [];

  for (const a of allRows) {
    if (a.dayStatus) {
      dayStatusRows.push({ employeeId: a.employeeId, date: a.date, dayStatus: a.dayStatus });
    } else {
      assignmentInputs.push({
        id: a.id,
        date: a.date,
        shiftProfileId: a.shiftProfileId,
        employeeId: a.employeeId,
      });
    }
  }

  // Build synthetic per-day absences from dayStatus markers so the sollDelta
  // rule can reduce Soll correctly (these complement EmployeeAbsence DB records)
  const extraAbsences: AbsenceInput[] = dayStatusRows
    .filter((r) => ABSENCE_STATUSES.has(r.dayStatus))
    .map((r) => ({
      employeeId: r.employeeId,
      startDate: r.date,
      endDate: r.date,
      type: r.dayStatus === "K" ? "KRANK" : "URLAUB",
    }));

  const v = await validateScheduleAssignments(
    prisma,
    facilityId,
    { periodStart: schedule.periodStart, periodEnd: schedule.periodEnd },
    assignmentInputs,
    { extraAbsences },
  );

  let warningStrings: string[] = [];
  let employeeWarnings: string[] | undefined;

  if (v.ok) {
    const allMessages = [...v.result.errors, ...v.result.warnings];
    if (allMessages.length > 0) {
      const emps = await prisma.employee.findMany({
        where: { facilityId },
        select: { id: true, firstName: true, lastName: true },
      });
      const empNames = new Map(emps.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));

      // Full warnings for schedule storage
      warningStrings = formatRuleViolations(allMessages, empNames);

      // Employee-specific warnings if requested
      if (employeeIdFilter) {
        const empMessages = allMessages.filter(
          (msg) => msg.employeeIds?.includes(employeeIdFilter),
        );
        employeeWarnings = empMessages.length > 0
          ? formatRuleViolations(empMessages, empNames)
          : [];
      }
    }
  }

  await prisma.schedule.update({
    where: { id: scheduleId },
    data: { warningsJson: warningStrings.length > 0 ? JSON.stringify(warningStrings) : null },
  });

  return NextResponse.json({
    warnings: warningStrings,
    ...(employeeWarnings !== undefined && { employeeWarnings }),
  });
}
