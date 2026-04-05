import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { datesInPeriodUtc, sameUtcCalendarDay } from "@/lib/planning/time";
import { getHolidays } from "@/lib/holidays";

/**
 * BL shifts are not allowed on weekends (Saturday/Sunday) or
 * Rheinland-Pfalz public holidays.  This applies to both single
 * BL assignments and Vollzeit-BL employees.
 */
export function blWeekendHolidayRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];

  const dates = ctx.targetFilter
    ? [ctx.targetFilter.date]
    : datesInPeriodUtc(ctx.periodStart, ctx.periodEnd);

  // Build holiday set for the period
  const holidaySet = new Set<string>();
  const years = new Set<number>();
  for (const d of dates) years.add(d.getUTCFullYear());
  for (const y of years) {
    for (const h of getHolidays(y)) {
      holidaySet.add(h.date.toISOString().slice(0, 10));
    }
  }

  for (const a of ctx.assignments) {
    const profile = ctx.profilesById.get(a.shiftProfileId);
    if (!profile || profile.shiftType !== "BL") continue;

    // When targeted, only check the target date
    if (ctx.targetFilter && !sameUtcCalendarDay(a.date, ctx.targetFilter.date)) continue;

    const dow = a.date.getUTCDay(); // 0=Sun, 6=Sat
    const iso = a.date.toISOString().slice(0, 10);
    const isWeekend = dow === 0 || dow === 6;
    const isHoliday = holidaySet.has(iso);

    if (isWeekend || isHoliday) {
      const reason = isWeekend ? "Wochenende" : "Feiertag";
      const emp = ctx.employeesById.get(a.employeeId);
      const name = emp?.displayName ?? a.employeeId;
      errors.push({
        ruleId: "blWeekendHoliday",
        code: "BL_ON_WEEKEND_OR_HOLIDAY",
        message: `BL-Schicht für ${name} am ${iso} nicht erlaubt (${reason}).`,
        assignmentIds: [a.id],
        employeeIds: [a.employeeId],
      });
    }
  }

  return { errors, warnings: [] };
}
