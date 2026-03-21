/**
 * Shift interval in UTC ms for the assignment calendar day (date column).
 * If end clock time is <= start clock time, end is treated as the next calendar day.
 */
export function shiftIntervalMs(
  assignmentDate: Date,
  startTime: string,
  endTime: string,
): { startMs: number; endMs: number } {
  const y = assignmentDate.getUTCFullYear();
  const mo = assignmentDate.getUTCMonth();
  const d = assignmentDate.getUTCDate();
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const startMs = Date.UTC(y, mo, d, sh, sm, 0, 0);
  let endMs = Date.UTC(y, mo, d, eh, em, 0, 0);
  if (endMs <= startMs) {
    endMs += 24 * 60 * 60 * 1000;
  }
  return { startMs, endMs };
}

/** Paid hours for one assignment (gross duration minus break). */
export function assignmentPaidHours(
  assignmentDate: Date,
  startTime: string,
  endTime: string,
  breakMinutes: number,
): number {
  const { startMs, endMs } = shiftIntervalMs(assignmentDate, startTime, endTime);
  const grossMin = (endMs - startMs) / 60000;
  return Math.max(0, grossMin - breakMinutes) / 60;
}

export function utcDayKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function utcMonthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
