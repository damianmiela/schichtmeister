import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { isPlannable } from "@/lib/planning/types";
import { assignmentPaidHours, utcMonthKey } from "@/lib/planning/time";
import { computeSollHours } from "@/lib/holidays";

export function overtimeExcessRule(ctx: RuleContext): RuleResult {
  const warnings: RuleResult["warnings"] = [];

  const year = ctx.periodStart.getUTCFullYear();
  const month = ctx.periodStart.getUTCMonth();
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

  // When targeted, only check the target employee
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

    let hours = 0;
    for (const a of ctx.assignments) {
      if (a.employeeId !== empId) continue;
      if (utcMonthKey(a.date) !== monthKey) continue;
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
