import type { ContractType, ShiftType, TargetHoursPeriod } from "@prisma/client";

export type EmployeeShiftProfilePayload = {
  id: string;
  name: string;
  shiftType: string;
  targetHoursPercent: number;
  contractType: ContractType;
};

export type EmployeeRowPayload = {
  id: string;
  firstName: string;
  lastName: string;
  contractType: ContractType;
  targetHours: number | null;
  targetHoursPeriod: TargetHoursPeriod | null;
  miniJobMaxMonthlyHours: number | null;
  shiftProfile: EmployeeShiftProfilePayload | null;
  qualificationTags: string[];
  preferredShiftTypes: ShiftType[];
  createdAt: string;
};

type ShiftProfileSlice = {
  id: string;
  name: string;
  shiftType: string;
  targetHoursPercent: { toString(): string } | number;
  contractType: ContractType;
};

export function serializeEmployee(
  e: {
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
    shiftProfile?: ShiftProfileSlice | null;
  },
): EmployeeRowPayload {
  return {
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    contractType: e.contractType,
    targetHours: e.targetHours != null ? Number(e.targetHours) : null,
    targetHoursPeriod: e.targetHoursPeriod,
    miniJobMaxMonthlyHours:
      e.miniJobMaxMonthlyHours != null ? Number(e.miniJobMaxMonthlyHours) : null,
    shiftProfile:
      e.shiftProfile != null
        ? {
            id: e.shiftProfile.id,
            name: e.shiftProfile.name,
            shiftType: e.shiftProfile.shiftType,
            targetHoursPercent: Number(e.shiftProfile.targetHoursPercent),
            contractType: e.shiftProfile.contractType,
          }
        : null,
    qualificationTags: e.qualificationTags,
    preferredShiftTypes: e.preferredShiftTypes,
    createdAt: e.createdAt.toISOString(),
  };
}
