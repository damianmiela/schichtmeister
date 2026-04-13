import type { Prisma } from "@prisma/client";
import { type PrismaClient } from "@prisma/client";
import { mergePlanningRules } from "@/lib/planning/merge";
import { defaultPlanningRulesConfig } from "@/lib/planning/defaultConfig";
import { registerBuiltInPlanningRules } from "@/lib/planning/registerBuiltInRules";
import { runAllRules, runScopedRules } from "@/lib/planning/registry";
import type {
  AbsenceInput,
  AssignmentInput,
  EmployeeInput,
  RuleContext,
  RuleMessage,
  RuleScope,
  ShiftProfileInput,
  StaffingRequirementInput,
} from "@/lib/planning/types";
import { isDateWithinPeriodInclusive } from "@/lib/api/dateOnly";

export type PlanningValidationResult = {
  errors: RuleMessage[];
  warnings: RuleMessage[];
};

type DbSubset = Pick<
  PrismaClient,
  "facility" | "employee" | "shiftProfile" | "staffingRequirement" | "employeeAbsence"
>;

/** Use `prisma` or a transaction client — same model delegates. */
export type ScheduleValidationDb = DbSubset;

function buildEmployeeInput(e: {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  contractType: EmployeeInput["contractType"];
  miniJobMaxMonthlyHours: Prisma.Decimal | null;
  qualificationTags: string[];
  targetHoursPercent?: Prisma.Decimal | null;
  allowedShiftProfiles?: { id: string }[];
  maxConsecutiveDays?: number | null;
}): EmployeeInput {
  return {
    id: e.id,
    contractType: e.contractType,
    miniJobMaxMonthlyHours:
      e.miniJobMaxMonthlyHours != null ? Number(e.miniJobMaxMonthlyHours) : null,
    qualificationTags: e.qualificationTags,
    targetHoursPercent: e.targetHoursPercent != null ? Number(e.targetHoursPercent) : null,
    allowedShiftProfileIds: e.allowedShiftProfiles?.map((p) => p.id),
    maxConsecutiveDays: e.maxConsecutiveDays ?? null,
    displayName: `${e.firstName} ${e.lastName}`,
    status: e.status,
  };
}

function buildProfileInput(p: {
  id: string;
  shiftType: ShiftProfileInput["shiftType"];
  startTime: string;
  endTime: string;
  breakMinutes: number;
}): ShiftProfileInput {
  return {
    id: p.id,
    shiftType: p.shiftType,
    startTime: p.startTime,
    endTime: p.endTime,
    breakMinutes: p.breakMinutes,
  };
}

export type ValidateScheduleAssignmentsOptions = {
  ruleScope?: RuleScope;
  extraAbsences?: AbsenceInput[];
};

const BOUNDARY_DAYS = 7;

/**
 * Load the last `BOUNDARY_DAYS` days of assignments from the previous month's
 * schedule.  Used by rules that need cross-month context (consecutive days,
 * rest between shifts, alternating weekends).
 */
async function loadBoundaryAssignments(
  db: ScheduleValidationDb & Pick<PrismaClient, "schedule" | "assignment">,
  facilityId: string,
  periodStart: Date,
): Promise<AssignmentInput[]> {
  // Find the previous month's schedule
  const prevSchedule = await (db as unknown as PrismaClient).schedule.findFirst({
    where: {
      facilityId,
      periodEnd: { lt: periodStart },
    },
    orderBy: { periodEnd: "desc" },
  });

  if (!prevSchedule) return [];

  // Load last BOUNDARY_DAYS of assignments from that schedule
  const cutoff = new Date(periodStart);
  cutoff.setUTCDate(cutoff.getUTCDate() - BOUNDARY_DAYS);

  const rows = await (db as unknown as PrismaClient).assignment.findMany({
    where: {
      scheduleId: prevSchedule.id,
      date: { gte: cutoff, lt: periodStart },
      dayStatus: null,  // exclude absence markers
    },
  });

  return rows.map((a: { id: string; date: Date; shiftProfileId: string; employeeId: string; stationNumber: number | null }) => ({
    id: a.id,
    date: a.date,
    shiftProfileId: a.shiftProfileId,
    employeeId: a.employeeId,
    ...(a.stationNumber != null && a.stationNumber >= 1 && a.stationNumber <= 3 && { stationNumber: a.stationNumber }),
  } as AssignmentInput));
}

export async function validateScheduleAssignments(
  db: ScheduleValidationDb,
  facilityId: string,
  schedule: { periodStart: Date; periodEnd: Date },
  assignments: AssignmentInput[],
  options?: ValidateScheduleAssignmentsOptions,
): Promise<
  | { ok: true; result: PlanningValidationResult }
  | { ok: false; error: string; status: number }
> {
  const facility = await db.facility.findUnique({ where: { id: facilityId } });
  if (!facility) {
    return { ok: false, error: "Einrichtung nicht gefunden", status: 404 };
  }

  const [employees, profiles, staffingRows, absenceRows] = await Promise.all([
    db.employee.findMany({ where: { facilityId }, include: { allowedShiftProfiles: { select: { id: true } } } }),
    db.shiftProfile.findMany({ where: { facilityId } }),
    db.staffingRequirement.findMany({
      where: { facilityId },
      include: { qualificationRequirements: true },
    }),
    db.employeeAbsence.findMany({
      where: {
        employee: { facilityId },
        startDate: { lte: schedule.periodEnd },
        endDate: { gte: schedule.periodStart },
      },
    }),
  ]);

  const employeesById = new Map<string, EmployeeInput>();
  for (const e of employees) {
    employeesById.set(e.id, buildEmployeeInput(e));
  }
  const profilesById = new Map<string, ShiftProfileInput>();
  for (const p of profiles) {
    profilesById.set(p.id, buildProfileInput(p));
  }

  for (const a of assignments) {
    if (
      !isDateWithinPeriodInclusive(a.date, schedule.periodStart, schedule.periodEnd)
    ) {
      return {
        ok: false,
        error: "Zuweisungsdatum liegt außerhalb der Planungsperiode.",
        status: 400,
      };
    }
    if (!employeesById.has(a.employeeId)) {
      return {
        ok: false,
        error: "Mitarbeiter gehört nicht zur Einrichtung oder existiert nicht.",
        status: 400,
      };
    }
    if (!profilesById.has(a.shiftProfileId)) {
      return {
        ok: false,
        error: "Schichtprofil gehört nicht zur Einrichtung oder existiert nicht.",
        status: 400,
      };
    }
  }

  const staffingRequirements: StaffingRequirementInput[] = staffingRows.map((r) => ({
    shiftType: r.shiftType,
    stationNumber: r.stationNumber,
    minTotalCount: r.minTotalCount,
    maxTotalCount: r.maxTotalCount,
    isFacilityWide: r.isFacilityWide,
    qualificationRequirements: r.qualificationRequirements.map((q) => ({
      qualificationTag: q.qualificationTag,
      minCount: q.minCount,
    })),
  }));

  const snapshot = mergePlanningRules(facility, defaultPlanningRulesConfig);

  // Load boundary assignments from the previous month for cross-month rules
  const boundaryAssignments = await loadBoundaryAssignments(
    db as unknown as ScheduleValidationDb & Pick<PrismaClient, "schedule" | "assignment">,
    facilityId,
    schedule.periodStart,
  );

  const absences: AbsenceInput[] = [
    ...absenceRows.map((a) => ({
      employeeId: a.employeeId,
      startDate: a.startDate,
      endDate: a.endDate,
      type: a.type,
    })),
    ...(options?.extraAbsences ?? []),
  ];

  const ctx: RuleContext = {
    periodStart: schedule.periodStart,
    periodEnd: schedule.periodEnd,
    assignments,
    employeesById,
    profilesById,
    staffingRequirements,
    wishes: [],
    snapshot,
    absences,
    boundaryAssignments,
  };

  registerBuiltInPlanningRules();

  const { errors, warnings } = options?.ruleScope
    ? runScopedRules(ctx, options.ruleScope)
    : runAllRules(ctx);

  return { ok: true, result: { errors, warnings } };
}
