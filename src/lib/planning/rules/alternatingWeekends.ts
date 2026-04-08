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

  // Check each employee
  const employeeIds = ctx.targetFilter
    ? [ctx.targetFilter.employeeId]
    : [...ctx.employeesById.keys()];

  for (const empId of employeeIds) {
    const emp = ctx.employeesById.get(empId);
    if (!emp) continue;

    // Check boundary: previous weekend worked → first weekend must be free
    if (prevWeekend && empWorkedWeekend(empId, prevWeekend) && empWorkedWeekend(empId, weekends[0]!)) {
      const name = emp.displayName ?? empId;
      const wk = weekends[0]!;
      const dayStr = wk.sat ? utcDayKey(wk.sat) : utcDayKey(wk.sun!);
      errors.push({
        ruleId: "alternatingWeekends",
        code: "ALTERNATING_WEEKEND_VIOLATION",
        message: ctx.targetFilter
          ? `${name}: Arbeitet zwei Wochenenden hintereinander (${dayStr}).`
          : `${name} works consecutive weekends around ${dayStr}.`,
        employeeIds: [empId],
      });
    }

    // Check within period
    for (let wi = 0; wi < weekends.length - 1; wi++) {
      if (empWorkedWeekend(empId, weekends[wi]!) && empWorkedWeekend(empId, weekends[wi + 1]!)) {
        const name = emp.displayName ?? empId;
        const wk = weekends[wi + 1]!;
        const dayStr = wk.sat ? utcDayKey(wk.sat) : utcDayKey(wk.sun!);
        errors.push({
          ruleId: "alternatingWeekends",
          code: "ALTERNATING_WEEKEND_VIOLATION",
          message: ctx.targetFilter
            ? `${name}: Arbeitet zwei Wochenenden hintereinander (${dayStr}).`
            : `${name} works consecutive weekends around ${dayStr}.`,
          employeeIds: [empId],
        });
      }
    }
  }

  return { errors, warnings: [] };
}
