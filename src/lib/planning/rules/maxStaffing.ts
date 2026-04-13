import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { datesInPeriodUtc, sameUtcCalendarDay } from "@/lib/planning/time";

export function maxStaffingRule(ctx: RuleContext): RuleResult {
  const warnings: RuleResult["warnings"] = [];
  // When targeted, only check the target date
  const dates = ctx.targetFilter
    ? [ctx.targetFilter.date]
    : datesInPeriodUtc(ctx.periodStart, ctx.periodEnd);

  for (const req of ctx.staffingRequirements) {
    if (req.maxTotalCount == null) continue;
    // When targeted, only check staffing for the target shift type
    if (ctx.targetFilter) {
      const targetProfile = ctx.profilesById.get(ctx.targetFilter.shiftProfileId);
      if (targetProfile && targetProfile.shiftType !== req.shiftType) continue;
    }
    for (const d of dates) {
      let count = 0;
      for (const a of ctx.assignments) {
        if (!sameUtcCalendarDay(a.date, d)) continue;
        const profile = ctx.profilesById.get(a.shiftProfileId);
        if (!profile || profile.shiftType !== req.shiftType) continue;
        const emp = ctx.employeesById.get(a.employeeId);
        if (emp?.qualificationTags.includes("SH")) continue;
        if (!req.isFacilityWide) {
          const aStation = (a as { stationNumber?: number }).stationNumber;
          if (aStation != null && aStation !== req.stationNumber) continue;
        }
        count++;
      }
      if (count > req.maxTotalCount) {
        const stLabel = req.isFacilityWide ? "gesamt" : `Station ${req.stationNumber}`;
        warnings.push({
          ruleId: "maxStaffing",
          code: "OVERSTAFFED",
          message: ctx.targetFilter
            ? `Überbesetzung: ${count} Mitarbeiter für ${req.shiftType} ${stLabel} (max. ${req.maxTotalCount}).`
            : `${req.shiftType} station ${req.stationNumber} on ${d.toISOString().slice(0, 10)} has ${count} employees (max ${req.maxTotalCount}).`,
        });
      }
    }
  }
  return { errors: [], warnings };
}
