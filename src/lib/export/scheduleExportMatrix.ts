import type { Employee, ShiftProfile } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import type { AssignmentWithRelations } from "@/lib/export/scheduleExportContext";

const EMP_STATUS_MAP: Record<string, string> = {
  KRANK: "K",
  LANGZEITKRANK: "LZ",
  MUTTERSCHUTZ: "MS",
  URLAUB: "U",
  KUR: "KU",
};

const FULL_TIME_DAILY_HOURS = 8;
const AVG_WORKING_DAYS_PER_MONTH = 21.75;

export function formatHours(h: number): string {
  return h % 1 === 0 ? String(h) : h.toFixed(1);
}

export function paidHoursForShift(profile: ShiftProfile): number {
  const [sh, sm] = profile.startTime.split(":").map(Number);
  const [eh, em] = profile.endTime.split(":").map(Number);
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return Math.max(0, (endMin - startMin - profile.breakMinutes) / 60);
}

export function workingDaysInIsoRange(isoDates: string[]): number {
  let count = 0;
  for (const iso of isoDates) {
    const parts = iso.split("-").map(Number);
    const y = parts[0]!;
    const m = parts[1]!;
    const d = parts[2]!;
    const dow = new Date(y, m - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

export function targetHoursForPeriod(emp: Employee, workDays: number): number | null {
  if (emp.targetHours == null) return null;
  const pct =
    emp.targetHoursPercent != null && Number(emp.targetHoursPercent) > 0
      ? Number(emp.targetHoursPercent) / 100
      : null;
  if (pct != null) {
    return pct * FULL_TIME_DAILY_HOURS * workDays;
  }
  if (emp.targetHoursPeriod === "WEEKLY") {
    return (Number(emp.targetHours) / 5) * workDays;
  }
  return Number(emp.targetHours) * (workDays / AVG_WORKING_DAYS_PER_MONTH);
}

export function employeeContractPercentLabel(emp: Employee): string {
  const n = emp.targetHoursPercent != null ? Number(emp.targetHoursPercent) : 100;
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

export function employeeExportName(emp: Employee): string {
  return `${emp.lastName}, ${emp.firstName} (${employeeContractPercentLabel(emp)}%)`;
}

export function buildAssignmentByEmpDay(
  assignments: AssignmentWithRelations[],
): Map<string, AssignmentWithRelations> {
  const m = new Map<string, AssignmentWithRelations>();
  for (const a of assignments) {
    m.set(`${a.employeeId}|${toIsoDateOnly(a.date)}`, a);
  }
  return m;
}

export function plannedHoursByEmployee(
  assignments: AssignmentWithRelations[],
): Map<string, number> {
  const hours = new Map<string, number>();
  for (const a of assignments) {
    if (a.dayStatus) continue;
    hours.set(a.employeeId, (hours.get(a.employeeId) ?? 0) + paidHoursForShift(a.shiftProfile));
  }
  return hours;
}

export function uniqueEmployeesFromAssignments(
  assignments: AssignmentWithRelations[],
): Employee[] {
  const map = new Map<string, Employee>();
  for (const a of assignments) map.set(a.employeeId, a.employee);
  return [...map.values()];
}

export function sortEmployeesByName(emps: Employee[]): Employee[] {
  return [...emps].sort((a, b) => {
    const ln = a.lastName.localeCompare(b.lastName, "de");
    return ln !== 0 ? ln : a.firstName.localeCompare(b.firstName, "de");
  });
}

export function groupEmployeesByStation(employees: Employee[]): Record<1 | 2 | 3, Employee[]> {
  const grouped: Record<number, Employee[]> = { 1: [], 2: [], 3: [] };
  for (const emp of employees) {
    const station = emp.assignedStationNumber ?? 0;
    if (station >= 1 && station <= 3) grouped[station]!.push(emp);
  }
  return grouped as Record<1 | 2 | 3, Employee[]>;
}

export function getNightEmployees(
  employees: Employee[],
  assignments: AssignmentWithRelations[],
): Employee[] {
  const nightIds = new Set<string>();
  for (const a of assignments) {
    if (a.shiftProfile.shiftType === "NIGHT") nightIds.add(a.employeeId);
  }
  return employees.filter((e) => nightIds.has(e.id));
}

export function exportMatrixCellText(
  emp: Employee,
  assignment: AssignmentWithRelations | undefined,
): string {
  if (emp.status && emp.status !== "ACTIVE" && EMP_STATUS_MAP[emp.status]) {
    return EMP_STATUS_MAP[emp.status]!;
  }
  if (!assignment) return "X";
  const primary = assignment.dayStatus ? assignment.dayStatus : assignment.shiftProfile.name;
  const mark = [assignment.markingRow2, assignment.markingRow3].filter(Boolean);
  if (mark.length) return `${primary} (${mark.join(", ")})`;
  return primary;
}

export function hoursColumnText(emp: Employee, planned: number, workDays: number): string {
  const target = targetHoursForPeriod(emp, workDays);
  if (target == null) {
    return formatHours(planned);
  }
  const completionPct = target > 0 ? Math.round((planned / target) * 100) : 0;
  return `${formatHours(planned)}/${formatHours(target)}\n(${completionPct}%)`;
}

export function buildExportSections(
  allEmployees: Employee[],
  assignments: AssignmentWithRelations[],
): { title: string; employees: Employee[] }[] {
  const byStation = groupEmployeesByStation(allEmployees);
  const night = getNightEmployees(allEmployees, assignments);
  return [
    { title: "Station 1", employees: sortEmployeesByName(byStation[1]) },
    { title: "Station 2", employees: sortEmployeesByName(byStation[2]) },
    { title: "Station 3", employees: sortEmployeesByName(byStation[3]) },
    { title: "Nacht (gesamtes Gebäude)", employees: sortEmployeesByName(night) },
  ].filter((s) => s.employees.length > 0);
}

function excelColumnLetter(index1Based: number): string {
  let letter = "";
  let i = index1Based;
  while (i > 0) {
    const mod = (i - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    i = Math.floor((i - 1) / 26);
  }
  return letter;
}

export function matrixLastColumnLetter(dateCount: number): string {
  return excelColumnLetter(2 + dateCount);
}
