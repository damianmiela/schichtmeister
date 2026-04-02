import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { assignmentPaidHours, utcMonthKey } from "@/lib/planning/time";

/**
 * Soll-Stunden Abweichungsbereich:
 * Each employee's total planned hours for the month must be within
 * [Soll + minDelta, Soll + maxDelta].
 *
 * Params (from ruleStates.sollDelta.params):
 *   minDelta: number (default -4)  — allowed undershoot
 *   maxDelta: number (default  8)  — allowed overshoot
 *
 * Soll = workingDays × 8h × (targetHoursPercent / 100)
 */
export function sollDeltaRule(ctx: RuleContext): RuleResult {
  const warnings: RuleResult["warnings"] = [];

  const params = ctx.snapshot.ruleStates.sollDelta?.params ?? {};
  const minDelta = (params.minDelta as number) ?? -4;
  const maxDelta = (params.maxDelta as number) ?? 8;

  const start = ctx.periodStart;
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let workingDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow !== 0 && dow !== 6) workingDays++;
  }

  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

  // If targetFilter is set, only check the target employee
  const employeeIds = ctx.targetFilter
    ? [ctx.targetFilter.employeeId]
    : [...ctx.employeesById.keys()];

  for (const empId of employeeIds) {
    const emp = ctx.employeesById.get(empId);
    if (!emp) continue;
    const pct = emp.targetHoursPercent;
    if (pct == null) continue;

    const soll = workingDays * 8 * (pct / 100);
    const lower = soll + minDelta;
    const upper = soll + maxDelta;

    let hours = 0;
    for (const a of ctx.assignments) {
      if (a.employeeId !== empId) continue;
      if (utcMonthKey(a.date) !== monthKey) continue;
      const p = ctx.profilesById.get(a.shiftProfileId);
      if (!p) continue;
      hours += assignmentPaidHours(a.date, p.startTime, p.endTime, p.breakMinutes);
    }

    const name = emp.displayName ?? empId;

    if (hours < lower) {
      warnings.push({
        ruleId: "sollDelta",
        code: "SOLL_UNDER",
        message: `${name}: ${hours.toFixed(1)}h geplant, Soll ${soll.toFixed(1)}h (min. ${lower.toFixed(1)}h erlaubt).`,
        employeeIds: [empId],
      });
    } else if (hours > upper) {
      warnings.push({
        ruleId: "sollDelta",
        code: "SOLL_OVER",
        message: `${name}: ${hours.toFixed(1)}h geplant, Soll ${soll.toFixed(1)}h (max. ${upper.toFixed(1)}h erlaubt).`,
        employeeIds: [empId],
      });
    }
  }

  return { errors: [], warnings };
}
