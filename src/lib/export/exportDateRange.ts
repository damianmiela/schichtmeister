import { toIsoDateOnly } from "@/lib/api/dateOnly";

/** Inclusive range of ISO `YYYY-MM-DD` between Prisma `@db.Date` values (UTC calendar days). */
export function eachIsoDateInPeriod(periodStart: Date, periodEnd: Date): string[] {
  const out: string[] = [];
  const cur = new Date(
    Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), periodStart.getUTCDate()),
  );
  const end = new Date(
    Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), periodEnd.getUTCDate()),
  );
  while (cur <= end) {
    out.push(toIsoDateOnly(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
