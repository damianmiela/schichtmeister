export type PreGenEntryJson = {
  employeeId: string;
  type: "shift" | "frei" | "absence";
  date: string;
  shiftProfileId: string;
  stationNumber: number;
  dateFrom: string;
  dateTo: string;
  absenceType: "KRANK" | "URLAUB";
};

export type PreGenWishesJson = {
  shiftWishes: { employeeId: string; date: string }[];
  freiDates: { employeeId: string; date: string }[];
  savedEntries?: PreGenEntryJson[];
};

export type VirtualPlacement = "1" | "2" | "3" | "NIGHT";

export type ScheduleJson = {
  id: string;
  periodStart: string;
  periodEnd: string;
  warnings?: string[];
  preGenWishes?: PreGenWishesJson | null;
  virtualPlacements?: Record<string, VirtualPlacement>;
  currentVersionId?: string | null;
};

export type AssignmentJson = {
  id: string;
  scheduleId: string;
  date: string;
  shiftProfileId: string;
  employeeId: string;
  stationNumber?: number | null;
  markingRow2?: string | null;
  markingRow3?: string | null;
  dayStatus?: string | null;
};

export type EmployeeJson = {
  id: string;
  firstName: string;
  lastName: string;
  status?: string;
  qualificationTags?: string[];
  qualifications?: { id: string; abbreviation: string; name: string; sortOrder: number; color?: string | null }[];
  targetHours?: number | null;
  targetHoursPeriod?: string | null;
  targetHoursPercent?: number | null;
  mainStation?: number | null;
  assignedStations?: number[];
  contractType?: string;
};

export type ShiftProfileJson = {
  id: string;
  name: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  startTime2?: string | null;
  endTime2?: string | null;
  breakMinutes2?: number | null;
  isActive: boolean;
};

export type StaffingJson = {
  id: string;
  shiftType: string;
  stationNumber: number;
  minTotalCount: number;
  maxTotalCount?: number | null;
  isFacilityWide?: boolean;
  qualificationRequirements: { id: string; qualificationTag: string; minCount: number }[];
};
