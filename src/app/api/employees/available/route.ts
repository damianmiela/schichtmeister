import { NextRequest, NextResponse } from "next/server";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { parseIsoDateOnly, toIsoDateOnly } from "@/lib/api/dateOnly";
import { assignmentPaidHours } from "@/lib/planning/time";
import { computeSollHours, monthlyWorkingDaysWithHolidays } from "@/lib/holidays";

/**
 * GET /api/employees/available?scheduleId=...&date=YYYY-MM-DD
 *
 * Returns all facility employees with Ist/Soll hours for the month,
 * plus whether they already have an assignment on the given date.
 */
export async function GET(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const facilityId = session!.user.facilityId;
  const { searchParams } = new URL(request.url);
  const scheduleId = searchParams.get("scheduleId");
  const dateStr = searchParams.get("date");

  if (!scheduleId || !dateStr) {
    return NextResponse.json(
      { error: "scheduleId und date sind erforderlich." },
      { status: 400 },
    );
  }

  const date = parseIsoDateOnly(dateStr);
  if (!date) {
    return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
  }

  // Month boundaries (UTC)
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));

  const [employees, assignments, profiles] = await Promise.all([
    prisma.employee.findMany({
      where: { facilityId },
      include: {
        qualifications: { select: { id: true, abbreviation: true, name: true } },
        allowedShiftProfiles: { select: { id: true } },
      },
    }),
    prisma.assignment.findMany({
      where: { scheduleId, date: { gte: monthStart, lte: monthEnd } },
    }),
    prisma.shiftProfile.findMany({
      where: { facilityId },
    }),
  ]);

  const profilesById = new Map(profiles.map((p) => [p.id, p]));
  const dateKey = toIsoDateOnly(date);

  // Build per-employee hour totals for the month
  const istByEmployee = new Map<string, number>();
  const assignedOnDate = new Set<string>();

  for (const a of assignments) {
    const prof = profilesById.get(a.shiftProfileId);
    if (!prof) continue;

    const hours = assignmentPaidHours(a.date, prof.startTime, prof.endTime, prof.breakMinutes);
    istByEmployee.set(a.employeeId, (istByEmployee.get(a.employeeId) ?? 0) + hours);

    if (toIsoDateOnly(a.date) === dateKey) {
      assignedOnDate.add(a.employeeId);
    }
  }

  // Compute working days in month (Mon-Fri minus German holidays)
  const workingDays = monthlyWorkingDaysWithHolidays(date.getUTCFullYear(), date.getUTCMonth());

  const result = employees.map((emp) => {
    const pct = emp.targetHoursPercent != null ? Number(emp.targetHoursPercent) : null;
    const sollHours = computeSollHours(date.getUTCFullYear(), date.getUTCMonth(), pct);
    const istHours = istByEmployee.get(emp.id) ?? 0;
    const deltaHours = sollHours != null ? Math.round((istHours - sollHours) * 100) / 100 : null;

    return {
      id: emp.id,
      firstName: emp.firstName,
      lastName: emp.lastName,
      status: emp.status,
      contractType: emp.contractType,
      qualificationTags: emp.qualificationTags,
      qualifications: emp.qualifications.map((q) => ({
        id: q.id,
        abbreviation: q.abbreviation,
        name: q.name,
      })),
      assignedStations: emp.assignedStations,
      targetHoursPercent: pct,
      targetHours: emp.targetHours != null ? Number(emp.targetHours) : null,
      targetHoursPeriod: emp.targetHoursPeriod,
      allowedShiftProfileIds: emp.allowedShiftProfiles.map((p) => p.id),
      preferredShiftTypes: emp.preferredShiftTypes,
      isFullTimeBl: emp.isFullTimeBl,
      fixedWorkingDays: emp.fixedWorkingDays,
      maxConsecutiveDays: (emp as unknown as { maxConsecutiveDays?: number | null }).maxConsecutiveDays ?? null,
      istHours: Math.round(istHours * 100) / 100,
      sollHours: sollHours != null ? Math.round(sollHours * 100) / 100 : null,
      deltaHours,
      hasAssignmentOnDate: assignedOnDate.has(emp.id),
    };
  });

  return NextResponse.json({ employees: result, workingDays });
}
