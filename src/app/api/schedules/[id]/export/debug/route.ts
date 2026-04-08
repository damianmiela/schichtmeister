import { NextResponse } from "next/server";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { loadGenerateContext } from "@/lib/schedule/generateDraftSchedule";
import { buildSolverPayload, type SolverPayload } from "@/lib/schedule/solverClient";
import { mergePlanningRules, type FacilityRulesSlice } from "@/lib/planning/merge";
import { defaultPlanningRulesConfig } from "@/lib/planning/defaultConfig";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const facilityId = session!.user.facilityId;
  const { id: scheduleId } = await context.params;

  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, facilityId },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const [genCtx, facility, employees, assignments, absences] = await Promise.all([
    loadGenerateContext(prisma, facilityId, schedule.periodStart, schedule.periodEnd),
    prisma.facility.findUniqueOrThrow({
      where: { id: facilityId },
      select: { id: true, name: true, minRestHours: true, miniJobMaxMonthlyHours: true, maxSolveTimeSeconds: true, ruleOverridesJson: true },
    }),
    prisma.employee.findMany({
      where: { facilityId },
      select: {
        id: true, firstName: true, lastName: true, status: true,
        contractType: true, isFullTimeBl: true, fixedWorkingDays: true,
        shiftDistribution: true, targetHoursPercent: true, targetHours: true,
        targetHoursPeriod: true,
      },
    }),
    prisma.assignment.findMany({
      where: { scheduleId },
      select: { employeeId: true, date: true, shiftProfileId: true, stationNumber: true },
    }),
    prisma.employeeAbsence.findMany({
      where: {
        employee: { facilityId },
        startDate: { lte: schedule.periodEnd },
        endDate: { gte: schedule.periodStart },
      },
      select: { employeeId: true, startDate: true, endDate: true, type: true },
    }),
  ]);

  const employeeNames: Record<string, string> = {};
  for (const e of employees) {
    employeeNames[e.id] = `${e.firstName} ${e.lastName}`;
  }

  const employeeProfiles: Record<string, object> = {};
  for (const e of employees) {
    employeeProfiles[e.id] = {
      name: `${e.firstName} ${e.lastName}`,
      status: e.status,
      contractType: e.contractType,
      targetHoursPercent: e.targetHoursPercent ? Number(e.targetHoursPercent) : null,
      targetHours: e.targetHours ? Number(e.targetHours) : null,
      targetHoursPeriod: e.targetHoursPeriod,
      isFullTimeBl: e.isFullTimeBl,
      fixedWorkingDays: e.fixedWorkingDays,
      shiftDistribution: e.shiftDistribution,
    };
  }

  const employeeAbsences = absences.map((a) => ({
    employeeId: a.employeeId,
    employeeName: employeeNames[a.employeeId] ?? "?",
    startDate: toIsoDateOnly(a.startDate),
    endDate: toIsoDateOnly(a.endDate),
    type: a.type,
  }));

  const profileNames: Record<string, string> = {};
  const profileShiftTypes: Record<string, string> = {};
  for (const p of genCtx.profiles) {
    profileNames[p.id] = p.name;
    profileShiftTypes[p.id] = p.shiftType;
  }

  const facilitySlice: FacilityRulesSlice = {
    minRestHours: facility.minRestHours,
    miniJobMaxMonthlyHours: facility.miniJobMaxMonthlyHours,
    maxSolveTimeSeconds: facility.maxSolveTimeSeconds,
    ruleOverridesJson: facility.ruleOverridesJson,
  };

  let solverPayload: SolverPayload | null = null;
  try {
    solverPayload = buildSolverPayload(
      scheduleId,
      schedule.periodStart,
      schedule.periodEnd,
      genCtx,
      facilitySlice,
      [],
      [],
    );
  } catch {
    solverPayload = null;
  }

  const snapshot = mergePlanningRules(facilitySlice, defaultPlanningRulesConfig);

  const staffingRequirements = [...genCtx.mergedStaffing.entries()].map(([key, entry]) => ({
    key,
    ...entry,
  }));

  const currentAssignments = assignments.map((a) => ({
    employeeId: a.employeeId,
    employeeName: employeeNames[a.employeeId] ?? "?",
    date: toIsoDateOnly(a.date),
    shiftProfileId: a.shiftProfileId,
    shiftProfileName: profileNames[a.shiftProfileId] ?? "?",
    shiftType: profileShiftTypes[a.shiftProfileId] ?? "?",
    stationNumber: a.stationNumber,
  }));

  const result = {
    exportedAt: new Date().toISOString(),
    schedule: {
      id: schedule.id,
      periodStart: toIsoDateOnly(schedule.periodStart),
      periodEnd: toIsoDateOnly(schedule.periodEnd),
    },
    facility: {
      id: facility.id,
      name: facility.name,
    },
    planningRules: snapshot,
    employeeNames,
    employeeProfiles,
    employeeAbsences,
    profileNames,
    staffingRequirements,
    currentAssignments,
    solverPayload,
  };

  const ps = toIsoDateOnly(schedule.periodStart);
  const pe = toIsoDateOnly(schedule.periodEnd);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `Debug_${ps}_${pe}_${ts}.json`;

  return new NextResponse(JSON.stringify(result, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
