import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { assignmentPaidHours } from "@/lib/planning/time";

export function overtimeExcessRule(ctx: RuleContext): RuleResult {
  const warnings: RuleResult["warnings"] = [];

  const start = ctx.periodStart;
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let workingDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow !== 0 && dow !== 6) workingDays++;
  }

  // When targeted, only check the target employee
  const employeeIds = ctx.targetFilter
    ? [ctx.targetFilter.employeeId]
    : [...ctx.employeesById.keys()];

  for (const empId of employeeIds) {
    const emp = ctx.employeesById.get(empId);
    if (!emp) continue;
    const pct = emp.targetHoursPercent;
    if (pct == null) continue;
    const soll = workingDays * 8 * (pct / 100);

    let hours = 0;
    for (const a of ctx.assignments) {
      if (a.employeeId !== empId) continue;
      const p = ctx.profilesById.get(a.shiftProfileId);
      if (!p) continue;
      hours += assignmentPaidHours(a.date, p.startTime, p.endTime, p.breakMinutes);
    }

    if (hours > soll + 8) {
      const name = emp.displayName ?? empId;
      warnings.push({
        ruleId: "overtimeExcess",
        code: "OVERTIME_EXCESS",
        message: ctx.targetFilter
          ? `${name}: ${hours.toFixed(1)}h geplant (Soll: ${soll.toFixed(1)}h, max +8h Überstunden).`
          : `Employee ${empId} has ${hours.toFixed(1)}h planned (Soll: ${soll.toFixed(1)}h, max +8h overtime).`,
        employeeIds: [empId],
      });
    }
  }
  return { errors: [], warnings };
}
