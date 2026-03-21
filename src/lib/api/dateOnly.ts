/** Parse `YYYY-MM-DD` as UTC midnight (matches Prisma `@db.Date` convention in this app). */
export function parseIsoDateOnly(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toIsoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDayNumber(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function isDateWithinPeriodInclusive(
  assignmentDate: Date,
  periodStart: Date,
  periodEnd: Date,
): boolean {
  const a = utcDayNumber(assignmentDate);
  const s = utcDayNumber(periodStart);
  const e = utcDayNumber(periodEnd);
  return a >= s && a <= e;
}
