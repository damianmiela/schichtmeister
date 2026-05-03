import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { datesInPeriodUtc, utcDayKey } from "@/lib/planning/time";

const DAY_MS = 24 * 60 * 60 * 1000;

type Weekend = { sat: Date | null; sun: Date | null };

/**
 * Jedes zweite Wochenende muss frei sein.
 *
 * Checks consecutive weekends — if an employee worked weekend W, they must
 * be free on weekend W+1.  Includes boundary data from the previous month
 * to check the last weekend before the period start.
 */
export function alternatingWeekendsRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];

  const dates = datesInPeriodUtc(ctx.periodStart, ctx.periodEnd);
  if (dates.length === 0) return { errors, warnings: [] };

  // Build set of worked days per employee (current + boundary)
  const allAssignments = [...(ctx.boundaryAssignments ?? []), ...ctx.assignments];
  const workedByEmp = new Map<string, Set<string>>();
  for (const a of allAssignments) {
    if (ctx.targetFilter && a.employeeId !== ctx.targetFilter.employeeId) continue;
    const set = workedByEmp.get(a.employeeId) ?? new Set();
    set.add(utcDayKey(a.date));
    workedByEmp.set(a.employeeId, set);
  }

  // Extract weekends within the period
  const weekends: Weekend[] = [];
  let i = 0;
  while (i < dates.length) {
    const d = dates[i]!;
    const dow = d.getUTCDay(); // 0=Sun, 6=Sat
    if (dow === 6) {
      const sat = d;
      const nextDay = i + 1 < dates.length ? dates[i + 1]! : null;
      const sun = nextDay && nextDay.getUTCDay() === 0 ? nextDay : null;
      weekends.push({ sat, sun });
      i += sun ? 2 : 1;
    } else if (dow === 0) {
      weekends.push({ sat: null, sun: d });
      i += 1;
    } else {
      i += 1;
    }
  }

  if (weekends.length === 0) return { errors, warnings: [] };

  // Find the previous weekend (before period) for boundary check
  const firstDate = dates[0]!;
  let prevWeekend: Weekend | null = null;
  // Walk backwards from period start to find last Saturday
  for (let offset = 1; offset <= 7; offset++) {
    const d = new Date(firstDate.getTime() - offset * DAY_MS);
    if (d.getUTCDay() === 6) {
      const sun = new Date(d.getTime() + DAY_MS);
      prevWeekend = { sat: d, sun };
      break;
    }
  }

  function empWorkedWeekend(empId: string, wk: Weekend): boolean {
    const worked = workedByEmp.get(empId);
    if (!worked) return false;
    if (wk.sat && worked.has(utcDayKey(wk.sat))) return true;
    if (wk.sun && worked.has(utcDayKey(wk.sun))) return true;
    return false;
  }

  // Per-weekend day-pattern helper: returns "Sa", "So", "Sa+So", or null if free.
  function dayPattern(empId: string, wk: Weekend): "Sa" | "So" | "Sa+So" | null {
    const worked = workedByEmp.get(empId);
    if (!worked) return null;
    const sat = !!(wk.sat && worked.has(utcDayKey(wk.sat)));
    const sun = !!(wk.sun && worked.has(utcDayKey(wk.sun)));
    if (sat && sun) return "Sa+So";
    if (sat) return "Sa";
    if (sun) return "So";
    return null;
  }

  // Anchor date for a weekend (the Saturday if present, else the Sunday).
  function anchor(wk: Weekend): string {
    return wk.sat ? utcDayKey(wk.sat) : utcDayKey(wk.sun!);
  }

  // Check each employee, emitting ONE summary per affected employee.
  const employeeIds = ctx.targetFilter
    ? [ctx.targetFilter.employeeId]
    : [...ctx.employeesById.keys()];

  const totalWeekends = weekends.length;

  for (const empId of employeeIds) {
    const emp = ctx.employeesById.get(empId);
    if (!emp) continue;

    // Pass 1: compute the per-weekend pattern (worked? which days?).
    type WeekendInfo = {
      iso: string;
      pattern: "Sa" | "So" | "Sa+So";
      /** True if this worked weekend is in a violation pair with the previous OR next worked weekend (or boundary). */
      inViolation: boolean;
    };
    const worked: WeekendInfo[] = [];

    // Boundary: was the last weekend of the previous month also worked?
    const boundaryWorked = prevWeekend ? empWorkedWeekend(empId, prevWeekend) : false;

    for (const wk of weekends) {
      const pat = dayPattern(empId, wk);
      if (pat) worked.push({ iso: anchor(wk), pattern: pat, inViolation: false });
    }

    if (worked.length === 0) continue;

    // Pass 2: mark violation pairs.
    // A worked weekend at index i is "in violation" if either the previous or
    // next entry in `worked` is the very next calendar weekend (≤ 8 days apart
    // — Saturday-to-Saturday is 7d, Sunday-to-Sunday is 7d, edge cases ≤ 8d).
    function adjacent(aIso: string, bIso: string): boolean {
      const a = new Date(aIso + "T00:00:00Z").getTime();
      const b = new Date(bIso + "T00:00:00Z").getTime();
      const diffDays = Math.abs(b - a) / DAY_MS;
      return diffDays <= 8;
    }

    let violations = 0;

    // Boundary contributes 1 violation if boundaryWorked AND first entry's date
    // is adjacent (≤ 8 days) to the boundary weekend's anchor.
    if (boundaryWorked && prevWeekend) {
      const boundaryIso = anchor(prevWeekend);
      const first = worked[0]!;
      if (adjacent(boundaryIso, first.iso)) {
        first.inViolation = true;
        violations++;
      }
    }

    for (let i = 1; i < worked.length; i++) {
      if (adjacent(worked[i - 1]!.iso, worked[i]!.iso)) {
        worked[i - 1]!.inViolation = true;
        worked[i]!.inViolation = true;
        violations++;
      }
    }

    if (violations === 0) continue;

    const name = emp.displayName ?? empId;
    // Encode marker "!" on weekends that are in a violation pair so the
    // formatter / drawer can render them differently.
    const patternStr = worked
      .map((w) => `${w.iso}:${w.pattern}${w.inViolation ? "!" : ""}`)
      .join(",");
    // Boundary flag goes BEFORE the bracket so the formatter can detect it.
    const bFlag = boundaryWorked ? "B" : "-";
    errors.push({
      ruleId: "alternatingWeekends",
      code: "ALTERNATING_WEEKEND_VIOLATION",
      message: ctx.targetFilter
        ? `${name}: ${worked.length} von ${totalWeekends} Wochenenden gearbeitet, ${violations} Verstöße [${bFlag}|${patternStr}].`
        : `${name}: weekends worked ${worked.length}/${totalWeekends}, ${violations} violations [${bFlag}|${patternStr}].`,
      employeeIds: [empId],
    });
  }

  return { errors, warnings: [] };
}
