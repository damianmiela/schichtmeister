import PDFDocument from "pdfkit";
import type { Schedule } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import type { AssignmentWithRelations } from "@/lib/export/scheduleExportContext";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

function collectPdfBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

export async function buildSchedulePdfBuffer(
  schedule: Schedule,
  assignments: AssignmentWithRelations[],
): Promise<Buffer> {
  const doc = new PDFDocument({
    margin: 48,
    size: "A4",
    info: {
      Title: `Dienstplan ${toIsoDateOnly(schedule.periodStart)} – ${toIsoDateOnly(schedule.periodEnd)}`,
    },
  });

  const title = `Dienstplan ${toIsoDateOnly(schedule.periodStart)} – ${toIsoDateOnly(schedule.periodEnd)}`;
  const sub = `Status: ${schedule.status} · ${assignments.length} Zuweisungen`;

  doc.fontSize(16).text(title, { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#444").text(sub);
  doc.moveDown(1);
  doc.fillColor("#000");

  doc.fontSize(9);
  const lineH = 13;
  const pageBottom = 780;
  let y = doc.y;

  const header = "Datum        Mitarbeiter                          Schicht        Zeit";
  doc.font("Helvetica-Bold").text(header, 48, y);
  y += lineH + 4;
  doc.font("Helvetica");

  for (const a of assignments) {
    const name = `${a.employee.lastName}, ${a.employee.firstName}`.slice(0, 36);
    const row = `${toIsoDateOnly(a.date)}   ${name.padEnd(36)} ${shiftTypeLabel(a.shiftProfile.shiftType).slice(0, 12).padEnd(12)} ${a.shiftProfile.startTime}–${a.shiftProfile.endTime}`;
    if (y > pageBottom) {
      doc.addPage();
      y = 48;
    }
    doc.text(row, 48, y, { lineBreak: false });
    y += lineH;
  }

  return collectPdfBuffer(doc);
}
