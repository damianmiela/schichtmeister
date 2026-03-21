import type { RuleContext, RuleResult } from "@/lib/planning/types";

function datesInPeriodUtc(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cur = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  for (let t = cur; t <= last; t += 24 * 60 * 60 * 1000) {
    out.push(new Date(t));
  }
  return out;
}

function sameUtcCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function staffingMinimumRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];
  const dates = datesInPeriodUtc(ctx.periodStart, ctx.periodEnd);

  for (const req of ctx.staffingRequirements) {
    for (const d of dates) {
      if (d.getUTCDay() !== req.dayOfWeek) continue;
      let count = 0;
      for (const a of ctx.assignments) {
        if (!sameUtcCalendarDay(a.date, d)) continue;
        const profile = ctx.profilesById.get(a.shiftProfileId);
        if (!profile || profile.shiftType !== req.shiftType) continue;
        count += 1;
      }
      if (count < req.minStaffCount) {
        errors.push({
          ruleId: "staffingMinimum",
          code: "UNDERSTAFFED",
          message: `Need at least ${req.minStaffCount} for ${req.shiftType} on ${d.toISOString().slice(0, 10)} (got ${count}).`,
        });
      }
    }
  }

  return { errors, warnings: [] };
}
