import type { RuleContext, RuleResult } from "@/lib/planning/types";

function sameUtcCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function datesInPeriodUtc(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cur = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  for (let t = cur; t <= last; t += 24 * 60 * 60 * 1000) {
    out.push(new Date(t));
  }
  return out;
}

/**
 * MVP: for each required tag, at least one assigned employee on that shift must carry the tag.
 */
export function qualificationCoverageRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];
  const dates = datesInPeriodUtc(ctx.periodStart, ctx.periodEnd);

  for (const req of ctx.staffingRequirements) {
    if (req.requiredQualificationTags.length === 0) continue;
    for (const d of dates) {
      if (d.getUTCDay() !== req.dayOfWeek) continue;
      const onShift: string[] = [];
      for (const a of ctx.assignments) {
        if (!sameUtcCalendarDay(a.date, d)) continue;
        const profile = ctx.profilesById.get(a.shiftProfileId);
        if (!profile || profile.shiftType !== req.shiftType) continue;
        onShift.push(a.employeeId);
      }
      for (const tag of req.requiredQualificationTags) {
        let covered = false;
        for (const empId of onShift) {
          const emp = ctx.employeesById.get(empId);
          if (emp?.qualificationTags.includes(tag)) {
            covered = true;
            break;
          }
        }
        if (!covered) {
          errors.push({
            ruleId: "qualificationCoverage",
            code: "MISSING_QUALIFICATION",
            message: `No assigned employee with required tag "${tag}" for ${req.shiftType} on ${d.toISOString().slice(0, 10)}.`,
          });
        }
      }
    }
  }

  return { errors, warnings: [] };
}
