import { NextResponse } from "next/server";
import { ScheduleStatus, SwapStatus, WishStatus } from "@prisma/client";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

function dateUtcFromLocalCalendar(y: number, month: number, day: number): Date {
  return new Date(Date.UTC(y, month - 1, day));
}

function localTodayUtcDate(): Date {
  const n = new Date();
  return dateUtcFromLocalCalendar(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

function localMondaySundayUtc(): { mon: Date; sun: Date } {
  const n = new Date();
  const day = n.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monCal = new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset);
  const sunCal = new Date(monCal);
  sunCal.setDate(monCal.getDate() + 6);
  const mon = dateUtcFromLocalCalendar(
    monCal.getFullYear(),
    monCal.getMonth() + 1,
    monCal.getDate(),
  );
  const sun = dateUtcFromLocalCalendar(
    sunCal.getFullYear(),
    sunCal.getMonth() + 1,
    sunCal.getDate(),
  );
  return { mon, sun };
}

function initials(firstName: string, lastName: string): string {
  const a = (firstName[0] ?? "").toUpperCase();
  const b = (lastName[0] ?? "").toUpperCase();
  return (a + b).slice(0, 3) || "?";
}

export async function GET() {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const facilityId = session!.user.facilityId;
  const todayDate = localTodayUtcDate();
  const { mon, sun } = localMondaySundayUtc();
  const todayDow = new Date().getDay();

  const [
    employeeCount,
    openWishCount,
    openSwapCount,
    draftScheduleCount,
    publishedScheduleCount,
    assignmentsThisWeek,
    overlappingSchedules,
    staffingToday,
    recentWishes,
  ] = await Promise.all([
    prisma.employee.count({ where: { facilityId } }),
    prisma.wish.count({
      where: {
        status: WishStatus.OPEN,
        employee: { facilityId },
      },
    }),
    prisma.swapRequest.count({
      where: {
        status: SwapStatus.REQUESTED,
        fromAssignment: { schedule: { facilityId } },
      },
    }),
    prisma.schedule.count({
      where: { facilityId, status: ScheduleStatus.DRAFT },
    }),
    prisma.schedule.count({
      where: { facilityId, status: ScheduleStatus.PUBLISHED },
    }),
    prisma.assignment.count({
      where: {
        date: { gte: mon, lte: sun },
        schedule: { facilityId },
      },
    }),
    prisma.schedule.findMany({
      where: {
        facilityId,
        periodStart: { lte: todayDate },
        periodEnd: { gte: todayDate },
      },
      orderBy: { periodStart: "desc" },
    }),
    prisma.staffingRequirement.findMany({
      where: { facilityId, dayOfWeek: todayDow },
    }),
    prisma.wish.findMany({
      where: { employee: { facilityId } },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: [{ createdAt: "desc" }],
      take: 8,
    }),
  ]);

  const requiredByType: Record<string, number> = {};
  for (const r of staffingToday) {
    requiredByType[r.shiftType] = (requiredByType[r.shiftType] ?? 0) + r.minStaffCount;
  }

  const todaySchedule =
    overlappingSchedules.find((s) => s.status === ScheduleStatus.PUBLISHED) ??
    overlappingSchedules[0] ??
    null;

  let todayShifts: {
    shiftType: string;
    shiftTypeLabel: string;
    required: number;
    assigned: number;
    employees: { initials: string; name: string }[];
  }[] = [];

  if (todaySchedule) {
    const assigns = await prisma.assignment.findMany({
      where: { scheduleId: todaySchedule.id, date: todayDate },
      include: { employee: true, shiftProfile: true },
    });

    const byType = new Map<
      string,
      { assigned: number; employees: { initials: string; name: string }[] }
    >();
    for (const a of assigns) {
      const t = a.shiftProfile.shiftType;
      const cur = byType.get(t) ?? { assigned: 0, employees: [] };
      cur.assigned += 1;
      cur.employees.push({
        initials: initials(a.employee.firstName, a.employee.lastName),
        name: `${a.employee.firstName} ${a.employee.lastName}`.trim(),
      });
      byType.set(t, cur);
    }

    const types = new Set([...Object.keys(requiredByType), ...byType.keys()]);
    todayShifts = [...types].sort().map((shiftType) => {
      const req = requiredByType[shiftType] ?? 0;
      const g = byType.get(shiftType) ?? { assigned: 0, employees: [] };
      return {
        shiftType,
        shiftTypeLabel: shiftTypeLabel(shiftType),
        required: req,
        assigned: g.assigned,
        employees: g.employees,
      };
    });
  }

  let coveragePct: number | null = null;
  if (todayShifts.length > 0) {
    const reqSum = todayShifts.reduce((s, x) => s + x.required, 0);
    const assSum = todayShifts.reduce((s, x) => s + x.assigned, 0);
    if (reqSum > 0) coveragePct = Math.min(100, Math.round((assSum / reqSum) * 100));
    else if (assSum > 0) coveragePct = 100;
    else coveragePct = null;
  }

  return NextResponse.json({
    employeeCount,
    openWishCount,
    openSwapCount,
    draftScheduleCount,
    publishedScheduleCount,
    assignmentsThisWeek,
    coveragePct,
    todayLabel: todayDate.toISOString().slice(0, 10),
    todayShifts,
    recentWishes: recentWishes.map((w) => ({
      id: w.id,
      employeeName: `${w.employee.firstName} ${w.employee.lastName}`.trim(),
      date: w.date.toISOString().slice(0, 10),
      shiftType: w.shiftType,
      priority: w.priority,
      status: w.status,
    })),
  });
}
