import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { utcDayKey } from "@/lib/planning/time";

const DEFAULT_MAX_DAYS = 7;
const DEFAULT_REQUIRED_REST_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

export function maxConsecutiveDaysRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];
  const globalMaxDays =
    (ctx.snapshot.ruleStates.maxConsecutiveDays?.params?.maxDays as number | undefined) ??
    DEFAULT_MAX_DAYS;
  const requiredRestDays =
    (ctx.snapshot.ruleStates.maxConsecutiveDays?.params?.requiredRestDays as number | undefined) ??
    DEFAULT_REQUIRED_REST_DAYS;

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
        if (prevStreakLength >= maxDays && diffDays <= requiredRestDays) {
          errors.push({
            ruleId: "maxConsecutiveDays",
            code: "INSUFFICIENT_REST_AFTER_MAX_DAYS",
            message: ctx.targetFilter
              ? `${name}: Arbeitet am ${sorted[i]} ohne ${requiredRestDays} Ruhetag(e) nach ${maxDays} Arbeitstagen.`
              : `Employee works on ${sorted[i]} but needs ${requiredRestDays} rest day(s) after ${maxDays} consecutive working days.`,
            employeeIds: [employeeId],
          });
        }
        streakStart = i;
      }
    }
  }

  return { errors, warnings: [] };
}
