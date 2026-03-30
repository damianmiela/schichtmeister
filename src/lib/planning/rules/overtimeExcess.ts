import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { assignmentPaidHours } from "@/lib/planning/time";

export function overtimeExcessRule(ctx: RuleContext): RuleResult {
  const warnings: RuleResult["warnings"] = [];
  
  const start = ctx.periodStart;
  const end = ctx.periodEnd;
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let workingDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow !== 0 && dow !== 6) workingDays++;
  }
  
  for (const [empId, emp] of ctx.employeesById) {
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
      warnings.push({
        ruleId: "overtimeExcess",
        code: "OVERTIME_EXCESS",
        message: `Employee ${empId} has ${hours.toFixed(1)}h planned (Soll: ${soll.toFixed(1)}h, max +8h overtime).`,
        employeeIds: [empId],
      });
    }
  }
  return { errors: [], warnings };
}
