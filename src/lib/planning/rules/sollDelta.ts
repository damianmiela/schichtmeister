import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { isPlannable } from "@/lib/planning/types";
import { assignmentPaidHours, utcMonthKey } from "@/lib/planning/time";
import { computeSollHours } from "@/lib/holidays";

/**
 * Soll-Stunden Abweichungsbereich:
 * Each employee's total planned hours for the month must be within
 * [Soll + minDelta, Soll + maxDelta].
 *
 * Params (from ruleStates.sollDelta.params):
 *   minDelta: number (default -4)  — allowed undershoot
 *   maxDelta: number (default  8)  — allowed overshoot
 *
 * Soll is computed via computeSollHours() which accounts for German holidays.
 */
export function sollDeltaRule(ctx: RuleContext): RuleResult {
  const warnings: RuleResult["warnings"] = [];

  const params = ctx.snapshot.ruleStates.sollDelta?.params ?? {};
  const minDelta = (params.minDelta as number) ?? -4;
  const maxDelta = (params.maxDelta as number) ?? 8;

  const year = ctx.periodStart.getUTCFullYear();
  const month = ctx.periodStart.getUTCMonth();
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

  // If targetFilter is set, only check the target employee
  const employeeIds = ctx.targetFilter
    ? [ctx.targetFilter.employeeId]
    : [...ctx.employeesById.keys()];

  for (const empId of employeeIds) {
    const emp = ctx.employeesById.get(empId);
    if (!emp) continue;
    // Skip non-plannable employees (Inaktiv, Krank, Langzeitkrank, etc.)
    if (!ctx.targetFilter && !isPlannable(emp)) continue;

    const soll = computeSollHours(year, month, emp.targetHoursPercent);
    if (soll == null) continue;

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
