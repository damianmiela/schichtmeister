import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { datesInPeriodUtc, sameUtcCalendarDay } from "@/lib/planning/time";

export function maxStaffingRule(ctx: RuleContext): RuleResult {
  const warnings: RuleResult["warnings"] = [];
  const dates = datesInPeriodUtc(ctx.periodStart, ctx.periodEnd);
  
  for (const req of ctx.staffingRequirements) {
    if (req.maxTotalCount == null) continue;
    for (const d of dates) {
      let count = 0;
      for (const a of ctx.assignments) {
        if (!sameUtcCalendarDay(a.date, d)) continue;
        const profile = ctx.profilesById.get(a.shiftProfileId);
        if (!profile || profile.shiftType !== req.shiftType) continue;
        // SH employees don't count toward station caps
        const emp = ctx.employeesById.get(a.employeeId);
        if (emp?.qualificationTags.includes("SH")) continue;
        if (!req.isFacilityWide) {
          const aStation = (a as any).stationNumber;
          if (aStation != null && aStation !== req.stationNumber) continue;
        }
        count++;
      }
      if (count > req.maxTotalCount) {
        warnings.push({
          ruleId: "maxStaffing",
          code: "OVERSTAFFED",
          message: `${req.shiftType} station ${req.stationNumber} on ${d.toISOString().slice(0, 10)} has ${count} employees (max ${req.maxTotalCount}).`,
        });
      }
    }
  }
  return { errors: [], warnings };
}
