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

export type RuleContext = {
  periodStart: Date;
  periodEnd: Date;
  assignments: AssignmentInput[];
  employeesById: Map<string, EmployeeInput>;
  profilesById: Map<string, ShiftProfileInput>;
  staffingRequirements: StaffingRequirementInput[];
  wishes: WishInput[];
  snapshot: PlanningRulesSnapshot;
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

export type RuleFn = (ctx: RuleContext) => RuleResult;

export type RuleSeverity = "hard" | "soft";

export type RuleScope = "employee" | "day" | "global";

export type RuleDescriptor = {
  id: string;
  severity: RuleSeverity;
  scope: RuleScope;
  description: string;
};
