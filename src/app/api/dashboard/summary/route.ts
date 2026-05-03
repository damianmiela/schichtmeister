import { NextResponse } from "next/server";
import { EmployeeStatus } from "@prisma/client";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

/* ── date helpers ── */

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function localToday(): Date {
  const n = new Date();
  return utcDate(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function initials(firstName: string, lastName: string): string {
  return ((firstName[0] ?? "") + (lastName[0] ?? "")).toUpperCase().slice(0, 2) || "?";
}

/* ── route ── */

export async function GET() {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const facilityId = session!.user.facilityId;
  const today = localToday();
  const weekEnd = addDays(today, 6); // today + 6 days = 7 day window

  /* ── parallel queries ── */
  const [
    employees,
    schedules,
    staffingReqs,
    weekAssignments,
  ] = await Promise.all([
    prisma.employee.findMany({
      where: { facilityId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        status: true,
        assignedStations: true,
        absences: {
          where: {
            startDate: { lte: weekEnd },
            endDate: { gte: today },
          },
          select: { type: true, startDate: true, endDate: true },
        },
      },
    }),
    prisma.schedule.findMany({
      where: {
        facilityId,
        periodStart: { lte: weekEnd },
        periodEnd: { gte: today },
      },
      orderBy: { periodStart: "desc" },
    }),
    prisma.staffingRequirement.findMany({
      where: { facilityId },
    }),
    prisma.assignment.findMany({
      where: {
        date: { gte: today, lte: weekEnd },
        schedule: { facilityId },
      },
      include: {
        shiftProfile: { select: { shiftType: true, name: true } },
        employee: { select: { firstName: true, lastName: true, assignedStations: true } },
      },
    }) as unknown as Promise<Array<{
      id: string; scheduleId: string; date: Date; shiftProfileId: string | null;
      employeeId: string; stationNumber: number | null; dayStatus: string | null;
      shiftProfile: { shiftType: string; name: string };
      employee: { firstName: string; lastName: string; mainStation: number | null; assignedStations: number[] };
    }>>,
  ]);

  /* ── employee counts ── */
  const ABSENT_STATUSES = new Set<string>([
    EmployeeStatus.KRANK,
    EmployeeStatus.LANGZEITKRANK,
    EmployeeStatus.URLAUB,
    EmployeeStatus.MUTTERSCHUTZ,
    EmployeeStatus.KUR,
  ]);

  let activeCount = 0;
  let absentCount = 0;
  const absentEmployees: { name: string; status: string; returnDate?: string }[] = [];
  for (const emp of employees) {
    if (emp.status === EmployeeStatus.INACTIVE) continue;
    if (ABSENT_STATUSES.has(emp.status)) {
      absentCount++;
      const latestAbsence = emp.absences
        .filter((a) => a.endDate >= today)
        .sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0];
      absentEmployees.push({
        name: `${emp.lastName}, ${emp.firstName}`,
        status: emp.status,
        returnDate: latestAbsence ? isoDate(addDays(latestAbsence.endDate, 1)) : undefined,
      });
    } else {
      activeCount++;
    }
  }

  /* ── schedule info ── */
  const currentSchedule =
    schedules.find((s) => s.periodStart <= today && s.periodEnd >= today) ??
    null;

  /* ── staffing requirements by shiftType+station ── */
  type ReqKey = string;
  const reqMap = new Map<ReqKey, number>(); // per-station reqs: "EARLY|1" etc.
  let nightRequired = 0; // facility-wide night requirement
  for (const r of staffingReqs) {
    if (r.isFacilityWide) {
      // facility-wide (typically NIGHT)
      nightRequired += r.minTotalCount;
    } else {
      const key = `${r.shiftType}|${r.stationNumber}`;
      reqMap.set(key, (reqMap.get(key) ?? 0) + r.minTotalCount);
    }
  }

  /* ── today's staffing by station ── */
  const todayIso = isoDate(today);
  const todayAssignments = weekAssignments.filter(
    (a) => isoDate(a.date) === todayIso && a.scheduleId === currentSchedule?.id,
  );

  type StationShift = {
    shiftType: string;
    shiftTypeLabel: string;
    assigned: number;
    required: number;
    employees: { initials: string; name: string }[];
  };

  type StationData = {
    station: number;
    label: string;
    shifts: StationShift[];
  };

  const stationNumbers = [1, 2, 3];
  const shiftOrder = ["EARLY", "LATE", "NIGHT"];

  const todayStations: StationData[] = stationNumbers.map((st) => {
    const shifts: StationShift[] = shiftOrder.map((shiftType) => {
      const matching = todayAssignments.filter((a) => {
        if (a.shiftProfile?.shiftType !== shiftType) return false;
        const aStation = a.stationNumber ?? a.employee.mainStation ?? (a.employee.assignedStations?.length === 1 ? a.employee.assignedStations[0] : null);
        if (shiftType === "NIGHT") return true; // night is facility-wide, counted separately
        return aStation === st;
      });

      // For night, only count in station 0 (facility-wide)
      if (shiftType === "NIGHT") {
        return {
          shiftType,
          shiftTypeLabel: shiftTypeLabel(shiftType),
          assigned: 0,
          required: 0,
          employees: [],
        };
      }

      const reqKey = `${shiftType}|${st}`;
      const required = reqMap.get(reqKey) ?? 0;

      return {
        shiftType,
        shiftTypeLabel: shiftTypeLabel(shiftType),
        assigned: matching.length,
        required,
        employees: matching.map((a) => ({
          initials: initials(a.employee.firstName, a.employee.lastName),
          name: `${a.employee.firstName} ${a.employee.lastName}`.trim(),
        })),
      };
    }).filter((s) => s.shiftType !== "NIGHT");

    return { station: st, label: `Station ${st}`, shifts };
  });

  // Night shifts (facility-wide)
  const nightAssignments = todayAssignments.filter((a) => a.shiftProfile?.shiftType === "NIGHT");
  const todayNight = {
    shiftType: "NIGHT",
    shiftTypeLabel: shiftTypeLabel("NIGHT"),
    assigned: nightAssignments.length,
    required: nightRequired,
    employees: nightAssignments.map((a) => ({
      initials: initials(a.employee.firstName, a.employee.lastName),
      name: `${a.employee.firstName} ${a.employee.lastName}`.trim(),
    })),
  };

  /* ── coverage % ── */
  const totalRequired = todayStations.reduce(
    (s, st) => s + st.shifts.reduce((ss, sh) => ss + sh.required, 0), 0,
  ) + nightRequired;
  const totalAssigned = todayStations.reduce(
    (s, st) => s + st.shifts.reduce((ss, sh) => ss + sh.assigned, 0), 0,
  ) + nightAssignments.length;
  const coveragePct = totalRequired > 0
    ? Math.min(100, Math.round((totalAssigned / totalRequired) * 100))
    : totalAssigned > 0 ? 100 : null;

  /* ── 7-day preview ── */
  type DayPreview = {
    date: string;
    weekday: string;
    isToday: boolean;
    stations: Record<number, { early: number; late: number }>;
    night: number;
    totalAssigned: number;
    totalRequired: number;
  };

  const weekDays: DayPreview[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    const dIso = isoDate(d);
    const dayAssignments = weekAssignments.filter(
      (a) => isoDate(a.date) === dIso &&
        (currentSchedule ? a.scheduleId === currentSchedule.id : true),
    );

    const stations: Record<number, { early: number; late: number }> = {};
    let nightCount = 0;
    let dayTotalReq = 0;

    for (const st of stationNumbers) {
      const early = dayAssignments.filter((a) => {
        if (a.shiftProfile?.shiftType !== "EARLY") return false;
        const aStation = a.stationNumber ?? a.employee.mainStation ?? (a.employee.assignedStations?.length === 1 ? a.employee.assignedStations[0] : null);
        return aStation === st;
      }).length;
      const late = dayAssignments.filter((a) => {
        if (a.shiftProfile?.shiftType !== "LATE") return false;
        const aStation = a.stationNumber ?? a.employee.mainStation ?? (a.employee.assignedStations?.length === 1 ? a.employee.assignedStations[0] : null);
        return aStation === st;
      }).length;
      stations[st] = { early, late };

      dayTotalReq += (reqMap.get(`EARLY|${st}`) ?? 0) + (reqMap.get(`LATE|${st}`) ?? 0);
    }

    nightCount = dayAssignments.filter((a) => a.shiftProfile?.shiftType === "NIGHT").length;
    dayTotalReq += nightRequired;

    const wd = d.toLocaleDateString("de-DE", { weekday: "short", timeZone: "UTC" });

    weekDays.push({
      date: dIso,
      weekday: wd,
      isToday: i === 0,
      stations,
      night: nightCount,
      totalAssigned: Object.values(stations).reduce((s, v) => s + v.early + v.late, 0) + nightCount,
      totalRequired: dayTotalReq,
    });
  }

  return NextResponse.json({
    activeCount,
    absentCount,
    absentEmployees: absentEmployees.slice(0, 8),
    coveragePct,
    todayLabel: todayIso,
    totalAssignmentsToday: todayAssignments.filter((a) => !a.dayStatus).length,
    schedule: currentSchedule
      ? {
          id: currentSchedule.id,
          periodStart: isoDate(currentSchedule.periodStart),
          periodEnd: isoDate(currentSchedule.periodEnd),
        }
      : null,
    todayStations,
    todayNight,
    weekPreview: weekDays,
  });
}
