import type { ContractType, ShiftType } from "@prisma/client";

export type PlanningRulesConfig = {
  schemaVersion: number;
  maxConsecutiveNights?: { enabled: boolean };
  rules: Array<{
    id: string;
    enabled: boolean;
    params?: Record<string, unknown>;
  }>;
};

/** Resolved numbers and flags after merging default JSON with `Facility` DB fields. */
export type PlanningRulesSnapshot = {
  schemaVersion: number;
  minRestHours: number;
  miniJobMaxMonthlyHours: number;
  maxConsecutiveNightsEnabled: boolean;
  /** Merged rule entries; later JSON entries with the same `id` override earlier ones. */
  ruleStates: Record<string, { enabled: boolean; params: Record<string, unknown> }>;
};

export type AssignmentInput = {
  id: string;
  date: Date;
  shiftProfileId: string;
  employeeId: string;
};

export type EmployeeInput = {
  id: string;
  contractType: ContractType;
  miniJobMaxMonthlyHours: number | null;
  qualificationTags: string[];
  allowedShiftProfileIds?: string[];
  targetHoursPercent?: number | null;
  maxConsecutiveDays?: number | null;
  /** Employee name for German-language messages (optional, falls back to id). */
  displayName?: string;
  /** Employee status — non-ACTIVE employees are excluded from planning validation. */
  status?: string;
};

export type ShiftProfileInput = {
  id: string;
  shiftType: ShiftType;
  startTime: string;
  endTime: string;
  breakMinutes: number;
};

export type QualificationRequirementInput = {
  qualificationTag: string;
  minCount: number;
  maxCount?: number | null;
};

export type StaffingRequirementInput = {
  shiftType: ShiftType;
  stationNumber: number;
  minTotalCount: number;
  maxTotalCount?: number | null;
  isFacilityWide?: boolean;
  qualificationRequirements: QualificationRequirementInput[];
};

export type WishInput = {
  employeeId: string;
  date: Date;
  shiftType: ShiftType | null;
};

export type AbsenceInput = {
  employeeId: string;
  startDate: Date;
  endDate: Date;
  type: string; // "KRANK" | "URLAUB"
};

/**
 * Optional filter for targeted validation (day-view modal).
 * When set, employee-scoped rules only check the target employee,
 * and day/global rules only check the target date.
 * When absent, all employees/days are checked (month-view).
 */
export type TargetFilter = {
  employeeId: string;
  date: Date;           // the specific day being checked
  shiftProfileId: string;
};

export type RuleContext = {
  periodStart: Date;
  periodEnd: Date;
  assignments: AssignmentInput[];
  employeesById: Map<string, EmployeeInput>;
  profilesById: Map<string, ShiftProfileInput>;
  staffingRequirements: StaffingRequirementInput[];
  wishes: WishInput[];
  snapshot: PlanningRulesSnapshot;
  absences?: AbsenceInput[];
  /** Assignments from the previous month's last ~7 days, used by rules
   *  that need cross-month context (consecutive days, rest, weekends). */
  boundaryAssignments?: AssignmentInput[];
  /** When set, rules should scope their checks to the target only. */
  targetFilter?: TargetFilter;
};

export type RuleMessage = {
  ruleId: string;
  code: string;
  message: string;
  assignmentIds?: string[];
  employeeIds?: string[];
};

export type RuleResult = {
  errors: RuleMessage[];
  warnings: RuleMessage[];
};

/**
 * Statuses that indicate an employee is not plannable and should be
 * excluded from schedule-wide rules (sollDelta, overtimeExcess, etc.).
 * Matches the "Nicht eingeplant" criteria in MonthTableView.
 */
export const NON_PLANNABLE_STATUSES = new Set([
  "INACTIVE",
  "KRANK",
  "LANGZEITKRANK",
  "MUTTERSCHUTZ",
  "URLAUB",
  "KUR",
]);

/** Returns true if the employee should be included in schedule-wide checks. */
export function isPlannable(emp: EmployeeInput): boolean {
  if (emp.status && NON_PLANNABLE_STATUSES.has(emp.status)) return false;
  if (emp.contractType === "AUSBILDUNG") return false;
  return true;
}

export type RuleFn = (ctx: RuleContext) => RuleResult;

export type RuleSeverity = "hard" | "soft";

export type RuleScope = "employee" | "day" | "global";

export type RuleDescriptor = {
  id: string;
  severity: RuleSeverity;
  scope: RuleScope;
  description: string;
};
