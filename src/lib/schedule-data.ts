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
