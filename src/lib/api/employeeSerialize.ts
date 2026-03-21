import type { ContractType, ShiftType, TargetHoursPeriod } from "@prisma/client";

export type EmployeeRowPayload = {
  id: string;
  firstName: string;
  lastName: string;
  contractType: ContractType;
  targetHours: number | null;
  targetHoursPeriod: TargetHoursPeriod | null;
  miniJobMaxMonthlyHours: number | null;
  qualificationTags: string[];
  preferredShiftTypes: ShiftType[];
  createdAt: string;
};

export function serializeEmployee(e: {
  id: string;
  firstName: string;
  lastName: string;
  contractType: ContractType;
  targetHours: { toString(): string } | null;
  targetHoursPeriod: TargetHoursPeriod | null;
  miniJobMaxMonthlyHours: { toString(): string } | null;
  qualificationTags: string[];
  preferredShiftTypes: ShiftType[];
  createdAt: Date;
}): EmployeeRowPayload {
  return {
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    contractType: e.contractType,
    targetHours: e.targetHours != null ? Number(e.targetHours) : null,
    targetHoursPeriod: e.targetHoursPeriod,
    miniJobMaxMonthlyHours:
      e.miniJobMaxMonthlyHours != null ? Number(e.miniJobMaxMonthlyHours) : null,
    qualificationTags: e.qualificationTags,
    preferredShiftTypes: e.preferredShiftTypes,
    createdAt: e.createdAt.toISOString(),
  };
}
