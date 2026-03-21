import ExcelJS from "exceljs";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import type { Schedule } from "@prisma/client";
import { eachIsoDateInPeriod } from "@/lib/export/exportDateRange";
import type { AssignmentWithRelations } from "@/lib/export/scheduleExportContext";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

function employeeName(e: { firstName: string; lastName: string }) {
  return `${e.lastName}, ${e.firstName}`.trim();
}

export async function buildScheduleExcelBuffer(
  schedule: Schedule,
  assignments: AssignmentWithRelations[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Demo-Einrichtung Dienstplaner";
  wb.created = new Date();

  const meta = wb.addWorksheet("Meta", { views: [{ state: "frozen", ySplit: 1 }] });
  meta.getCell("A1").value = "Zeitraum";
  meta.getCell("B1").value = `${toIsoDateOnly(schedule.periodStart)} – ${toIsoDateOnly(schedule.periodEnd)}`;
  meta.getCell("A2").value = "Status";
  meta.getCell("B2").value = schedule.status;
  meta.getColumn(1).width = 18;
  meta.getColumn(2).width = 40;

  const list = wb.addWorksheet("Zuweisungen", { views: [{ state: "frozen", ySplit: 1 }] });
  list.columns = [
    { header: "Datum", key: "date", width: 12 },
    { header: "Nachname", key: "ln", width: 18 },
    { header: "Vorname", key: "fn", width: 14 },
    { header: "Schichtprofil", key: "profile", width: 22 },
    { header: "Typ", key: "type", width: 10 },
    { header: "Von", key: "from", width: 8 },
    { header: "Bis", key: "to", width: 8 },
  ];
  for (const a of assignments) {
    list.addRow({
      date: toIsoDateOnly(a.date),
      ln: a.employee.lastName,
      fn: a.employee.firstName,
      profile: a.shiftProfile.name,
      type: shiftTypeLabel(a.shiftProfile.shiftType),
      from: a.shiftProfile.startTime,
      to: a.shiftProfile.endTime,
    });
  }

  const dates = eachIsoDateInPeriod(schedule.periodStart, schedule.periodEnd);
  const empOrder = new Map<string, AssignmentWithRelations["employee"]>();
  for (const a of assignments) {
    if (!empOrder.has(a.employeeId)) empOrder.set(a.employeeId, a.employee);
  }
  const employees = [...empOrder.values()].sort((a, b) => {
    const ln = a.lastName.localeCompare(b.lastName, "de");
    if (ln !== 0) return ln;
    return a.firstName.localeCompare(b.firstName, "de");
  });

  const cell = new Map<string, string>();
  for (const a of assignments) {
    cell.set(`${a.employeeId}|${toIsoDateOnly(a.date)}`, a.shiftProfile.name);
  }

  const matrix = wb.addWorksheet("Matrix", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });
  matrix.getCell(1, 1).value = "Mitarbeiter";
  for (let c = 0; c < dates.length; c++) {
    matrix.getCell(1, c + 2).value = dates[c]!;
  }
  for (let r = 0; r < employees.length; r++) {
    const emp = employees[r]!;
    matrix.getCell(r + 2, 1).value = employeeName(emp);
    for (let c = 0; c < dates.length; c++) {
      const iso = dates[c]!;
      matrix.getCell(r + 2, c + 2).value = cell.get(`${emp.id}|${iso}`) ?? "";
    }
  }
  matrix.getColumn(1).width = 24;
  for (let c = 0; c < Math.min(dates.length, 40); c++) {
    matrix.getColumn(c + 2).width = 11;
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
