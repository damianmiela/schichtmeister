// Dummy data for schedule views

export const STATIONS = [
  { id: "station-1", name: "Station 1" },
  { id: "station-2", name: "Station 2" },
  { id: "station-3", name: "Station 3" },
] as const;

export const SHIFTS = [
  { id: "early", name: "Früh", time: "06:00-14:30", color: "#ff9800" },
  { id: "late", name: "Spät", time: "14:00-22:00", color: "#2196f3" },
  { id: "night", name: "Nacht", time: "21:30-06:30", color: "#9c27b0" },
] as const;

export type StationId = (typeof STATIONS)[number]["id"];
export type ShiftId = (typeof SHIFTS)[number]["id"];

export interface StaffingData {
  assigned: number;
  required: number;
}

export interface DayShiftData {
  [stationId: string]: StaffingData;
}

export interface DayData {
  early: DayShiftData;
  late: DayShiftData;
  night: DayShiftData;
}

// Generate dummy staffing data for a day
export function generateDayData(dayOffset: number): DayData {
  // Use dayOffset to create some variation
  const seed = dayOffset % 7;
  const isWeekend = seed >= 5;

  return {
    early: {
      "station-1": { assigned: isWeekend ? 4 : 6, required: 6 },
      "station-2": { assigned: isWeekend ? 3 : 5, required: 5 },
      "station-3": { assigned: isWeekend ? 4 : 4 + (seed % 2), required: 5 },
    },
    late: {
      "station-1": { assigned: isWeekend ? 3 : 5, required: 5 },
      "station-2": { assigned: 4, required: 4 },
      "station-3": { assigned: isWeekend ? 3 : 4, required: 4 },
    },
    night: {
      "station-1": { assigned: 2, required: 2 },
      "station-2": { assigned: seed === 3 ? 1 : 2, required: 2 },
      "station-3": { assigned: 2, required: 2 },
    },
  };
}

// Get staffing status color
export function getStaffingStatus(
  assigned: number,
  required: number
): "success" | "warning" | "error" {
  if (assigned >= required) return "success";
  if (assigned >= required - 1) return "warning";
  return "error";
}

// Get aggregated staffing for all stations
export function getAggregatedStaffing(shiftData: DayShiftData): StaffingData {
  return Object.values(shiftData).reduce(
    (acc, station) => ({
      assigned: acc.assigned + station.assigned,
      required: acc.required + station.required,
    }),
    { assigned: 0, required: 0 }
  );
}

// Employee dummy data for detailed views
export const EMPLOYEES = [
  { id: "1", name: "Maria Müller", initials: "MM", station: "station-1" },
  { id: "2", name: "Thomas Schmidt", initials: "TS", station: "station-1" },
  { id: "3", name: "Anna Weber", initials: "AW", station: "station-1" },
  { id: "4", name: "Michael Fischer", initials: "MF", station: "station-1" },
  { id: "5", name: "Sandra Becker", initials: "SB", station: "station-1" },
  { id: "6", name: "Klaus Wagner", initials: "KW", station: "station-1" },
  { id: "7", name: "Julia Hoffmann", initials: "JH", station: "station-2" },
  { id: "8", name: "Peter Schulz", initials: "PS", station: "station-2" },
  { id: "9", name: "Lisa Braun", initials: "LB", station: "station-2" },
  { id: "10", name: "Stefan Meyer", initials: "SM", station: "station-2" },
  { id: "11", name: "Karin Richter", initials: "KR", station: "station-2" },
  { id: "12", name: "Frank Neumann", initials: "FN", station: "station-3" },
  { id: "13", name: "Eva Klein", initials: "EK", station: "station-3" },
  { id: "14", name: "Hans Wolf", initials: "HW", station: "station-3" },
  { id: "15", name: "Monika Schwarz", initials: "MS", station: "station-3" },
  { id: "16", name: "Ralf Zimmermann", initials: "RZ", station: "station-3" },
];

// Get employees for a station and shift (dummy assignment)
export function getShiftEmployees(
  stationId: string,
  shiftId: string,
  dayOffset: number
) {
  const stationEmployees = EMPLOYEES.filter((e) => e.station === stationId);
  const seed = (dayOffset + shiftId.length) % stationEmployees.length;
  const count =
    shiftId === "night" ? 2 : shiftId === "early" ? 5 : 4;
  return stationEmployees.slice(seed, seed + count);
}

// Calendar helper functions
export function getMonthWeeks(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  
  // Get Monday of the first week
  const startDate = new Date(firstDay);
  const dayOfWeek = startDate.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  startDate.setDate(startDate.getDate() + diff);

  const weeks: { weekNumber: number; days: Date[] }[] = [];
  const currentDate = new Date(startDate);

  while (currentDate <= lastDay || weeks.length < 5) {
    const weekDays: Date[] = [];
    const weekNumber = getWeekNumber(currentDate);

    for (let i = 0; i < 7; i++) {
      weekDays.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    weeks.push({ weekNumber, days: weekDays });

    if (currentDate > lastDay && weeks.length >= 4) break;
  }

  return weeks;
}

export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// Timeline constants for DayView
export const TIMELINE_START_HOUR = 5; // 05:00
export const TIMELINE_END_HOUR = 24; // midnight (shown as 24:00)
export const TIMELINE_HOURS = Array.from(
  { length: TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1 },
  (_, i) => TIMELINE_START_HOUR + i
);

// Shift type colors for timeline
export const SHIFT_COLORS = {
  early: { bg: "#ff9800", light: "#fff3e0", text: "#e65100" },
  late: { bg: "#2196f3", light: "#e3f2fd", text: "#0d47a1" },
  night: { bg: "#9c27b0", light: "#f3e5f5", text: "#4a148c" },
} as const;

// Individual employee shift assignment for timeline view
export interface TimelineShift {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeInitials: string;
  stationId: string;
  shiftType: "early" | "late" | "night";
  startTime: string; // "HH:MM" format
  endTime: string; // "HH:MM" format
}

// Generate timeline shifts for a specific day
export function generateTimelineShifts(dayOffset: number): TimelineShift[] {
  const seed = dayOffset % 7;
  const isWeekend = seed >= 5;

  const shifts: TimelineShift[] = [];

  // Station 1 - Early shifts with variations
  if (!isWeekend || seed === 5) {
    shifts.push(
      { id: "s1-e1", employeeId: "1", employeeName: "Maria Müller", employeeInitials: "MM", stationId: "station-1", shiftType: "early", startTime: "06:00", endTime: "14:30" },
      { id: "s1-e2", employeeId: "2", employeeName: "Thomas Schmidt", employeeInitials: "TS", stationId: "station-1", shiftType: "early", startTime: "06:00", endTime: "14:30" },
      { id: "s1-e3", employeeId: "3", employeeName: "Anna Weber", employeeInitials: "AW", stationId: "station-1", shiftType: "early", startTime: "06:30", endTime: "15:00" },
      { id: "s1-e4", employeeId: "4", employeeName: "Michael Fischer", employeeInitials: "MF", stationId: "station-1", shiftType: "early", startTime: "07:00", endTime: "12:00" },
    );
  }
  if (!isWeekend) {
    shifts.push(
      { id: "s1-e5", employeeId: "5", employeeName: "Sandra Becker", employeeInitials: "SB", stationId: "station-1", shiftType: "early", startTime: "06:00", endTime: "14:30" },
      { id: "s1-e6", employeeId: "6", employeeName: "Klaus Wagner", employeeInitials: "KW", stationId: "station-1", shiftType: "early", startTime: "08:00", endTime: "14:00" },
    );
  }

  // Station 1 - Late shifts
  shifts.push(
    { id: "s1-l1", employeeId: "1", employeeName: "Maria Müller", employeeInitials: "MM", stationId: "station-1", shiftType: "late", startTime: "14:00", endTime: "22:00" },
    { id: "s1-l2", employeeId: "2", employeeName: "Thomas Schmidt", employeeInitials: "TS", stationId: "station-1", shiftType: "late", startTime: "14:00", endTime: "22:00" },
    { id: "s1-l3", employeeId: "3", employeeName: "Anna Weber", employeeInitials: "AW", stationId: "station-1", shiftType: "late", startTime: "15:00", endTime: "22:00" },
  );
  if (!isWeekend) {
    shifts.push(
      { id: "s1-l4", employeeId: "4", employeeName: "Michael Fischer", employeeInitials: "MF", stationId: "station-1", shiftType: "late", startTime: "16:00", endTime: "22:00" },
      { id: "s1-l5", employeeId: "5", employeeName: "Sandra Becker", employeeInitials: "SB", stationId: "station-1", shiftType: "late", startTime: "14:00", endTime: "20:00" },
    );
  }

  // Station 1 - Night shifts
  shifts.push(
    { id: "s1-n1", employeeId: "6", employeeName: "Klaus Wagner", employeeInitials: "KW", stationId: "station-1", shiftType: "night", startTime: "21:30", endTime: "24:00" },
    { id: "s1-n2", employeeId: "7", employeeName: "Julia Hoffmann", employeeInitials: "JH", stationId: "station-1", shiftType: "night", startTime: "21:30", endTime: "24:00" },
  );

  // Station 2 - Early shifts
  shifts.push(
    { id: "s2-e1", employeeId: "8", employeeName: "Peter Schulz", employeeInitials: "PS", stationId: "station-2", shiftType: "early", startTime: "06:00", endTime: "14:30" },
    { id: "s2-e2", employeeId: "9", employeeName: "Lisa Braun", employeeInitials: "LB", stationId: "station-2", shiftType: "early", startTime: "06:00", endTime: "12:30" },
    { id: "s2-e3", employeeId: "10", employeeName: "Stefan Meyer", employeeInitials: "SM", stationId: "station-2", shiftType: "early", startTime: "07:00", endTime: "15:00" },
  );
  if (!isWeekend) {
    shifts.push(
      { id: "s2-e4", employeeId: "11", employeeName: "Karin Richter", employeeInitials: "KR", stationId: "station-2", shiftType: "early", startTime: "06:00", endTime: "14:30" },
      { id: "s2-e5", employeeId: "12", employeeName: "Frank Neumann", employeeInitials: "FN", stationId: "station-2", shiftType: "early", startTime: "08:00", endTime: "14:00" },
    );
  }

  // Station 2 - Late shifts
  shifts.push(
    { id: "s2-l1", employeeId: "8", employeeName: "Peter Schulz", employeeInitials: "PS", stationId: "station-2", shiftType: "late", startTime: "14:00", endTime: "22:00" },
    { id: "s2-l2", employeeId: "9", employeeName: "Lisa Braun", employeeInitials: "LB", stationId: "station-2", shiftType: "late", startTime: "13:00", endTime: "21:00" },
    { id: "s2-l3", employeeId: "10", employeeName: "Stefan Meyer", employeeInitials: "SM", stationId: "station-2", shiftType: "late", startTime: "15:00", endTime: "22:00" },
    { id: "s2-l4", employeeId: "11", employeeName: "Karin Richter", employeeInitials: "KR", stationId: "station-2", shiftType: "late", startTime: "14:00", endTime: "22:00" },
  );

  // Station 2 - Night shifts (understaffed on certain days)
  if (seed !== 3) {
    shifts.push(
      { id: "s2-n1", employeeId: "12", employeeName: "Frank Neumann", employeeInitials: "FN", stationId: "station-2", shiftType: "night", startTime: "21:30", endTime: "24:00" },
      { id: "s2-n2", employeeId: "13", employeeName: "Eva Klein", employeeInitials: "EK", stationId: "station-2", shiftType: "night", startTime: "21:30", endTime: "24:00" },
    );
  } else {
    // Understaffed - only 1 person
    shifts.push(
      { id: "s2-n1", employeeId: "12", employeeName: "Frank Neumann", employeeInitials: "FN", stationId: "station-2", shiftType: "night", startTime: "21:30", endTime: "24:00" },
    );
  }

  // Station 3 - Early shifts
  shifts.push(
    { id: "s3-e1", employeeId: "14", employeeName: "Hans Wolf", employeeInitials: "HW", stationId: "station-3", shiftType: "early", startTime: "06:00", endTime: "14:30" },
    { id: "s3-e2", employeeId: "15", employeeName: "Monika Schwarz", employeeInitials: "MS", stationId: "station-3", shiftType: "early", startTime: "06:00", endTime: "14:30" },
    { id: "s3-e3", employeeId: "16", employeeName: "Ralf Zimmermann", employeeInitials: "RZ", stationId: "station-3", shiftType: "early", startTime: "06:30", endTime: "13:00" },
  );
  if (!isWeekend && seed % 2 === 0) {
    shifts.push(
      { id: "s3-e4", employeeId: "1", employeeName: "Maria Müller", employeeInitials: "MM", stationId: "station-3", shiftType: "early", startTime: "09:00", endTime: "14:00" },
    );
  }

  // Station 3 - Late shifts
  shifts.push(
    { id: "s3-l1", employeeId: "14", employeeName: "Hans Wolf", employeeInitials: "HW", stationId: "station-3", shiftType: "late", startTime: "14:00", endTime: "22:00" },
    { id: "s3-l2", employeeId: "15", employeeName: "Monika Schwarz", employeeInitials: "MS", stationId: "station-3", shiftType: "late", startTime: "14:00", endTime: "22:00" },
    { id: "s3-l3", employeeId: "16", employeeName: "Ralf Zimmermann", employeeInitials: "RZ", stationId: "station-3", shiftType: "late", startTime: "14:30", endTime: "21:00" },
  );
  if (!isWeekend) {
    shifts.push(
      { id: "s3-l4", employeeId: "2", employeeName: "Thomas Schmidt", employeeInitials: "TS", stationId: "station-3", shiftType: "late", startTime: "16:00", endTime: "22:00" },
    );
  }

  // Station 3 - Night shifts
  shifts.push(
    { id: "s3-n1", employeeId: "13", employeeName: "Eva Klein", employeeInitials: "EK", stationId: "station-3", shiftType: "night", startTime: "21:30", endTime: "24:00" },
    { id: "s3-n2", employeeId: "14", employeeName: "Hans Wolf", employeeInitials: "HW", stationId: "station-3", shiftType: "night", startTime: "22:00", endTime: "24:00" },
  );

  return shifts;
}

// Helper to convert "HH:MM" time to hours (decimal)
export function timeToHours(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours + minutes / 60;
}

// Helper to get shifts for a specific station
export function getStationTimelineShifts(
  shifts: TimelineShift[],
  stationId: string
): TimelineShift[] {
  return shifts.filter((s) => s.stationId === stationId);
}

// Get unique employees for a station's timeline
export function getStationEmployees(
  shifts: TimelineShift[],
  stationId: string
): { id: string; name: string; initials: string }[] {
  const stationShifts = shifts.filter((s) => s.stationId === stationId);
  const uniqueEmployees = new Map<string, { id: string; name: string; initials: string }>();

  for (const shift of stationShifts) {
    if (!uniqueEmployees.has(shift.employeeId)) {
      uniqueEmployees.set(shift.employeeId, {
        id: shift.employeeId,
        name: shift.employeeName,
        initials: shift.employeeInitials,
      });
    }
  }

  return Array.from(uniqueEmployees.values());
}
