export type ScheduleJson = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  publishedAt: string | null;
};

export type AssignmentJson = {
  id: string;
  scheduleId: string;
  date: string;
  shiftProfileId: string;
  employeeId: string;
};

export type EmployeeJson = {
  id: string;
  firstName: string;
  lastName: string;
  qualificationTags?: string[];
  targetHours?: number | null;
  targetHoursPeriod?: string | null;
  contractType?: string;
};

export type ShiftProfileJson = {
  id: string;
  name: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  isActive: boolean;
};

export type StaffingJson = {
  id: string;
  shiftType: string;
  minTotalCount: number;
  qualificationRequirements: { id: string; qualificationTag: string; minCount: number }[];
};
