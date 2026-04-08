import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { utcDayKey } from "@/lib/planning/time";

const DEFAULT_MAX_DAYS = 7;
const DEFAULT_REQUIRED_REST_DAYS = 2;
const DEFAULT_REST_AFTER_6_THRESHOLD = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

export function maxConsecutiveDaysRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];
  const globalMaxDays =
    (ctx.snapshot.ruleStates.maxConsecutiveDays?.params?.maxDays as number | undefined) ??
    DEFAULT_MAX_DAYS;
  const requiredRestDays =
    (ctx.snapshot.ruleStates.maxConsecutiveDays?.params?.requiredRestDays as number | undefined) ??
    DEFAULT_REQUIRED_REST_DAYS;
  const restAfter6Threshold =
    (ctx.snapshot.ruleStates.restAfter6Days?.params?.threshold as number | undefined) ??
    DEFAULT_REST_AFTER_6_THRESHOLD;

  const byEmployee = new Map<string, string[]>();
  for (const a of ctx.assignments) {
    // When targeted, only check the target employee (all assignments for streak calc)
    if (ctx.targetFilter && a.employeeId !== ctx.targetFilter.employeeId) continue;
    const day = utcDayKey(a.date);
    const list = byEmployee.get(a.employeeId) ?? [];
    list.push(day);
    byEmployee.set(a.employeeId, list);
  }

  for (const [employeeId, days] of byEmployee) {
    const sorted = [...new Set(days)].sort();
    if (sorted.length === 0) continue;

    const emp = ctx.employeesById.get(employeeId);
    const maxDays = emp?.maxConsecutiveDays ?? globalMaxDays;
    const name = emp?.displayName ?? employeeId;

    let streakStart = 0;

    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]! + "T00:00:00Z").getTime();
      const curr = new Date(sorted[i]! + "T00:00:00Z").getTime();
      const diffDays = (curr - prev) / DAY_MS;

      if (diffDays === 1) {
        const streakLength = i - streakStart + 1;
        if (streakLength > maxDays) {
          errors.push({
            ruleId: "maxConsecutiveDays",
            code: "MAX_CONSECUTIVE_DAYS",
            message: ctx.targetFilter
              ? `${name}: ${streakLength} Tage am Stück (max. ${maxDays}).`
              : `Employee has ${streakLength} consecutive working days (max ${maxDays}).`,
            employeeIds: [employeeId],
          });
        }
      } else {
        const prevStreakLength = i - streakStart;
        // Only require multiple rest days if the streak hit the global threshold (e.g. 6+).
        // Shorter streaks that just hit a personal limit need only 1 rest day.
        const neededRest = prevStreakLength >= restAfter6Threshold ? requiredRestDays : 1;
        if (prevStreakLength >= maxDays && diffDays <= neededRest) {
          errors.push({
            ruleId: "maxConsecutiveDays",
            code: "INSUFFICIENT_REST_AFTER_MAX_DAYS",
            message: ctx.targetFilter
              ? `${name}: Arbeitet am ${sorted[i]} ohne ${neededRest} Ruhetag(e) nach ${prevStreakLength} Arbeitstagen.`
              : `Employee works on ${sorted[i]} but needs ${neededRest} rest day(s) after ${prevStreakLength} consecutive working days.`,
            employeeIds: [employeeId],
          });
        }
        streakStart = i;
      }
    }
  }

  return { errors, warnings: [] };
}
