export type ScheduleSummary = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
};

export function monthRangeIso(year: number, month: number): {
  monthStart: string;
  monthEnd: string;
} {
  const monthStart = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { monthStart, monthEnd };
}

function overlaps(
  periodStart: string,
  periodEnd: string,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  return periodStart <= rangeEnd && periodEnd >= rangeStart;
}

/**
 * Prefer a **DRAFT** schedule overlapping the month; else most recent **PUBLISHED** overlap.
 */
export function pickScheduleForMonth(
  schedules: ScheduleSummary[],
  monthStart: string,
  monthEnd: string,
): ScheduleSummary | null {
  const hit = schedules.filter((s) =>
    overlaps(s.periodStart, s.periodEnd, monthStart, monthEnd),
  );
  if (hit.length === 0) return null;
  const drafts = hit.filter((s) => s.status === "DRAFT");
  const pool = drafts.length > 0 ? drafts : hit.filter((s) => s.status === "PUBLISHED");
  if (pool.length === 0) return null;
  pool.sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  return pool[0] ?? null;
}

export function isoDateInRange(
  iso: string,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  return iso >= rangeStart && iso <= rangeEnd;
}

export function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function localIsoFromParts(year: number, monthIndex: number, day: number): string {
  return localIsoDate(new Date(year, monthIndex, day));
}

/** Monday-first calendar rows for the month; `null` = padding outside current month. */
export function monthCalendarRowsLocal(year: number, monthIndex: number): (string | null)[][] {
  const first = new Date(year, monthIndex, 1);
  const dow = first.getDay();
  const padMon = dow === 0 ? 6 : dow - 1;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < padMon; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) {
    cells.push(localIsoFromParts(year, monthIndex, d));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}

export function weekLocalIsoDays(weekStartMonday: Date): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStartMonday);
    d.setDate(d.getDate() + i);
    out.push(localIsoDate(d));
  }
  return out;
}
