import type { ContractType, EmployeeStatus, ShiftType, TargetHoursPeriod } from "@prisma/client";

export type EmployeeWorkProfilePayload = {
  id: string;
  name: string;
};

export type QualificationPayload = {
  id: string;
  name: string;
  abbreviation: string;
};

export type AllowedShiftProfilePayload = {
  id: string;
  name: string;
  shiftType: ShiftType;
};

export type EmployeeRowPayload = {
  id: string;
  firstName: string;
  lastName: string;
  contractType: ContractType;
  status: EmployeeStatus;
  targetHours: number | null;
  targetHoursPeriod: TargetHoursPeriod | null;
  miniJobMaxMonthlyHours: number | null;
  targetHoursPercent: number | null;
  assignedStationNumber: number | null;
  workProfile: EmployeeWorkProfilePayload | null;
  qualificationTags: string[];
  qualifications: QualificationPayload[];
  allowedShiftProfiles: AllowedShiftProfilePayload[];
  preferredShiftTypes: ShiftType[];
  createdAt: string;
};

type WorkProfileSlice = {
  id: string;
  name: string;
};

type QualificationSlice = { id: string; name: string; abbreviation: string };
type AllowedProfileSlice = { id: string; name: string; shiftType: ShiftType };

export function serializeEmployee(
  e: {
    id: string;
    firstName: string;
    lastName: string;
    contractType: ContractType;
    status: EmployeeStatus;
    targetHours: { toString(): string } | null;
    targetHoursPeriod: TargetHoursPeriod | null;
    miniJobMaxMonthlyHours: { toString(): string } | null;
    targetHoursPercent: { toString(): string } | null | number | undefined;
    assignedStationNumber?: number | null;
    qualificationTags: string[];
    qualifications?: QualificationSlice[];
    allowedShiftProfiles?: AllowedProfileSlice[];
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
    status: e.status,
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
    qualifications: (e.qualifications ?? []).map((q) => ({
      id: q.id,
      name: q.name,
      abbreviation: q.abbreviation,
    })),
    allowedShiftProfiles: (e.allowedShiftProfiles ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      shiftType: p.shiftType,
    })),
    preferredShiftTypes: e.preferredShiftTypes,
    createdAt: e.createdAt.toISOString(),
  };
}
