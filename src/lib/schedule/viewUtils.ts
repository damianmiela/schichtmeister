/** ISO week number (Monday-based), German locale convention for UI labels. */
export function getWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function getStaffingStatus(
  assigned: number,
  required: number,
): "success" | "warning" | "error" {
  if (assigned >= required) return "success";
  if (assigned >= required - 1) return "warning";
  return "error";
}

const SHIFT_TYPE_DE: Record<string, string> = {
  EARLY: "Früh",
  LATE: "Spät",
  NIGHT: "Nacht",
};

export function shiftTypeLabel(t: string): string {
  return SHIFT_TYPE_DE[t] ?? t;
}

/** Local calendar `YYYY-MM-DD` → `Date.getDay()` 0–6 (So–Sa). */
export function localDayOfWeekFromIsoDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}
