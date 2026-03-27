import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { datesInPeriodUtc, sameUtcCalendarDay } from "@/lib/planning/time";

export function staffingMinimumRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];
  const dates = datesInPeriodUtc(ctx.periodStart, ctx.periodEnd);

  for (const req of ctx.staffingRequirements) {
    for (const d of dates) {
      let count = 0;
      for (const a of ctx.assignments) {
        if (!sameUtcCalendarDay(a.date, d)) continue;
        const profile = ctx.profilesById.get(a.shiftProfileId);
        if (!profile || profile.shiftType !== req.shiftType) continue;
        if (profile.stationNumber !== req.stationNumber) continue;
        count += 1;
      }
      if (count < req.minTotalCount) {
        errors.push({
          ruleId: "staffingMinimum",
          code: "UNDERSTAFFED",
          message: `Need at least ${req.minTotalCount} for ${req.shiftType} station ${req.stationNumber} on ${d.toISOString().slice(0, 10)} (got ${count}).`,
        });
      }
    }
  }

  return { errors, warnings: [] };
}
