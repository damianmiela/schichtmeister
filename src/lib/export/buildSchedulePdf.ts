import PDFDocument from "pdfkit";
import type { Employee } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import type { ExportBundle } from "@/lib/export/scheduleExportContext";
import { generateColorFromAbbreviation, contrastTextColor } from "@/lib/qualificationColor";
import { eachIsoDateInPeriod } from "@/lib/export/exportDateRange";
import {
  buildAssignmentByEmpDay,
  employeeContractPercentLabel,
  formatHours,
  getNightEmployees,
  plannedHoursByEmployee,
  targetHoursForPeriod,
  workingDaysInIsoRange,
} from "@/lib/export/scheduleExportMatrix";
import { holidayDateMap } from "@/lib/holidays";
import { isWorkingDayIso } from "@/lib/holidays";

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

type Section = {
  title: string;
  employees: Employee[];
  stationNumber: number | null; // null for night
  isAusbildung?: boolean;
};

/** Station-grouping used for PDF: mainStation-based, skip Ausbildung, skip unassigned.
 *  Employees without mainStation fall back to Station 1.
 *  Employees with only NIGHT shifts are excluded (they only appear in the Nacht table). */
function groupEmployeesByMainStationForPdf(
  employees: Employee[],
  nonNightAssignedIds: Set<string>,
): Record<1 | 2 | 3, Employee[]> {
  const grouped: Record<number, Employee[]> = { 1: [], 2: [], 3: [] };
  for (const emp of employees) {
    if ((emp.contractType as string) === "AUSBILDUNG") continue;
    if (!nonNightAssignedIds.has(emp.id)) continue;
    const main = emp.mainStation;
    if (main != null && main >= 1 && main <= 3) {
      grouped[main]!.push(emp);
    } else {
      grouped[1]!.push(emp);
    }
  }
  return grouped as Record<1 | 2 | 3, Employee[]>;
}

export async function buildSchedulePdfBuffer(
  bundle: ExportBundle,
): Promise<Buffer> {
  const { schedule, assignments, facilityName, allEmployees, qualificationsByEmployee } = bundle;

  /* ── Sort employees by qualification sortOrder (best first), then by name ── */
  const bestQualSortOrder = (empId: string): number => {
    const qs = qualificationsByEmployee.get(empId) ?? [];
    if (qs.length === 0) return 9999;
    return Math.min(...qs.map((q) => q.sortOrder));
  };
  const sortEmployeesForPdf = (emps: Employee[]): Employee[] =>
    [...emps].sort((a, b) => {
      const qa = bestQualSortOrder(a.id);
      const qb = bestQualSortOrder(b.id);
      if (qa !== qb) return qa - qb;
      const ln = a.lastName.localeCompare(b.lastName, "de");
      return ln !== 0 ? ln : a.firstName.localeCompare(b.firstName, "de");
    });

  const doc = new PDFDocument({
    margin: MARGIN,
    size: "A4",
    layout: "landscape",
    bufferPages: true,
    info: {
      Title: `Dienstplan ${toIsoDateOnly(schedule.periodStart)} \u2013 ${toIsoDateOnly(schedule.periodEnd)}`,
      Creator: "SchichtMeister",
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

  // Set of employees that actually have at least one assignment in the schedule
  const assignedIds = new Set<string>();
  // Employees with at least one non-NIGHT assignment — qualify for station tables.
  // Employees who only have NIGHT shifts will appear only in the Nacht section.
  const nonNightAssignedIds = new Set<string>();
  for (const a of assignments) {
    assignedIds.add(a.employeeId);
    // Pure absence rows (no shift profile) don't contribute to night/non-night categorisation.
    if (a.shiftProfile && a.shiftProfile.shiftType !== "NIGHT") {
      nonNightAssignedIds.add(a.employeeId);
    }
  }

  // Build sections — mainStation-based, Ausbildung excluded, only employees with non-night assignments
  const byStation = groupEmployeesByMainStationForPdf(allEmployees, nonNightAssignedIds);
  // Night section: employees with any NIGHT assignment, excluding Ausbildung (they get their own section)
  const nightEmps = getNightEmployees(allEmployees, assignments).filter(
    (e) => (e.contractType as string) !== "AUSBILDUNG",
  );
  // Ausbildung employees with at least one assignment
  const ausbildungEmps = allEmployees.filter(
    (e) => (e.contractType as string) === "AUSBILDUNG" && assignedIds.has(e.id),
  );

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
    { title: "Station 1", employees: sortEmployeesForPdf(byStation[1]), stationNumber: 1 },
    { title: "Station 2", employees: sortEmployeesForPdf(byStation[2]), stationNumber: 2 },
    { title: "Station 3", employees: sortEmployeesForPdf(byStation[3]), stationNumber: 3 },
    { title: "Nacht (gesamtes Geb\u00e4ude)", employees: sortEmployeesForPdf(nightEmps), stationNumber: null },
    { title: "Ausbildung", employees: sortEmployeesForPdf(ausbildungEmps), stationNumber: null, isAusbildung: true },
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
    const secMeta = sections.find((s) => s.title === sectionTitle);
    const stNum = secMeta?.stationNumber;
    const color = secMeta?.isAusbildung
      ? "#546e7a"
      : stNum
        ? STATION_COLORS[stNum]?.header ?? "#333"
        : NIGHT_COLORS.header;
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

  /* ── Helper: draw a small station-number badge (circle) ── */
  const drawStationBadge = (cx: number, cy: number, stationNum: number) => {
    const st = STATION_COLORS[stationNum];
    const bg = st?.light ?? "#eceff1";
    const fg = st?.main ?? "#546e7a";
    const r = 3.2;
    doc.save();
    doc.lineWidth(0.5);
    doc.circle(cx, cy, r).fillAndStroke(bg, fg);
    doc.fontSize(3.8).font("Helvetica-Bold").fillColor(fg);
    doc.text(String(stationNum), cx - r, cy - 1.7, {
      width: r * 2,
      align: "center",
      lineBreak: false,
    });
    doc.restore();
    doc.fillColor("#000");
  };

  /* ── Helper: draw a small "N" night badge (circle) ── */
  const drawNightBadge = (cx: number, cy: number) => {
    const bg = NIGHT_COLORS.light;
    const fg = NIGHT_COLORS.main;
    const r = 3.2;
    doc.save();
    doc.lineWidth(0.5);
    doc.circle(cx, cy, r).fillAndStroke(bg, fg);
    doc.fontSize(3.8).font("Helvetica-Bold").fillColor(fg);
    doc.text("N", cx - r, cy - 1.7, {
      width: r * 2,
      align: "center",
      lineBreak: false,
    });
    doc.restore();
    doc.fillColor("#000");
  };

  /* ── Helper: draw a single employee data row ── */
  const drawDataRow = (y: number, emp: Employee, section: Section) => {
    const rowH = DATA_ROW_H;

    // Row background (alternating would be nice but keep it simple)
    let x = MARGIN;

    // Name cell
    doc.rect(x, y, NAME_COL_W, rowH).fill("#ffffff");
    doc.rect(x, y, NAME_COL_W, rowH).stroke();
    const nameStr = `${emp.lastName}, ${emp.firstName}`;
    const pctStr = `${employeeContractPercentLabel(emp)}%`;
    // Line 1: name + (pct%)
    doc.fontSize(5.5).font("Helvetica").fillColor("#000");
    doc.text(truncate(`${nameStr} (${pctStr})`, 42), x + 2, y + 2, {
      width: NAME_COL_W - 4,
      lineBreak: false,
    });
    // Line 2: qualification pills (colored, like website)
    const quals = qualificationsByEmployee.get(emp.id) ?? [];
    if (quals.length > 0) {
      let pillX = x + 2;
      const pillY = y + 9;
      const pillH = 5.5;
      const maxX = x + NAME_COL_W - 2;
      doc.fontSize(3.8).font("Helvetica-Bold");
      for (const q of quals) {
        const bg = q.color || generateColorFromAbbreviation(q.abbreviation);
        const fg = contrastTextColor(bg);
        const textW = doc.widthOfString(q.abbreviation);
        const pillW = textW + 4;
        if (pillX + pillW > maxX) break;
        doc.save();
        doc.roundedRect(pillX, pillY, pillW, pillH, 1.2).fill(bg);
        doc.fillColor(fg).text(q.abbreviation, pillX + 2, pillY + 1, {
          width: textW,
          lineBreak: false,
        });
        doc.restore();
        pillX += pillW + 1.5;
      }
      doc.fillColor("#000");
    }
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
      const diff = istHours - target;
      const diffStr = `(${diff >= 0 ? "+" : ""}${formatHours(diff)}h)`;
      doc.fontSize(4).font("Helvetica").fillColor(hoursColor);
      doc.text(diffStr, x + 1, y + 10, {
        width: HOURS_COL_W - 2,
        align: "center",
        lineBreak: false,
      });
    }
    x += HOURS_COL_W;

    // Day cells
    const isNightSection = section.title.startsWith("Nacht");
    for (let i = 0; i < dates.length; i++) {
      const iso = dates[i]!;
      const isWe = weekendSet.has(iso);
      const isHol = hMap.has(iso);
      const a = byEmpDay.get(`${emp.id}|${iso}`);
      const isNightShift = a?.shiftProfile?.shiftType === "NIGHT";

      // Determine whether to show the assignment in this section.
      // - Night section: only show NIGHT shifts (and status dayStatus on any cell? keep status visible for sick/vacation info)
      // - Station section: NIGHT shifts render as "N" circle (no station mark); day shifts render normally
      let showAssignment = !!a;
      if (a && isNightSection && !isNightShift && !a.dayStatus) {
        // Non-night shift in night table — leave blank (visible elsewhere)
        showAssignment = false;
      }

      // Determine cell background
      let cellBg = "#ffffff";
      const status = showAssignment ? a?.dayStatus ?? null : null;
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

      if (a && showAssignment) {
        // Decide badge to render:
        // - Station section + night shift -> "N" badge only (no shift name beside)
        // - Station section + cross-station shift -> station number badge
        // - Ausbildung section -> always station number badge
        // - Night section -> never
        let badgeKind: "station" | "night" | null = null;
        let badgeStation: number | null = null;
        if (!status) {
          if (isNightSection) {
            // no badge
          } else if (section.isAusbildung) {
            badgeStation = a.stationNumber ?? emp.mainStation ?? 1;
            badgeKind = "station";
          } else if (section.stationNumber != null) {
            if (isNightShift) {
              badgeKind = "night";
            } else if (a.stationNumber != null && a.stationNumber !== section.stationNumber) {
              badgeStation = a.stationNumber;
              badgeKind = "station";
            }
          }
        }

        // Row 1: shift name or status
        const row1 = status ?? a.shiftProfile?.name ?? "";
        doc.fontSize(5).font(status ? "Helvetica-Bold" : "Helvetica").fillColor(textColor);

        if (badgeKind === "night") {
          // "N" circle only, no shift name (night shift in station table)
          drawNightBadge(x + dayW / 2, y + rowH / 2);
        } else if (badgeKind === "station" && badgeStation != null) {
          // Split cell vertically: left = station circle, right = shift text, with divider line
          const leftW = Math.min(10, dayW * 0.38);
          const rightX = x + leftW;
          const rightW = dayW - leftW;
          // Vertical divider line
          doc.save();
          doc.strokeColor("#d0d0d0").lineWidth(0.3);
          doc.moveTo(x + leftW, y + 2).lineTo(x + leftW, y + rowH - 2).stroke();
          doc.restore();
          drawStationBadge(x + leftW / 2, y + rowH / 2, badgeStation);
          doc.fillColor(textColor);
          doc.fontSize(5).font("Helvetica");
          doc.text(truncate(row1, 6), rightX, y + 1, {
            width: rightW,
            align: "center",
            lineBreak: false,
          });
          const marks = [a.markingRow2, a.markingRow3].filter(Boolean);
          if (marks.length > 0) {
            doc.fontSize(3.5).font("Helvetica").fillColor("#777");
            doc.text(marks.join(" "), rightX, y + 9, {
              width: rightW,
              align: "center",
              lineBreak: false,
            });
          }
        } else {
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
        }
      } else {
        // No assignment or hidden (e.g., non-night shift in night table) — empty or weekend
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
    doc.text(`SchichtMeister`, MARGIN, FOOTER_Y, { width: CONTENT_W, align: "left", lineBreak: false });
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

      y = drawDataRow(y, emp, section);
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
