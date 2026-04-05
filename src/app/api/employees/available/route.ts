import { NextRequest, NextResponse } from "next/server";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { parseIsoDateOnly, toIsoDateOnly } from "@/lib/api/dateOnly";
import { assignmentPaidHours } from "@/lib/planning/time";
import { computeSollHours, isWorkingDayIso } from "@/lib/holidays";

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

  const ABSENCE_STATUSES = new Set(["K", "U"]);

  // Build per-employee hour totals for the month (skip K/U absence assignments)
  const istByEmployee = new Map<string, number>();
  const absenceWorkDaysByEmployee = new Map<string, number>();
  const assignedOnDate = new Set<string>();

  for (const a of assignments) {
    const aIso = toIsoDateOnly(a.date);
    if (aIso === dateKey) {
      assignedOnDate.add(a.employeeId);
    }

    // K/U absence records don't count toward Ist; only count working days for Soll reduction
    if (a.dayStatus && ABSENCE_STATUSES.has(a.dayStatus)) {
      if (isWorkingDayIso(aIso)) {
        absenceWorkDaysByEmployee.set(
          a.employeeId,
          (absenceWorkDaysByEmployee.get(a.employeeId) ?? 0) + 1,
        );
      }
      continue;
    }

    const prof = profilesById.get(a.shiftProfileId);
    if (!prof) continue;

    const hours = assignmentPaidHours(a.date, prof.startTime, prof.endTime, prof.breakMinutes);
    istByEmployee.set(a.employeeId, (istByEmployee.get(a.employeeId) ?? 0) + hours);
  }

  const result = employees.map((emp) => {
    const pct = emp.targetHoursPercent != null ? Number(emp.targetHoursPercent) : null;
    const sollHours = computeSollHours(date.getUTCFullYear(), date.getUTCMonth(), pct);
    // Absence working days count as "worked" → add to Ist (keep Soll unchanged)
    const absWorkDays = absenceWorkDaysByEmployee.get(emp.id) ?? 0;
    const effectivePct = pct ?? 100;
    const absenceHours = absWorkDays * 8 * (effectivePct / 100);
    const istHours = (istByEmployee.get(emp.id) ?? 0) + absenceHours;
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
      mainStation: (emp as unknown as { mainStation?: number | null }).mainStation ?? null,
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

  return NextResponse.json({ employees: result });
}
