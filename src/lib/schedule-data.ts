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

// Employee roles
export type EmployeeRole = "Fachkraft" | "Hilfskraft";

// Employee dummy data for detailed views
// Expanded list to have enough staff for realistic shift coverage (1 shift per person per day)
export const EMPLOYEES = [
  // Station 1 employees (12 people for 3 shifts)
  { id: "1", name: "Maria Müller", initials: "MM", station: "station-1", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "early" },
  { id: "2", name: "Thomas Schmidt", initials: "TS", station: "station-1", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "early" },
  { id: "3", name: "Anna Weber", initials: "AW", station: "station-1", role: "Hilfskraft" as EmployeeRole, hoursContract: 120, shiftPreference: "early" },
  { id: "4", name: "Michael Fischer", initials: "MF", station: "station-1", role: "Fachkraft" as EmployeeRole, hoursContract: 80, shiftPreference: "early" },
  { id: "5", name: "Sandra Becker", initials: "SB", station: "station-1", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "early" },
  { id: "6", name: "Klaus Wagner", initials: "KW", station: "station-1", role: "Hilfskraft" as EmployeeRole, hoursContract: 100, shiftPreference: "early" },
  { id: "7", name: "Julia Hoffmann", initials: "JH", station: "station-1", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "late" },
  { id: "8", name: "Peter Schulz", initials: "PS", station: "station-1", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "late" },
  { id: "9", name: "Sabine Lehmann", initials: "SL", station: "station-1", role: "Hilfskraft" as EmployeeRole, hoursContract: 120, shiftPreference: "late" },
  { id: "10", name: "Werner Krause", initials: "WK", station: "station-1", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "late" },
  { id: "11", name: "Heike Fuchs", initials: "HF", station: "station-1", role: "Hilfskraft" as EmployeeRole, hoursContract: 100, shiftPreference: "late" },
  { id: "12", name: "Bernd Vogel", initials: "BV", station: "station-1", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "night" },
  // Station 2 employees (10 people for 3 shifts)
  { id: "13", name: "Lisa Braun", initials: "LB", station: "station-2", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "early" },
  { id: "14", name: "Stefan Meyer", initials: "SM", station: "station-2", role: "Fachkraft" as EmployeeRole, hoursContract: 80, shiftPreference: "early" },
  { id: "15", name: "Karin Richter", initials: "KR", station: "station-2", role: "Hilfskraft" as EmployeeRole, hoursContract: 120, shiftPreference: "early" },
  { id: "16", name: "Frank Neumann", initials: "FN", station: "station-2", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "early" },
  { id: "17", name: "Eva Klein", initials: "EK", station: "station-2", role: "Hilfskraft" as EmployeeRole, hoursContract: 100, shiftPreference: "early" },
  { id: "18", name: "Markus Bauer", initials: "MB", station: "station-2", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "late" },
  { id: "19", name: "Petra Schäfer", initials: "PS", station: "station-2", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "late" },
  { id: "20", name: "Jürgen Koch", initials: "JK", station: "station-2", role: "Hilfskraft" as EmployeeRole, hoursContract: 120, shiftPreference: "late" },
  { id: "21", name: "Birgit Lang", initials: "BL", station: "station-2", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "late" },
  { id: "22", name: "Uwe Krüger", initials: "UK", station: "station-2", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "night" },
  // Station 3 employees (10 people for 3 shifts)
  { id: "23", name: "Hans Wolf", initials: "HW", station: "station-3", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "early" },
  { id: "24", name: "Monika Schwarz", initials: "MS", station: "station-3", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "early" },
  { id: "25", name: "Ralf Zimmermann", initials: "RZ", station: "station-3", role: "Hilfskraft" as EmployeeRole, hoursContract: 80, shiftPreference: "early" },
  { id: "26", name: "Ingrid Hartmann", initials: "IH", station: "station-3", role: "Fachkraft" as EmployeeRole, hoursContract: 120, shiftPreference: "early" },
  { id: "27", name: "Dieter Lange", initials: "DL", station: "station-3", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "early" },
  { id: "28", name: "Renate König", initials: "RK", station: "station-3", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "late" },
  { id: "29", name: "Günter Beck", initials: "GB", station: "station-3", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "late" },
  { id: "30", name: "Elke Werner", initials: "EW", station: "station-3", role: "Hilfskraft" as EmployeeRole, hoursContract: 100, shiftPreference: "late" },
  { id: "31", name: "Horst Schmitt", initials: "HS", station: "station-3", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "late" },
  { id: "32", name: "Andrea Schulze", initials: "AS", station: "station-3", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "night" },
  // Additional night shift workers (dedicated)
  { id: "33", name: "Gisela Roth", initials: "GR", station: "station-1", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "night" },
  { id: "34", name: "Helga Braun", initials: "HB", station: "station-2", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "night" },
  { id: "35", name: "Karl Richter", initials: "KR", station: "station-3", role: "Fachkraft" as EmployeeRole, hoursContract: 160, shiftPreference: "night" },
];

// Shift codes for the paper-like roster view
export type ShiftCode = "F1" | "F2" | "F3" | "S1" | "S2" | "S3" | "N1" | "N2" | "N3" | "X" | "U" | "";

export interface ShiftCodeInfo {
  code: ShiftCode;
  fullName: string;
  shiftType: "early" | "late" | "night" | "off" | "vacation";
  stationNumber?: number;
  startTime?: string;
  endTime?: string;
}

export const SHIFT_CODE_MAP: Record<ShiftCode, ShiftCodeInfo> = {
  "F1": { code: "F1", fullName: "Früh Station 1", shiftType: "early", stationNumber: 1, startTime: "06:00", endTime: "14:30" },
  "F2": { code: "F2", fullName: "Früh Station 2", shiftType: "early", stationNumber: 2, startTime: "06:00", endTime: "14:30" },
  "F3": { code: "F3", fullName: "Früh Station 3", shiftType: "early", stationNumber: 3, startTime: "06:00", endTime: "14:30" },
  "S1": { code: "S1", fullName: "Spät Station 1", shiftType: "late", stationNumber: 1, startTime: "14:00", endTime: "22:00" },
  "S2": { code: "S2", fullName: "Spät Station 2", shiftType: "late", stationNumber: 2, startTime: "14:00", endTime: "22:00" },
  "S3": { code: "S3", fullName: "Spät Station 3", shiftType: "late", stationNumber: 3, startTime: "14:00", endTime: "22:00" },
  "N1": { code: "N1", fullName: "Nacht Station 1", shiftType: "night", stationNumber: 1, startTime: "21:30", endTime: "06:30" },
  "N2": { code: "N2", fullName: "Nacht Station 2", shiftType: "night", stationNumber: 2, startTime: "21:30", endTime: "06:30" },
  "N3": { code: "N3", fullName: "Nacht Station 3", shiftType: "night", stationNumber: 3, startTime: "21:30", endTime: "06:30" },
  "X": { code: "X", fullName: "Frei", shiftType: "off" },
  "U": { code: "U", fullName: "Urlaub", shiftType: "vacation" },
  "": { code: "", fullName: "", shiftType: "off" },
};

// Background colors for shift codes (subtle, paper-like)
export const SHIFT_CODE_COLORS = {
  early: { bg: "#fff3e0", border: "#ffcc80" },   // Light orange
  late: { bg: "#e3f2fd", border: "#90caf9" },    // Light blue  
  night: { bg: "#f3e5f5", border: "#ce93d8" },   // Light purple
  off: { bg: "#f5f5f5", border: "#e0e0e0" },     // Light grey
  vacation: { bg: "#e8f5e9", border: "#a5d6a7" }, // Light green
};

// Generate monthly roster data for an employee
export interface EmployeeMonthSchedule {
  employeeId: string;
  days: ShiftCode[]; // Array of 31 days (index 0 = day 1)
  hoursPlanned: number;
}

// Generate dummy monthly schedule for all employees
export function generateMonthlyRoster(year: number, month: number): EmployeeMonthSchedule[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const schedules: EmployeeMonthSchedule[] = [];

  for (const employee of EMPLOYEES) {
    const days: ShiftCode[] = [];
    let hoursPlanned = 0;
    const stationNum = employee.station === "station-1" ? 1 : employee.station === "station-2" ? 2 : 3;
    
    // Determine shift code prefix based on preference
    const shiftPrefix = employee.shiftPreference === "early" ? "F" : 
                       employee.shiftPreference === "late" ? "S" : "N";
    const baseShiftCode = `${shiftPrefix}${stationNum}` as ShiftCode;
    
    // Hours per shift type
    const hoursPerShift = employee.shiftPreference === "night" ? 9 : 8.5;
    
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      
      // Create deterministic pattern based on employee id and day
      const seed = (parseInt(employee.id) + day + month) % 10;
      
      let code: ShiftCode;
      
      // Apply some vacation days (U)
      if (seed === 7 && day >= 10 && day <= 17 && parseInt(employee.id) % 5 === 0) {
        code = "U";
      }
      // Free days (X) - weekends and some weekdays
      else if (isWeekend && seed < 5) {
        code = "X";
      }
      else if (!isWeekend && seed === 9) {
        code = "X";
      }
      // Working day
      else {
        code = baseShiftCode;
        hoursPlanned += hoursPerShift;
      }
      
      days.push(code);
    }
    
    // Pad to 31 days if month has fewer days
    while (days.length < 31) {
      days.push("");
    }
    
    schedules.push({
      employeeId: employee.id,
      days,
      hoursPlanned: Math.round(hoursPlanned),
    });
  }
  
  return schedules;
}

// Get employee by ID
export function getEmployeeById(id: string) {
  return EMPLOYEES.find(e => e.id === id);
}

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
// Each employee works only ONE shift per day (realistic scheduling)
export function generateTimelineShifts(dayOffset: number): TimelineShift[] {
  const seed = dayOffset % 7;
  const isWeekend = seed >= 5;

  const shifts: TimelineShift[] = [];

  // ============================================
  // STATION 1 - Frühschicht (Early shift)
  // Required: 6 on weekdays, 4 on weekends
  // Employees: 1-6 are dedicated early shift workers
  // ============================================
  shifts.push(
    { id: "s1-e1", employeeId: "1", employeeName: "Maria Müller", employeeInitials: "MM", stationId: "station-1", shiftType: "early", startTime: "06:00", endTime: "14:30" },
    { id: "s1-e2", employeeId: "2", employeeName: "Thomas Schmidt", employeeInitials: "TS", stationId: "station-1", shiftType: "early", startTime: "06:00", endTime: "14:30" },
    { id: "s1-e3", employeeId: "3", employeeName: "Anna Weber", employeeInitials: "AW", stationId: "station-1", shiftType: "early", startTime: "06:30", endTime: "15:00" },
    { id: "s1-e4", employeeId: "4", employeeName: "Michael Fischer", employeeInitials: "MF", stationId: "station-1", shiftType: "early", startTime: "07:00", endTime: "13:00" },
  );
  if (!isWeekend) {
    shifts.push(
      { id: "s1-e5", employeeId: "5", employeeName: "Sandra Becker", employeeInitials: "SB", stationId: "station-1", shiftType: "early", startTime: "06:00", endTime: "14:30" },
      { id: "s1-e6", employeeId: "6", employeeName: "Klaus Wagner", employeeInitials: "KW", stationId: "station-1", shiftType: "early", startTime: "08:00", endTime: "14:00" },
    );
  }

  // ============================================
  // STATION 1 - Spätschicht (Late shift)
  // Required: 5 on weekdays, 3 on weekends
  // Employees: 7-11 are dedicated late shift workers
  // ============================================
  shifts.push(
    { id: "s1-l1", employeeId: "7", employeeName: "Julia Hoffmann", employeeInitials: "JH", stationId: "station-1", shiftType: "late", startTime: "14:00", endTime: "22:00" },
    { id: "s1-l2", employeeId: "8", employeeName: "Peter Schulz", employeeInitials: "PS", stationId: "station-1", shiftType: "late", startTime: "14:00", endTime: "22:00" },
    { id: "s1-l3", employeeId: "9", employeeName: "Sabine Lehmann", employeeInitials: "SL", stationId: "station-1", shiftType: "late", startTime: "14:30", endTime: "22:00" },
  );
  if (!isWeekend) {
    shifts.push(
      { id: "s1-l4", employeeId: "10", employeeName: "Werner Krause", employeeInitials: "WK", stationId: "station-1", shiftType: "late", startTime: "15:00", endTime: "22:00" },
      { id: "s1-l5", employeeId: "11", employeeName: "Heike Fuchs", employeeInitials: "HF", stationId: "station-1", shiftType: "late", startTime: "14:00", endTime: "20:00" },
    );
  }

  // ============================================
  // STATION 1 - Nachtschicht (Night shift)
  // Required: 2 (understaffed when seed === 2)
  // Employee 12 is dedicated night shift worker
  // ============================================
  shifts.push(
    { id: "s1-n1", employeeId: "12", employeeName: "Bernd Vogel", employeeInitials: "BV", stationId: "station-1", shiftType: "night", startTime: "21:30", endTime: "24:00" },
  );
  if (seed !== 2) {
    // Second night worker available
    shifts.push(
      { id: "s1-n2", employeeId: "33", employeeName: "Gisela Roth", employeeInitials: "GR", stationId: "station-1", shiftType: "night", startTime: "21:30", endTime: "24:00" },
    );
  }
  // seed === 2 means Station 1 night is understaffed (only 1 of 2 required)

  // ============================================
  // STATION 2 - Frühschicht (Early shift)
  // Required: 5 on weekdays, 3 on weekends
  // Employees: 13-17 are dedicated early shift workers
  // ============================================
  shifts.push(
    { id: "s2-e1", employeeId: "13", employeeName: "Lisa Braun", employeeInitials: "LB", stationId: "station-2", shiftType: "early", startTime: "06:00", endTime: "14:30" },
    { id: "s2-e2", employeeId: "14", employeeName: "Stefan Meyer", employeeInitials: "SM", stationId: "station-2", shiftType: "early", startTime: "06:00", endTime: "12:30" },
    { id: "s2-e3", employeeId: "15", employeeName: "Karin Richter", employeeInitials: "KR", stationId: "station-2", shiftType: "early", startTime: "07:00", endTime: "15:00" },
  );
  if (!isWeekend) {
    shifts.push(
      { id: "s2-e4", employeeId: "16", employeeName: "Frank Neumann", employeeInitials: "FN", stationId: "station-2", shiftType: "early", startTime: "06:00", endTime: "14:30" },
      { id: "s2-e5", employeeId: "17", employeeName: "Eva Klein", employeeInitials: "EK", stationId: "station-2", shiftType: "early", startTime: "08:00", endTime: "14:00" },
    );
  }

  // ============================================
  // STATION 2 - Spätschicht (Late shift)
  // Required: 4
  // Employees: 18-21 are dedicated late shift workers
  // ============================================
  shifts.push(
    { id: "s2-l1", employeeId: "18", employeeName: "Markus Bauer", employeeInitials: "MB", stationId: "station-2", shiftType: "late", startTime: "14:00", endTime: "22:00" },
    { id: "s2-l2", employeeId: "19", employeeName: "Petra Schäfer", employeeInitials: "PÖ", stationId: "station-2", shiftType: "late", startTime: "13:00", endTime: "21:00" },
    { id: "s2-l3", employeeId: "20", employeeName: "Jürgen Koch", employeeInitials: "JK", stationId: "station-2", shiftType: "late", startTime: "15:00", endTime: "22:00" },
    { id: "s2-l4", employeeId: "21", employeeName: "Birgit Lang", employeeInitials: "BL", stationId: "station-2", shiftType: "late", startTime: "14:00", endTime: "22:00" },
  );

  // ============================================
  // STATION 2 - Nachtschicht (Night shift)
  // Required: 2 (understaffed when seed === 3)
  // Employees: 22, 34 are dedicated night shift workers
  // ============================================
  shifts.push(
    { id: "s2-n1", employeeId: "22", employeeName: "Uwe Krüger", employeeInitials: "UK", stationId: "station-2", shiftType: "night", startTime: "21:30", endTime: "24:00" },
  );
  if (seed !== 3) {
    shifts.push(
      { id: "s2-n2", employeeId: "34", employeeName: "Helga Braun", employeeInitials: "HB", stationId: "station-2", shiftType: "night", startTime: "21:30", endTime: "24:00" },
    );
  }
  // seed === 3 means Station 2 night is understaffed (only 1 of 2 required)

  // ============================================
  // STATION 3 - Frühschicht (Early shift)
  // Required: 5 on weekdays, 4 on weekends
  // Employees: 23-27 are dedicated early shift workers
  // ============================================
  shifts.push(
    { id: "s3-e1", employeeId: "23", employeeName: "Hans Wolf", employeeInitials: "HW", stationId: "station-3", shiftType: "early", startTime: "06:00", endTime: "14:30" },
    { id: "s3-e2", employeeId: "24", employeeName: "Monika Schwarz", employeeInitials: "MS", stationId: "station-3", shiftType: "early", startTime: "06:00", endTime: "14:30" },
    { id: "s3-e3", employeeId: "25", employeeName: "Ralf Zimmermann", employeeInitials: "RZ", stationId: "station-3", shiftType: "early", startTime: "06:30", endTime: "13:00" },
    { id: "s3-e4", employeeId: "26", employeeName: "Ingrid Hartmann", employeeInitials: "IH", stationId: "station-3", shiftType: "early", startTime: "07:00", endTime: "15:00" },
  );
  if (!isWeekend) {
    shifts.push(
      { id: "s3-e5", employeeId: "27", employeeName: "Dieter Lange", employeeInitials: "DL", stationId: "station-3", shiftType: "early", startTime: "06:00", endTime: "14:30" },
    );
  }

  // ============================================
  // STATION 3 - Spätschicht (Late shift)
  // Required: 4
  // Employees: 28-31 are dedicated late shift workers
  // ============================================
  shifts.push(
    { id: "s3-l1", employeeId: "28", employeeName: "Renate König", employeeInitials: "RK", stationId: "station-3", shiftType: "late", startTime: "14:00", endTime: "22:00" },
    { id: "s3-l2", employeeId: "29", employeeName: "Günter Beck", employeeInitials: "GB", stationId: "station-3", shiftType: "late", startTime: "14:00", endTime: "22:00" },
    { id: "s3-l3", employeeId: "30", employeeName: "Elke Werner", employeeInitials: "EW", stationId: "station-3", shiftType: "late", startTime: "14:30", endTime: "21:00" },
  );
  if (!isWeekend) {
    shifts.push(
      { id: "s3-l4", employeeId: "31", employeeName: "Horst Schmitt", employeeInitials: "HS", stationId: "station-3", shiftType: "late", startTime: "16:00", endTime: "22:00" },
    );
  }

  // ============================================
  // STATION 3 - Nachtschicht (Night shift)
  // Required: 2
  // Employees: 32, 35 are dedicated night shift workers
  // ============================================
  shifts.push(
    { id: "s3-n1", employeeId: "32", employeeName: "Andrea Schulze", employeeInitials: "AS", stationId: "station-3", shiftType: "night", startTime: "21:30", endTime: "24:00" },
    { id: "s3-n2", employeeId: "35", employeeName: "Karl Richter", employeeInitials: "KR", stationId: "station-3", shiftType: "night", startTime: "22:00", endTime: "24:00" },
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
