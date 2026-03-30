import PDFDocument from "pdfkit";
import type { Schedule } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import type { AssignmentWithRelations } from "@/lib/export/scheduleExportContext";
import { eachIsoDateInPeriod } from "@/lib/export/exportDateRange";
import {
  buildAssignmentByEmpDay,
  buildExportSections,
  employeeExportName,
  exportMatrixCellText,
  formatHours,
  plannedHoursByEmployee,
  targetHoursForPeriod,
  uniqueEmployeesFromAssignments,
  workingDaysInIsoRange,
} from "@/lib/export/scheduleExportMatrix";

function collectPdfBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

export async function buildSchedulePdfBuffer(
  schedule: Schedule,
  assignments: AssignmentWithRelations[],
): Promise<Buffer> {
  const doc = new PDFDocument({
    margin: 40,
    size: "A4",
    layout: "landscape",
    info: {
      Title: `Dienstplan ${toIsoDateOnly(schedule.periodStart)} – ${toIsoDateOnly(schedule.periodEnd)}`,
    },
  });

  const dates = eachIsoDateInPeriod(schedule.periodStart, schedule.periodEnd);
  const workDays = workingDaysInIsoRange(dates);
  const byEmpDay = buildAssignmentByEmpDay(assignments);
  const plannedMap = plannedHoursByEmployee(assignments);
  const allEmployees = uniqueEmployeesFromAssignments(assignments);
  const sections = buildExportSections(allEmployees, assignments);

  const pageW = doc.page.width;
  const margin = 40;
  const contentW = pageW - margin * 2;
  const nameW = Math.min(118, contentW * 0.22);
  const stdW = 52;
  const dayCount = Math.max(1, dates.length);
  const dayW = Math.max(11, (contentW - nameW - stdW) / dayCount);
  const rowH = 11;
  const headerH = 12;
  const pageBottom = doc.page.height - margin;
  const title = `Dienstplan ${toIsoDateOnly(schedule.periodStart)} – ${toIsoDateOnly(schedule.periodEnd)}`;
  const sub = `Status: ${schedule.status} · ${assignments.length} Zuweisungen`;

  let y = margin;
  doc.fontSize(14).font("Helvetica-Bold").text(title, margin, y);
  y += 18;
  doc.fontSize(9).font("Helvetica").fillColor("#444").text(sub, margin, y);
  y += 16;
  doc.fillColor("#000");

  const tableWidth = nameW + stdW + dayW * dates.length;

  const drawHeaderRow = (yy: number): number => {
    let x = margin;
    doc.fontSize(6.5).font("Helvetica-Bold");
    doc.text("Mitarbeiter", x, yy, { width: nameW, lineBreak: false });
    x += nameW;
    doc.text("Ist/Soll", x, yy, { width: stdW, align: "center", lineBreak: false });
    x += stdW;
    doc.font("Helvetica");
    for (let i = 0; i < dates.length; i++) {
      const iso = dates[i]!;
      const day = iso.slice(8);
      doc.text(day, x, yy, { width: dayW, align: "center", lineBreak: false });
      x += dayW;
    }
    return yy + headerH;
  };

  const dataRowHeight = (emp: (typeof allEmployees)[0]) => {
    const planned = plannedMap.get(emp.id) ?? 0;
    const target = targetHoursForPeriod(emp, workDays);
    return target != null && target > 0 ? rowH + 7 : rowH;
  };

  const drawDataRow = (yy: number, emp: (typeof allEmployees)[0]): number => {
    let x = margin;
    doc.fontSize(6).font("Helvetica");
    doc.text(truncate(employeeExportName(emp), 42), x, yy, { width: nameW, lineBreak: false });
    x += nameW;
    const planned = plannedMap.get(emp.id) ?? 0;
    const target = targetHoursForPeriod(emp, workDays);
    const stdLine1 =
      target == null ? formatHours(planned) : `${formatHours(planned)}/${formatHours(target)}`;
    const stdLine2 =
      target != null && target > 0 ? `(${Math.round((planned / target) * 100)}%)` : "";
    doc.text(stdLine1, x, yy, { width: stdW, align: "center", lineBreak: false });
    if (stdLine2) {
      doc.text(stdLine2, x, yy + 5, { width: stdW, align: "center", lineBreak: false });
    }
    x += stdW;
    for (let i = 0; i < dates.length; i++) {
      const iso = dates[i]!;
      const a = byEmpDay.get(`${emp.id}|${iso}`);
      const cell = truncate(exportMatrixCellText(emp, a), 14);
      doc.text(cell, x, yy, { width: dayW, align: "center", lineBreak: false });
      x += dayW;
    }
    return yy + dataRowHeight(emp);
  };

  for (const section of sections) {
    if (y > pageBottom - 48) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 40 });
      y = margin;
    }
    doc.fontSize(10).font("Helvetica-Bold").text(section.title, margin, y);
    y += 14;
    doc.font("Helvetica");
    y = drawHeaderRow(y);
    doc.moveTo(margin, y - 2).lineTo(margin + tableWidth, y - 2).strokeColor("#ccc").lineWidth(0.5).stroke();
    doc.strokeColor("#000").lineWidth(1);

    for (const emp of section.employees) {
      const need = dataRowHeight(emp) + 2;
      if (y + need > pageBottom) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 40 });
        y = margin;
        doc.fontSize(10).font("Helvetica-Bold").text(`${section.title} (Forts.)`, margin, y);
        y += 14;
        doc.font("Helvetica");
        y = drawHeaderRow(y);
        doc.moveTo(margin, y - 2).lineTo(margin + tableWidth, y - 2).strokeColor("#ccc").lineWidth(0.5).stroke();
        doc.strokeColor("#000").lineWidth(1);
      }
      y = drawDataRow(y, emp);
    }
    y += 14;
  }

  if (sections.length === 0) {
    doc.fontSize(10).text("Keine Mitarbeiter in Station 1–3 oder Nacht für diesen Plan.", margin, y);
  }

  return collectPdfBuffer(doc);
}
