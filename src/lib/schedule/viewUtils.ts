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
  BL: "Bereichsleitung",
};

export function shiftTypeLabel(t: string): string {
  return SHIFT_TYPE_DE[t] ?? t;
}

/** Local calendar `YYYY-MM-DD` → `Date.getDay()` 0–6 (So–Sa). */
export function localDayOfWeekFromIsoDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/**
 * Format a fractional hour value for display.
 *
 * Rules:
 *   - whole numbers       -> no decimals  (8     -> "8")
 *   - one decimal place   -> one decimal  (8.5   -> "8.5")
 *   - two decimal places  -> two decimals (8.75  -> "8.75", 8.05 -> "8.05")
 *
 * Values are rounded to 2 decimals first, then trailing zero(s) trimmed.
 * This matters for shifts whose break is not a multiple of 6 minutes
 * (e.g. 45 min break -> 8.75 h paid). toFixed(1) would have rounded that
 * to "8.8" and lost precision.
 */
export function formatHours(h: number): string {
  if (!Number.isFinite(h)) return "0";
  // Round to 2 decimals to avoid floating-point noise (8.749999... etc.)
  const rounded = Math.round(h * 100) / 100;
  if (rounded % 1 === 0) return String(rounded);
  // Up to 2 decimals; trim a single trailing zero if present (e.g. "8.50" -> "8.5")
  let s = rounded.toFixed(2);
  if (s.endsWith("0")) s = s.slice(0, -1);
  return s;
}
