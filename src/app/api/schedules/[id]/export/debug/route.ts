import { NextResponse } from "next/server";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { loadGenerateContext, type ManualPlacementInput } from "@/lib/schedule/generateDraftSchedule";
import { buildSolverPayload, type SolverPayload, type SolverPreviousAssignment } from "@/lib/schedule/solverClient";
import { mergePlanningRules, type FacilityRulesSlice } from "@/lib/planning/merge";
import { defaultPlanningRulesConfig } from "@/lib/planning/defaultConfig";

type BlockedDateInput = { employeeId: string; date: string };
type AbsenceInput = { employeeId: string; type: "KRANK" | "URLAUB"; startDate: string; endDate: string };

/**
 * Reconstruct manualPlacements / blockedDates / absences from the schedule's
 * preGenWishesJson.savedEntries, the same way the UI does before it POSTs
 * `/generate-stream`.  This makes the Debug JSON export identical in
 * structure to what the live solver actually receives, so offline tooling
 * (solver/scorer) can reproduce production behavior exactly.
 */
function reconstructPreGenInputs(
  preGenWishesJson: string | null,
  profiles: { id: string; shiftType: string }[],
): {
  manualPlacements: ManualPlacementInput[];
  blockedDates: BlockedDateInput[];
  absences: AbsenceInput[];
} {
  const manualPlacements: ManualPlacementInput[] = [];
  const blockedDates: BlockedDateInput[] = [];
  const absences: AbsenceInput[] = [];
  if (!preGenWishesJson) return { manualPlacements, blockedDates, absences };

  let saved: unknown[] = [];
  try {
    const parsed = JSON.parse(preGenWishesJson);
    if (Array.isArray(parsed?.savedEntries)) saved = parsed.savedEntries;
  } catch {
    return { manualPlacements, blockedDates, absences };
  }

  const profType = new Map<string, string>();
  for (const p of profiles) profType.set(p.id, p.shiftType);

  const expand = (empId: string, from: string, to: string): BlockedDateInput[] => {
    const out: BlockedDateInput[] = [];
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    if (!fy || !fm || !fd || !ty || !tm || !td) return out;
    let cur = Date.UTC(fy, fm - 1, fd);
    const end = Date.UTC(ty, tm - 1, td);
    while (cur <= end) {
      out.push({ employeeId: empId, date: new Date(cur).toISOString().slice(0, 10) });
      cur += 24 * 60 * 60 * 1000;
    }
    return out;
  };

  for (const raw of saved) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const empId = typeof e.employeeId === "string" ? e.employeeId : null;
    if (!empId) continue;

    if (e.type === "shift") {
      const date = typeof e.date === "string" ? e.date : null;
      const pid = typeof e.shiftProfileId === "string" ? e.shiftProfileId : null;
      if (!date || !pid) continue;
      const st = profType.get(pid) ?? "EARLY";
      const sn =
        typeof e.stationNumber === "number" && e.stationNumber >= 1 && e.stationNumber <= 3
          ? e.stationNumber
          : undefined;
      manualPlacements.push({
        employeeId: empId,
        date,
        shiftProfileId: pid,
        shiftType: st,
        ...(sn != null ? { stationNumber: sn } : {}),
      });
    } else if (e.type === "frei") {
      const from = typeof e.dateFrom === "string" ? e.dateFrom : null;
      const to = typeof e.dateTo === "string" ? e.dateTo : null;
      if (from && to) blockedDates.push(...expand(empId, from, to));
    } else if (e.type === "absence") {
      const from = typeof e.dateFrom === "string" ? e.dateFrom : null;
      const to = typeof e.dateTo === "string" ? e.dateTo : null;
      if (from && to) {
        blockedDates.push(...expand(empId, from, to));
        const at = e.absenceType === "KRANK" || e.absenceType === "URLAUB" ? e.absenceType : "URLAUB";
        absences.push({ employeeId: empId, type: at, startDate: from, endDate: to });
      }
    }
  }

  return { manualPlacements, blockedDates, absences };
}

export const runtime = "nodejs";

const BOUNDARY_DAYS = 7;

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const facilityId = session!.user.facilityId;
  const { id: scheduleId } = await context.params;

  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, facilityId },
    // NOTE: Include preGenWishesJson so the debug export can reconstruct
    // manualPlacements / blockedDates / absences (the UI keeps these in its
    // own state and sends them as the POST body for /generate-stream).
    // Without this the exported solverPayload had empty wishes / manual
    // placements, which diverged from what the live solver actually sees.
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

  // Load previous month's last 7 days of assignments for cross-month boundary checks
  let previousAssignments: SolverPreviousAssignment[] = [];
  try {
    const prevSchedule = await prisma.schedule.findFirst({
      where: { facilityId, periodEnd: { lt: schedule.periodStart } },
      orderBy: { periodEnd: "desc" },
    });
    if (prevSchedule) {
      const cutoff = new Date(schedule.periodStart);
      cutoff.setUTCDate(cutoff.getUTCDate() - BOUNDARY_DAYS);
      const prevRows = await prisma.assignment.findMany({
        where: { scheduleId: prevSchedule.id, date: { gte: cutoff, lt: schedule.periodStart }, dayStatus: null },
      });
      for (const a of prevRows) {
        if (!a.shiftProfileId) continue; // skip pure absence rows
        previousAssignments.push({
          employeeId: a.employeeId,
          date: toIsoDateOnly(a.date),
          shiftProfileId: a.shiftProfileId,
        });
      }
    }
  } catch {
    previousAssignments = [];
  }

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

  // Reconstruct the UI's pre-generation entries (Dienstwunsch /
  // Frei-Wunsch / Abwesenheit) from preGenWishesJson.savedEntries so the
  // debug export's solverPayload mirrors what the live generate-stream
  // solver actually receives.
  const { manualPlacements, blockedDates, absences: reconstructedAbsences } =
    reconstructPreGenInputs(schedule.preGenWishesJson ?? null, genCtx.profiles);

  let solverPayload: SolverPayload | null = null;
  try {
    solverPayload = buildSolverPayload(
      scheduleId,
      schedule.periodStart,
      schedule.periodEnd,
      genCtx,
      facilitySlice,
      manualPlacements,
      blockedDates,
      reconstructedAbsences,
      previousAssignments,
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
    shiftProfileId: a.shiftProfileId ?? "",
    shiftProfileName: a.shiftProfileId ? (profileNames[a.shiftProfileId] ?? "?") : "(absence)",
    shiftType: a.shiftProfileId ? (profileShiftTypes[a.shiftProfileId] ?? "?") : "ABSENCE",
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
    previousAssignments,
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
