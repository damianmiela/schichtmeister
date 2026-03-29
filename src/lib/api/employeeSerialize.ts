import type { ContractType, ShiftType, TargetHoursPeriod } from "@prisma/client";

export type EmployeeWorkProfilePayload = {
  id: string;
  name: string;
};

export type EmployeeRowPayload = {
  id: string;
  firstName: string;
  lastName: string;
  contractType: ContractType;
  targetHours: number | null;
  targetHoursPeriod: TargetHoursPeriod | null;
  miniJobMaxMonthlyHours: number | null;
  targetHoursPercent: number | null;
  assignedStationNumber: number | null;
  workProfile: EmployeeWorkProfilePayload | null;
  qualificationTags: string[];
  preferredShiftTypes: ShiftType[];
  createdAt: string;
};

type WorkProfileSlice = {
  id: string;
  name: string;
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
    targetHoursPercent: { toString(): string } | null | number | undefined;
    assignedStationNumber?: number | null;
    qualificationTags: string[];
    preferredShiftTypes: ShiftType[];
    createdAt: Date;
    workProfile?: WorkProfileSlice | null;
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
    targetHoursPercent:
      e.targetHoursPercent != null && e.targetHoursPercent !== undefined
        ? Number(e.targetHoursPercent)
        : null,
    assignedStationNumber: e.assignedStationNumber ?? null,
    workProfile:
      e.workProfile != null
        ? { id: e.workProfile.id, name: e.workProfile.name }
        : null,
    qualificationTags: e.qualificationTags,
    preferredShiftTypes: e.preferredShiftTypes,
    createdAt: e.createdAt.toISOString(),
  };
}
