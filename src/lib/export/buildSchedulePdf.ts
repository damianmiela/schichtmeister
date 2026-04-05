import PDFDocument from "pdfkit";
import type { Employee } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import type { AssignmentWithRelations, ExportBundle } from "@/lib/export/scheduleExportContext";
import { eachIsoDateInPeriod } from "@/lib/export/exportDateRange";
import {
  buildAssignmentByEmpDay,
  employeeContractPercentLabel,
  exportMatrixCellText,
  formatHours,
  getNightEmployees,
  groupEmployeesByStation,
  paidHoursForShift,
  plannedHoursByEmployee,
  sortEmployeesByName,
  targetHoursForPeriod,
  workingDaysInIsoRange,
} from "@/lib/export/scheduleExportMatrix";
import { holidayDateMap } from "@/lib/holidays";
import { isWorkingDayIso, countWorkingDaysInRange } from "@/lib/holidays";

/* ── Color constants ── */
const STATION_COLORS: Record<number, { main: string; light: string; header: string }> = {
  1: { main: "#1565c0", light: "#e3f2fd", header: "#1565c0" },
  2: { main: "#2e7d32", light: "#e8f5e9", header: "#2e7d32" },
  3: { main: "#e65100", light: "#fff3e0", header: "#e65100" },
};

const NIGHT_COLORS = { main: "#7e57c2", light: "#ede7f6", header: "#7e57c2" };

const STATUS_BG: Record<string, string> = {
  U: "#e3f2fd",
  K: "#ffebee",
  LZ: "#fce4ec",
  MS: "#f3e5f5",
  KU: "#fff3e0",
  SCH: "#e8eaf6",
};

const STATUS_TEXT_COLOR: Record<string, string> = {
  U: "#1565c0",
  K: "#c62828",
  LZ: "#ad1457",
  MS: "#7b1fa2",
  KU: "#e65100",
  SCH: "#283593",
};

const WEEKEND_BG = "#f5f5f5";
const HOLIDAY_BG = "#fff0f0";
const GRID_COLOR = "#bdbdbd";
const HEADER_BG = "#e0e0e0";

/* ── Layout constants ── */
const MARGIN = 28;
const PAGE_W = 841.89; // A4 landscape width
const PAGE_H = 595.28; // A4 landscape height
const CONTENT_W = PAGE_W - MARGIN * 2;
const NAME_COL_W = 130;
const HOURS_COL_W = 48;
const HEADER_ROW_H = 24;
const DATA_ROW_H = 16;
const SECTION_TITLE_H = 20;
const META_BLOCK_H = 42;

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
  return `${t.slice(0, Math.max(0, max - 1))}\u2026`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

type Section = {
  title: string;
  employees: Employee[];
  stationNumber: number | null; // null for night
};

export async function buildSchedulePdfBuffer(
  bundle: ExportBundle,
): Promise<Buffer> {
  const { schedule, assignments, facilityName, allEmployees } = bundle;

  const doc = new PDFDocument({
    margin: MARGIN,
    size: "A4",
    layout: "landscape",
    bufferPages: true,
    info: {
      Title: `Dienstplan ${toIsoDateOnly(schedule.periodStart)} \u2013 ${toIsoDateOnly(schedule.periodEnd)}`,
      Creator: "SchichtMeister Dienstplaner",
    },
  });

  const dates = eachIsoDateInPeriod(schedule.periodStart, schedule.periodEnd);
  const workDays = workingDaysInIsoRange(dates);
  const byEmpDay = buildAssignmentByEmpDay(assignments);
  const plannedMap = plannedHoursByEmployee(assignments);

  // Build holiday map for shading
  const hMap = holidayDateMap(schedule.periodStart, schedule.periodEnd);

  // Compute weekend set
  const weekendSet = new Set<string>();
  for (const iso of dates) {
    const [y, m, d] = iso.split("-").map(Number);
    const dow = new Date(y!, m! - 1, d!).getDay();
    if (dow === 0 || dow === 6) weekendSet.add(iso);
  }

  // Day column width
  const dayCount = Math.max(1, dates.length);
  const dayW = (CONTENT_W - NAME_COL_W - HOURS_COL_W) / dayCount;
  const tableW = NAME_COL_W + HOURS_COL_W + dayW * dayCount;

  // Build sections — use allEmployees to include those without assignments
  const byStation = groupEmployeesByStation(allEmployees);
  const nightEmps = getNightEmployees(allEmployees, assignments);

  // Compute absence hours per employee (K/U on working days)
  const absenceHoursMap = new Map<string, number>();
  for (const emp of allEmployees) {
    let absWorkDays = 0;
    for (const iso of dates) {
      const a = byEmpDay.get(`${emp.id}|${iso}`);
      if (a?.dayStatus && (a.dayStatus === "K" || a.dayStatus === "U" || a.dayStatus === "LZ" || a.dayStatus === "MS" || a.dayStatus === "KU") && isWorkingDayIso(iso)) {
        absWorkDays++;
      }
    }
    const pct = emp.targetHoursPercent != null ? Number(emp.targetHoursPercent) : 100;
    absenceHoursMap.set(emp.id, absWorkDays * 8 * (pct / 100));
  }

  const sections: Section[] = [
    { title: "Station 1", employees: sortEmployeesByName(byStation[1]), stationNumber: 1 },
    { title: "Station 2", employees: sortEmployeesByName(byStation[2]), stationNumber: 2 },
    { title: "Station 3", employees: sortEmployeesByName(byStation[3]), stationNumber: 3 },
    { title: "Nacht (gesamtes Geb\u00e4ude)", employees: sortEmployeesByName(nightEmps), stationNumber: null },
  ].filter((s) => s.employees.length > 0);

  // Metadata line
  const periodStart = schedule.periodStart;
  const monthNames = [
    "Januar", "Februar", "M\u00e4rz", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
  ];
  const monthLabel = `${monthNames[periodStart.getUTCMonth()]} ${periodStart.getUTCFullYear()}`;
  const printDate = new Date().toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  let pageNum = 0;

  /* ── Helper: draw page header with metadata ── */
  const drawPageMeta = (sectionTitle: string, continuation = false) => {
    const y = MARGIN;
    doc.fontSize(12).font("Helvetica-Bold").fillColor("#000");
    doc.text(`Dienstplan ${monthLabel}`, MARGIN, y, { lineBreak: false });
    doc.fontSize(9).font("Helvetica").fillColor("#555");
    doc.text(facilityName, MARGIN + 220, y + 2, { lineBreak: false });
    doc.text(`Erstellt: ${printDate}`, MARGIN + 400, y + 2, { lineBreak: false });

    const titleY = y + 16;
    const stNum = sections.find((s) => s.title === sectionTitle)?.stationNumber;
    const color = stNum ? STATION_COLORS[stNum]?.header ?? "#333" : NIGHT_COLORS.header;
    doc.fontSize(10).font("Helvetica-Bold").fillColor(color);
    doc.text(
      continuation ? `${sectionTitle} (Fortsetzung)` : sectionTitle,
      MARGIN,
      titleY,
      { lineBreak: false },
    );
    doc.fillColor("#000");
    return titleY + SECTION_TITLE_H;
  };

  /* ── Helper: draw column headers (day numbers + weekday) ── */
  const drawColumnHeaders = (y: number) => {
    // Background
    doc.rect(MARGIN, y, tableW, HEADER_ROW_H).fill(HEADER_BG);

    // Name header
    doc.fontSize(6).font("Helvetica-Bold").fillColor("#333");
    doc.text("Mitarbeiter", MARGIN + 3, y + 4, { width: NAME_COL_W - 6, lineBreak: false });
    doc.text("Ist/Soll", MARGIN + NAME_COL_W + 2, y + 4, {
      width: HOURS_COL_W - 4,
      align: "center",
      lineBreak: false,
    });

    // Day headers with weekend/holiday shading
    let x = MARGIN + NAME_COL_W + HOURS_COL_W;
    for (let i = 0; i < dates.length; i++) {
      const iso = dates[i]!;
      const isWe = weekendSet.has(iso);
      const isHol = hMap.has(iso);

      if (isHol) {
        doc.rect(x, y, dayW, HEADER_ROW_H).fill(HOLIDAY_BG);
      } else if (isWe) {
        doc.rect(x, y, dayW, HEADER_ROW_H).fill(WEEKEND_BG);
      }

      const [, , d] = iso.split("-").map(Number);
      const dow = new Date(
        Number(iso.split("-")[0]),
        Number(iso.split("-")[1]) - 1,
        d!,
      ).getDay();
      const dayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

      doc.fontSize(5).font("Helvetica").fillColor(isWe || isHol ? "#999" : "#666");
      doc.text(dayNames[dow]!, x, y + 3, { width: dayW, align: "center", lineBreak: false });
      doc.fontSize(6.5).font("Helvetica-Bold").fillColor(isWe || isHol ? "#aaa" : "#333");
      doc.text(String(d), x, y + 11, { width: dayW, align: "center", lineBreak: false });

      x += dayW;
    }

    // Grid lines for header
    doc.strokeColor(GRID_COLOR).lineWidth(0.5);
    doc.rect(MARGIN, y, tableW, HEADER_ROW_H).stroke();
    // Vertical separators
    doc.moveTo(MARGIN + NAME_COL_W, y).lineTo(MARGIN + NAME_COL_W, y + HEADER_ROW_H).stroke();
    doc.moveTo(MARGIN + NAME_COL_W + HOURS_COL_W, y)
      .lineTo(MARGIN + NAME_COL_W + HOURS_COL_W, y + HEADER_ROW_H)
      .stroke();

    doc.fillColor("#000");
    return y + HEADER_ROW_H;
  };

  /* ── Helper: draw a single employee data row ── */
  const drawDataRow = (y: number, emp: Employee) => {
    const rowH = DATA_ROW_H;

    // Row background (alternating would be nice but keep it simple)
    let x = MARGIN;

    // Name cell
    doc.rect(x, y, NAME_COL_W, rowH).fill("#ffffff");
    doc.rect(x, y, NAME_COL_W, rowH).stroke();
    const tags = (emp.qualificationTags ?? []).join(", ");
    const nameStr = `${emp.lastName}, ${emp.firstName}`;
    const pctStr = `${employeeContractPercentLabel(emp)}%`;
    const fullName = tags ? `${nameStr} (${pctStr}) [${tags}]` : `${nameStr} (${pctStr})`;
    doc.fontSize(5.5).font("Helvetica").fillColor("#000");
    doc.text(truncate(fullName, 48), x + 2, y + 3, {
      width: NAME_COL_W - 4,
      lineBreak: false,
    });
    x += NAME_COL_W;

    // Hours cell
    doc.rect(x, y, HOURS_COL_W, rowH).fill("#ffffff");
    doc.rect(x, y, HOURS_COL_W, rowH).stroke();
    const basePlanned = plannedMap.get(emp.id) ?? 0;
    const absHours = absenceHoursMap.get(emp.id) ?? 0;
    const istHours = basePlanned + absHours;
    const target = targetHoursForPeriod(emp, workDays);
    const hoursStr = target != null
      ? `${formatHours(istHours)}/${formatHours(target)}`
      : formatHours(istHours);

    // Color code: green if within range, red if far off
    let hoursColor = "#333";
    if (target != null) {
      if (istHours >= target - 4 && istHours <= target + 8) hoursColor = "#2e7d32";
      else if (istHours > target + 8 && istHours <= target + 16) hoursColor = "#e65100";
      else if (istHours < target - 4 || istHours > target + 16) hoursColor = "#c62828";
    }

    doc.fontSize(5).font("Helvetica-Bold").fillColor(hoursColor);
    doc.text(hoursStr, x + 1, y + 3, {
      width: HOURS_COL_W - 2,
      align: "center",
      lineBreak: false,
    });
    if (target != null && target > 0) {
      const pctVal = Math.round((istHours / target) * 100);
      doc.fontSize(4).font("Helvetica").fillColor(hoursColor);
      doc.text(`(${pctVal}%)`, x + 1, y + 10, {
        width: HOURS_COL_W - 2,
        align: "center",
        lineBreak: false,
      });
    }
    x += HOURS_COL_W;

    // Day cells
    for (let i = 0; i < dates.length; i++) {
      const iso = dates[i]!;
      const isWe = weekendSet.has(iso);
      const isHol = hMap.has(iso);
      const a = byEmpDay.get(`${emp.id}|${iso}`);

      // Determine cell background
      let cellBg = "#ffffff";
      const status = a?.dayStatus ?? null;
      if (status && STATUS_BG[status]) {
        cellBg = STATUS_BG[status]!;
      } else if (isHol) {
        cellBg = HOLIDAY_BG;
      } else if (isWe) {
        cellBg = WEEKEND_BG;
      }

      doc.rect(x, y, dayW, rowH).fill(cellBg);
      doc.rect(x, y, dayW, rowH).strokeColor(GRID_COLOR).lineWidth(0.25).stroke();

      // Cell text
      const textColor = status && STATUS_TEXT_COLOR[status] ? STATUS_TEXT_COLOR[status]! : "#333";
      doc.fillColor(textColor);

      if (a) {
        // Row 1: shift name or status
        const row1 = status ?? a.shiftProfile.name;
        doc.fontSize(5).font(status ? "Helvetica-Bold" : "Helvetica");
        doc.text(truncate(row1, 8), x, y + 1, {
          width: dayW,
          align: "center",
          lineBreak: false,
        });

        // Row 2/3: markings
        const marks = [a.markingRow2, a.markingRow3].filter(Boolean);
        if (marks.length > 0) {
          doc.fontSize(3.5).font("Helvetica").fillColor("#777");
          doc.text(marks.join(" "), x, y + 9, {
            width: dayW,
            align: "center",
            lineBreak: false,
          });
        }
      } else {
        // No assignment — empty or weekend
        if (!isWe && !isHol) {
          doc.fontSize(5).font("Helvetica").fillColor("#ccc");
          doc.text("-", x, y + 3, { width: dayW, align: "center", lineBreak: false });
        }
      }

      x += dayW;
    }

    doc.fillColor("#000").strokeColor(GRID_COLOR).lineWidth(0.5);
    return y + rowH;
  };

  /* ── Helper: draw page footer ── */
  // Position footer inside the content boundary to prevent pdfkit auto-pagination.
  // Content area ends at PAGE_H - MARGIN = 567. Place footer just above that.
  const FOOTER_Y = PAGE_H - MARGIN - 8; // ~559
  const drawFooter = () => {
    pageNum++;
    doc.fontSize(6).font("Helvetica").fillColor("#ddd");
    doc.moveTo(MARGIN, FOOTER_Y - 2).lineTo(MARGIN + CONTENT_W, FOOTER_Y - 2)
      .strokeColor("#ddd").lineWidth(0.5).stroke();
    doc.fillColor("#999");
    doc.text(`Seite ${pageNum}`, MARGIN, FOOTER_Y, { width: CONTENT_W, align: "right", lineBreak: false });
    doc.text(`SchichtMeister Dienstplaner`, MARGIN, FOOTER_Y, { width: CONTENT_W, align: "left", lineBreak: false });
  };

  /* ── Main rendering loop: one section per station, new page for each ── */
  let isFirstPage = true;

  for (const section of sections) {
    // Start each section on a new page
    if (!isFirstPage) {
      doc.addPage({ size: "A4", layout: "landscape", margin: MARGIN });
    }
    isFirstPage = false;

    let y = drawPageMeta(section.title);
    y = drawColumnHeaders(y);

    for (let empIdx = 0; empIdx < section.employees.length; empIdx++) {
      const emp = section.employees[empIdx]!;

      // Check if we need a new page
      if (y + DATA_ROW_H > FOOTER_Y - 12) {
        drawFooter();
        doc.addPage({ size: "A4", layout: "landscape", margin: MARGIN });
        y = drawPageMeta(section.title, true);
        y = drawColumnHeaders(y);
      }

      y = drawDataRow(y, emp);
    }

    drawFooter();
  }

  if (sections.length === 0) {
    doc.fontSize(10).font("Helvetica").fillColor("#333");
    doc.text("Keine Mitarbeiter oder Zuweisungen f\u00fcr diesen Monat.", MARGIN, MARGIN + 30);
    drawFooter();
  }

  return collectPdfBuffer(doc);
}
