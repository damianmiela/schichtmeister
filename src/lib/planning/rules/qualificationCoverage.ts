import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { datesInPeriodUtc, sameUtcCalendarDay } from "@/lib/planning/time";

/**
 * For each qualification requirement, at least `minCount` assigned employees
 * on that day/shift type/station must carry the required tag.
 */
export function qualificationCoverageRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];
  const dates = datesInPeriodUtc(ctx.periodStart, ctx.periodEnd);

  for (const req of ctx.staffingRequirements) {
    if (req.qualificationRequirements.length === 0) continue;
    for (const d of dates) {
      const onShiftEmpIds: string[] = [];
      for (const a of ctx.assignments) {
        if (!sameUtcCalendarDay(a.date, d)) continue;
        const profile = ctx.profilesById.get(a.shiftProfileId);
        if (!profile || profile.shiftType !== req.shiftType) continue;
        if (profile.stationNumber !== req.stationNumber) continue;
        onShiftEmpIds.push(a.employeeId);
      }
      for (const qr of req.qualificationRequirements) {
        let tagCount = 0;
        for (const empId of onShiftEmpIds) {
          const emp = ctx.employeesById.get(empId);
          if (emp?.qualificationTags.includes(qr.qualificationTag)) {
            tagCount++;
          }
        }
        if (tagCount < qr.minCount) {
          errors.push({
            ruleId: "qualificationCoverage",
            code: "MISSING_QUALIFICATION",
            message: `Need at least ${qr.minCount} employee(s) with tag "${qr.qualificationTag}" for ${req.shiftType} station ${req.stationNumber} on ${d.toISOString().slice(0, 10)} (got ${tagCount}).`,
          });
        }
      }
    }
  }

  return { errors, warnings: [] };
}
