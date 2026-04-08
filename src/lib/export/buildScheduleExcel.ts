import ExcelJS from "exceljs";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import type { Schedule } from "@prisma/client";
import { eachIsoDateInPeriod } from "@/lib/export/exportDateRange";
import type { AssignmentWithRelations } from "@/lib/export/scheduleExportContext";
import {
  buildAssignmentByEmpDay,
  buildExportSections,
  employeeExportName,
  exportMatrixCellText,
  hoursColumnText,
  matrixLastColumnLetter,
  plannedHoursByEmployee,
  uniqueEmployeesFromAssignments,
  workingDaysInIsoRange,
} from "@/lib/export/scheduleExportMatrix";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

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
  meta.getColumn(1).width = 18;
  meta.getColumn(2).width = 40;

  const list = wb.addWorksheet("Zuweisungen", { views: [{ state: "frozen", ySplit: 1 }] });
  list.columns = [
    { header: "Datum", key: "date", width: 12 },
    { header: "Nachname", key: "ln", width: 18 },
    { header: "Vorname", key: "fn", width: 14 },
    { header: "Schichtprofil", key: "profile", width: 22 },
    { header: "Tag-Status", key: "dayStatus", width: 10 },
    { header: "Kennz. 2", key: "m2", width: 8 },
    { header: "Kennz. 3", key: "m3", width: 8 },
    { header: "Station", key: "station", width: 8 },
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
      dayStatus: a.dayStatus ?? "",
      m2: a.markingRow2 ?? "",
      m3: a.markingRow3 ?? "",
      station: a.stationNumber ?? "",
      type: shiftTypeLabel(a.shiftProfile.shiftType),
      from: a.shiftProfile.startTime,
      to: a.shiftProfile.endTime,
    });
  }

  const dates = eachIsoDateInPeriod(schedule.periodStart, schedule.periodEnd);
  const workDays = workingDaysInIsoRange(dates);
  const byEmpDay = buildAssignmentByEmpDay(assignments);
  const plannedMap = plannedHoursByEmployee(assignments);
  const allEmployees = uniqueEmployeesFromAssignments(assignments);
  const sections = buildExportSections(allEmployees, assignments);

  const matrix = wb.addWorksheet("Matrix", { views: [{ state: "frozen", ySplit: 2, xSplit: 2 }] });
  const lastCol = matrixLastColumnLetter(dates.length);
  let row = 1;

  if (sections.length === 0) {
    matrix.getCell(1, 1).value =
      "Keine Mitarbeiter in Station 1–3 oder Nacht für diesen Plan.";
  }

  for (const section of sections) {
    matrix.mergeCells(`A${row}:${lastCol}${row}`);
    const titleCell = matrix.getCell(row, 1);
    titleCell.value = section.title;
    titleCell.font = { bold: true };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };
    row++;

    matrix.getCell(row, 1).value = "Mitarbeiter";
    matrix.getCell(row, 1).font = { bold: true };
    matrix.getCell(row, 2).value = "Ist/Soll";
    matrix.getCell(row, 2).font = { bold: true };
    matrix.getCell(row, 2).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    for (let c = 0; c < dates.length; c++) {
      matrix.getCell(row, c + 3).value = dates[c]!;
      matrix.getCell(row, c + 3).font = { bold: true };
    }
    row++;

    for (const emp of section.employees) {
      matrix.getCell(row, 1).value = employeeExportName(emp);
      const planned = plannedMap.get(emp.id) ?? 0;
      const hCell = matrix.getCell(row, 2);
      hCell.value = hoursColumnText(emp, planned, workDays);
      hCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      for (let c = 0; c < dates.length; c++) {
        const iso = dates[c]!;
        const a = byEmpDay.get(`${emp.id}|${iso}`);
        matrix.getCell(row, c + 3).value = exportMatrixCellText(emp, a);
      }
      row++;
    }

    row++;
  }

  matrix.getColumn(1).width = 28;
  matrix.getColumn(2).width = 14;
  for (let c = 0; c < Math.min(dates.length, 40); c++) {
    matrix.getColumn(c + 3).width = 11;
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
