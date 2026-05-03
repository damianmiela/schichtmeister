import PDFDocument from "pdfkit";
import type { Employee, ShiftProfile } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import type { AssignmentWithRelations, ExportBundle } from "@/lib/export/scheduleExportContext";
import { eachIsoDateInPeriod } from "@/lib/export/exportDateRange";
import {
  buildAssignmentByEmpDay,
  employeeContractPercentLabel,
  formatHours,
  paidHoursForShift,
  sortEmployeesByName,
  targetHoursForPeriod,
  workingDaysInIsoRange,
} from "@/lib/export/scheduleExportMatrix";
import { holidayDateMap } from "@/lib/holidays";
import { isWorkingDayIso } from "@/lib/holidays";

/* ── Color constants ── */
const STATUS_BG: Record<string, string> = {
  U: "#e3f2fd", K: "#ffebee", LZ: "#fce4ec", MS: "#f3e5f5", KU: "#fff3e0", SCH: "#e8eaf6",
};
const STATUS_TEXT: Record<string, string> = {
  U: "#1565c0", K: "#c62828", LZ: "#ad1457", MS: "#7b1fa2", KU: "#e65100", SCH: "#283593",
};
const SHIFT_ACCENT: Record<string, string> = {
  EARLY: "#ef6c00", LATE: "#1565c0", NIGHT: "#7e57c2", BL: "#00838f",
};
const STATION_COLORS: Record<number, string> = { 1: "#1565c0", 2: "#2e7d32", 3: "#e65100" };

const WEEKEND_BG = "#f5f5f5";
const HOLIDAY_BG = "#fff0f0";
const GRID_COLOR = "#bdbdbd";
const HEADER_BG = "#e0e0e0";

/* ── Layout: A4 portrait ── */
const MARGIN = 28;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;

/* ── Column widths ── */
const COL_DAY = 24;
const COL_WT = 20;
const COL_STATION = 34;
const COL_TIME = 62;
const COL_HOURS = 34;
const COL_CUM = 34;
const COL_SHIFT = CONTENT_W - COL_DAY - COL_WT - COL_STATION - COL_TIME - COL_HOURS - COL_CUM;
const ROW_H = 16;
const HEADER_ROW_H = 14;
const META_H = 60;

const ABSENCE_CODES = new Set(["K", "U", "LZ", "MS", "KU", "SCH"]);

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
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1))}\u2026`;
}

function shiftTimeRange(p: ShiftProfile): string {
  const t1 = `${p.startTime}\u2013${p.endTime}`;
  if (p.startTime2 && p.endTime2) return `${t1}, ${p.startTime2}\u2013${p.endTime2}`;
  return t1;
}

export async function buildEmployeePdfBuffer(bundle: ExportBundle): Promise<Buffer> {
  const { schedule, assignments, facilityName, allEmployees } = bundle;

  const doc = new PDFDocument({
    margin: MARGIN,
    size: "A4",
    layout: "portrait",
    info: {
      Title: `Mitarbeiter-Dienstpl\u00e4ne ${toIsoDateOnly(schedule.periodStart)} \u2013 ${toIsoDateOnly(schedule.periodEnd)}`,
      Creator: "SchichtMeister Dienstplaner",
    },
  });

  const dates = eachIsoDateInPeriod(schedule.periodStart, schedule.periodEnd);
  const workDays = workingDaysInIsoRange(dates);
  const byEmpDay = buildAssignmentByEmpDay(assignments);
  const hMap = holidayDateMap(schedule.periodStart, schedule.periodEnd);

  // Profiles map
  const profilesById: Record<string, ShiftProfile> = {};
  for (const a of assignments) {
    if (!a.shiftProfileId || !a.shiftProfile) continue; // pure absence row
    if (!profilesById[a.shiftProfileId]) profilesById[a.shiftProfileId] = a.shiftProfile;
  }

  // Weekend set
  const weekendSet = new Set<string>();
  for (const iso of dates) {
    const [y, m, d] = iso.split("-").map(Number);
    const dow = new Date(y!, m! - 1, d!).getDay();
    if (dow === 0 || dow === 6) weekendSet.add(iso);
  }

  const monthNames = [
    "Januar", "Februar", "M\u00e4rz", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
  ];
  const periodStart = schedule.periodStart;
  const monthLabel = `${monthNames[periodStart.getUTCMonth()]} ${periodStart.getUTCFullYear()}`;
  const printDate = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

  const sorted = sortEmployeesByName(allEmployees);
  let pageNum = 0;
  const FOOTER_Y = PAGE_H - MARGIN - 8;
  const TABLE_BOTTOM = FOOTER_Y - 14; // leave room for footer

  const drawFooter = (empName: string) => {
    pageNum++;
    doc.fontSize(6).font("Helvetica").fillColor("#ddd");
    doc.moveTo(MARGIN, FOOTER_Y - 2).lineTo(MARGIN + CONTENT_W, FOOTER_Y - 2)
      .strokeColor("#ddd").lineWidth(0.5).stroke();
    doc.fillColor("#999");
    doc.text(`Seite ${pageNum}`, MARGIN, FOOTER_Y, { width: CONTENT_W, align: "right", lineBreak: false });
    doc.text(`SchichtMeister Dienstplaner`, MARGIN, FOOTER_Y, { width: CONTENT_W, align: "left", lineBreak: false });
  };

  for (let empIdx = 0; empIdx < sorted.length; empIdx++) {
    const emp = sorted[empIdx]!;
    if (empIdx > 0) doc.addPage({ size: "A4", layout: "portrait", margin: MARGIN });

    /* ── Employee metadata header ── */
    let y = MARGIN;

    // Title line
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#000");
    doc.text(`${emp.lastName}, ${emp.firstName}`, MARGIN, y, { lineBreak: false });

    doc.fontSize(8).font("Helvetica").fillColor("#555");
    doc.text(`Dienstplan ${monthLabel}`, MARGIN + 280, y + 2, { lineBreak: false });

    y += 16;

    // Info line 1: contract, stations, qualifications
    const pctLabel = `${employeeContractPercentLabel(emp)}%`;
    const stations = (emp.assignedStations ?? []).length > 0
      ? `Station ${emp.assignedStations.join("+")}`
      : "alle Stationen";
    const tags = (emp.qualificationTags ?? []).join(", ");
    const infoLine1 = tags
      ? `${pctLabel} \u00b7 ${stations} \u00b7 ${tags}`
      : `${pctLabel} \u00b7 ${stations}`;

    doc.fontSize(7.5).font("Helvetica").fillColor("#333");
    doc.text(infoLine1, MARGIN, y, { lineBreak: false });
    y += 12;

    // Info line 2: Soll, Ist, delta, working days
    // Compute hours
    let basePlanned = 0;
    let absWorkDays = 0;
    for (const iso of dates) {
      const a = byEmpDay.get(`${emp.id}|${iso}`);
      if (a) {
        if (a.dayStatus && ABSENCE_CODES.has(a.dayStatus) && isWorkingDayIso(iso)) {
          absWorkDays++;
        } else if (!a.dayStatus && a.shiftProfile) {
          basePlanned += paidHoursForShift(a.shiftProfile);
        }
      }
    }
    const empPct = emp.targetHoursPercent != null ? Number(emp.targetHoursPercent) : 100;
    const absenceHours = absWorkDays * 8 * (empPct / 100);
    const istHours = basePlanned + absenceHours;
    const target = targetHoursForPeriod(emp, workDays);
    const delta = target != null ? istHours - target : null;

    const sollStr = target != null ? `Soll: ${formatHours(target)}h` : "Soll: n/a";
    const istStr = `Ist: ${formatHours(istHours)}h`;
    const deltaStr = delta != null ? `(${delta >= 0 ? "+" : ""}${formatHours(delta)}h)` : "";
    const wdStr = `${workDays} Arbeitstage`;

    let hoursColor = "#333";
    if (target != null) {
      if (istHours >= target - 4 && istHours <= target + 8) hoursColor = "#2e7d32";
      else if (istHours > target + 8 && istHours <= target + 16) hoursColor = "#e65100";
      else hoursColor = "#c62828";
    }

    doc.fontSize(7.5).font("Helvetica-Bold").fillColor(hoursColor);
    doc.text(`${istStr} / ${sollStr} ${deltaStr}`, MARGIN, y, { lineBreak: false });
    doc.font("Helvetica").fillColor("#666");
    doc.text(`\u00b7 ${wdStr}`, MARGIN + 220, y, { lineBreak: false });

    // Facility + print date on the right
    doc.fontSize(6).fillColor("#999");
    doc.text(`${facilityName} \u00b7 ${printDate}`, MARGIN + 380, y, { lineBreak: false });
    y += 14;

    // Separator
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor("#ccc").lineWidth(0.5).stroke();
    y += 6;

    /* ── Table header ── */
    const tableX = MARGIN;
    const cols = [
      { label: "Tag", w: COL_DAY, align: "center" as const },
      { label: "WT", w: COL_WT, align: "center" as const },
      { label: "Schicht", w: COL_SHIFT, align: "left" as const },
      { label: "Station", w: COL_STATION, align: "center" as const },
      { label: "Uhrzeit", w: COL_TIME, align: "center" as const },
      { label: "Std", w: COL_HOURS, align: "right" as const },
      { label: "Kum.", w: COL_CUM, align: "right" as const },
    ];
    const tableW = cols.reduce((s, c) => s + c.w, 0);

    // Draw header row
    doc.rect(tableX, y, tableW, HEADER_ROW_H).fill(HEADER_BG);
    let hx = tableX;
    doc.fontSize(6).font("Helvetica-Bold").fillColor("#333");
    for (const col of cols) {
      doc.text(col.label, hx + 2, y + 3, { width: col.w - 4, align: col.align, lineBreak: false });
      hx += col.w;
    }
    doc.rect(tableX, y, tableW, HEADER_ROW_H).strokeColor(GRID_COLOR).lineWidth(0.5).stroke();
    y += HEADER_ROW_H;

    /* ── Data rows ── */
    let cumHours = 0;

    for (let di = 0; di < dates.length; di++) {
      const iso = dates[di]!;
      const [yr, mo, da] = iso.split("-").map(Number);
      const dow = new Date(yr!, mo! - 1, da!).getDay();
      const dayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
      const isWe = weekendSet.has(iso);
      const isHol = hMap.has(iso);
      const a = byEmpDay.get(`${emp.id}|${iso}`);
      const status = a?.dayStatus ?? null;
      const prof = a?.shiftProfileId ? profilesById[a.shiftProfileId] : undefined;

      // Compute row hours
      let rowHours = 0;
      if (a && !status && prof) {
        rowHours = paidHoursForShift(prof);
      }
      cumHours += rowHours;

      // Row background
      let rowBg = "#ffffff";
      if (status && STATUS_BG[status]) rowBg = STATUS_BG[status]!;
      else if (isHol) rowBg = HOLIDAY_BG;
      else if (isWe) rowBg = WEEKEND_BG;

      // Fill row background
      doc.rect(tableX, y, tableW, ROW_H).fill(rowBg);

      let rx = tableX;
      const textColor = status && STATUS_TEXT[status] ? STATUS_TEXT[status]! : "#333";

      // Col: Tag
      doc.fontSize(6.5).font(isHol ? "Helvetica-Bold" : "Helvetica").fillColor(isHol ? "#c62828" : "#333");
      doc.text(`${da}.`, rx + 1, y + 4, { width: COL_DAY - 2, align: "center", lineBreak: false });
      rx += COL_DAY;

      // Col: WT (weekday)
      doc.fontSize(6).font(isWe || isHol ? "Helvetica-Bold" : "Helvetica")
        .fillColor(isWe || isHol ? "#c62828" : "#777");
      doc.text(dayNames[dow]!, rx + 1, y + 4, { width: COL_WT - 2, align: "center", lineBreak: false });
      rx += COL_WT;

      // Col: Schicht
      if (status && ABSENCE_CODES.has(status)) {
        doc.fontSize(7).font("Helvetica-Bold").fillColor(textColor);
        doc.text(status, rx + 3, y + 4, { width: COL_SHIFT - 6, lineBreak: false });
      } else if (a && prof) {
        const accent = SHIFT_ACCENT[prof.shiftType] ?? "#666";
        doc.fontSize(7).font("Helvetica-Bold").fillColor(accent);
        const shiftName = prof.name;
        const marks = [a.markingRow2, a.markingRow3].filter(Boolean);
        const markStr = marks.length > 0 ? ` (${marks.join(", ")})` : "";
        doc.text(truncate(`${shiftName}${markStr}`, 32), rx + 3, y + 4, { width: COL_SHIFT - 6, lineBreak: false });
      } else if (isWe || isHol) {
        // Weekend/holiday with no assignment — leave empty
      } else {
        doc.fontSize(6).font("Helvetica").fillColor("#ccc");
        doc.text("-", rx + 3, y + 4, { width: COL_SHIFT - 6, lineBreak: false });
      }
      rx += COL_SHIFT;

      // Col: Station
      if (a && prof && !status) {
        const stn = a.stationNumber ?? (emp.mainStation as number | null)
          ?? (emp.assignedStations?.length === 1 ? emp.assignedStations[0]! : null);
        if (stn != null) {
          const sColor = STATION_COLORS[stn] ?? "#666";
          doc.fontSize(6.5).font("Helvetica-Bold").fillColor(sColor);
          doc.text(String(stn), rx + 1, y + 4, { width: COL_STATION - 2, align: "center", lineBreak: false });
        }
      }
      rx += COL_STATION;

      // Col: Uhrzeit
      if (a && prof && !status) {
        doc.fontSize(5.5).font("Helvetica").fillColor("#555");
        doc.text(shiftTimeRange(prof), rx + 1, y + 5, { width: COL_TIME - 2, align: "center", lineBreak: false });
      }
      rx += COL_TIME;

      // Col: Stunden
      if (rowHours > 0) {
        doc.fontSize(6.5).font("Helvetica").fillColor("#333");
        doc.text(`${formatHours(rowHours)}h`, rx + 1, y + 4, { width: COL_HOURS - 3, align: "right", lineBreak: false });
      } else {
        doc.fontSize(6).font("Helvetica").fillColor("#ccc");
        doc.text("\u2014", rx + 1, y + 4, { width: COL_HOURS - 3, align: "right", lineBreak: false });
      }
      rx += COL_HOURS;

      // Col: Kumuliert
      doc.fontSize(6.5).font("Helvetica").fillColor(cumHours > 0 ? "#555" : "#ccc");
      doc.text(cumHours > 0 ? `${formatHours(cumHours)}h` : "\u2014", rx + 1, y + 4, {
        width: COL_CUM - 3, align: "right", lineBreak: false,
      });

      // Grid lines for this row
      doc.rect(tableX, y, tableW, ROW_H).strokeColor(GRID_COLOR).lineWidth(0.25).stroke();
      // Column separators
      let sx = tableX;
      for (const col of cols) {
        sx += col.w;
        if (sx < tableX + tableW) {
          doc.moveTo(sx, y).lineTo(sx, y + ROW_H).strokeColor(GRID_COLOR).lineWidth(0.25).stroke();
        }
      }

      y += ROW_H;
    }

    drawFooter(emp.lastName);
  }

  if (sorted.length === 0) {
    doc.fontSize(10).font("Helvetica").fillColor("#333");
    doc.text("Keine aktiven Mitarbeiter.", MARGIN, MARGIN + 30);
    drawFooter("");
  }

  return collectPdfBuffer(doc);
}
