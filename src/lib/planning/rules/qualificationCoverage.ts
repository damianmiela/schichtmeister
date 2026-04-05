import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { datesInPeriodUtc, sameUtcCalendarDay } from "@/lib/planning/time";

/**
 * For each qualification requirement, at least `minCount` assigned employees
 * on that day/shift type/station must carry the required tag.
 * If `maxCount` is set, no more than that many may carry the tag (hard rule).
 */
export function qualificationCoverageRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];
  // When targeted, only check the target date
  const dates = ctx.targetFilter
    ? [ctx.targetFilter.date]
    : datesInPeriodUtc(ctx.periodStart, ctx.periodEnd);

  // Build a set of all qualification tags that actually exist on facility employees.
  // Skip qualification requirements whose tags don't match ANY employee — these are
  // misconfigured (e.g. "Hilfskraft" when no employee carries that tag).
  const allEmpTags = new Set<string>();
  for (const emp of ctx.employeesById.values()) {
    for (const t of emp.qualificationTags) allEmpTags.add(t);
  }

  for (const req of ctx.staffingRequirements) {
    if (req.qualificationRequirements.length === 0) continue;
    // When targeted, only check staffing for the target shift type
    if (ctx.targetFilter) {
      const targetProfile = ctx.profilesById.get(ctx.targetFilter.shiftProfileId);
      if (targetProfile && targetProfile.shiftType !== req.shiftType) continue;
    }
    for (const d of dates) {
      const onShiftEmpIds: string[] = [];
      for (const a of ctx.assignments) {
        if (!sameUtcCalendarDay(a.date, d)) continue;
        const profile = ctx.profilesById.get(a.shiftProfileId);
        if (!profile || profile.shiftType !== req.shiftType) continue;
        if (!req.isFacilityWide) {
          const aStation = (a as { stationNumber?: number }).stationNumber;
          if (aStation != null && aStation !== req.stationNumber) continue;
        }
        onShiftEmpIds.push(a.employeeId);
      }
      const nonShEmpIds = onShiftEmpIds.filter((id) => {
        const emp = ctx.employeesById.get(id);
        return !emp?.qualificationTags.includes("SH");
      });
      for (const qr of req.qualificationRequirements) {
        const tags = qr.qualificationTag.split(",").map((t) => t.trim());
        if (!tags.some((t) => allEmpTags.has(t))) continue;
        let tagCount = 0;
        for (const empId of nonShEmpIds) {
          const emp = ctx.employeesById.get(empId);
          if (emp && tags.some((t) => emp.qualificationTags.includes(t))) {
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
        if (qr.maxCount != null && tagCount > qr.maxCount) {
          errors.push({
            ruleId: "qualificationCoverage",
            code: "EXCESS_QUALIFICATION",
            message: `Max ${qr.maxCount} employee(s) with tag "${qr.qualificationTag}" for ${req.shiftType} station ${req.stationNumber} on ${d.toISOString().slice(0, 10)} (got ${tagCount}).`,
          });
        }
      }
    }
  }

  return { errors, warnings: [] };
}
