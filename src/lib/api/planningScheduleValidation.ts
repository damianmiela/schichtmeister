import type { Prisma, PrismaClient } from "@prisma/client";
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
};

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

  const absences: AbsenceInput[] = absenceRows.map((a) => ({
    employeeId: a.employeeId,
    startDate: a.startDate,
    endDate: a.endDate,
    type: a.type,
  }));

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
  };

  registerBuiltInPlanningRules();

  const { errors, warnings } = options?.ruleScope
    ? runScopedRules(ctx, options.ruleScope)
    : runAllRules(ctx);

  return { ok: true, result: { errors, warnings } };
}
