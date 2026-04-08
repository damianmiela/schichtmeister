import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { datesInPeriodUtc, shiftIntervalMs, sameUtcCalendarDay, utcDayKey } from "@/lib/planning/time";

/**
 * Station-Abdeckungslücken:
 * For each day and each station (1-3), check whether there is a time gap
 * between the last EARLY shift ending and the first LATE shift starting.
 *
 * BL and NIGHT shifts are excluded — BL is area management and doesn't
 * cover patients directly, NIGHT shifts cover the whole facility.
 */
export function stationCoverageGapRule(ctx: RuleContext): RuleResult {
  const warnings: RuleResult["warnings"] = [];

  const dates = ctx.targetFilter
    ? [ctx.targetFilter.date]
    : datesInPeriodUtc(ctx.periodStart, ctx.periodEnd);

  const STATIONS = [1, 2, 3];

  for (const d of dates) {
    for (const station of STATIONS) {
      let latestEarlyEnd = -1;
      let earliestLateStart = Infinity;
      let earlyEndTime = "";
      let lateStartTime = "";

      for (const a of ctx.assignments) {
        if (!sameUtcCalendarDay(a.date, d)) continue;

        const profile = ctx.profilesById.get(a.shiftProfileId);
        if (!profile) continue;

        const aStation = (a as { stationNumber?: number }).stationNumber;
        if (aStation == null || aStation !== station) continue;

        const { startMs, endMs } = shiftIntervalMs(a.date, profile.startTime, profile.endTime);

        if (profile.shiftType === "EARLY") {
          if (endMs > latestEarlyEnd) {
            latestEarlyEnd = endMs;
            earlyEndTime = profile.endTime;
          }
        } else if (profile.shiftType === "LATE") {
          if (startMs < earliestLateStart) {
            earliestLateStart = startMs;
            lateStartTime = profile.startTime;
          }
        }
        // BL, NIGHT — ignored
      }

      // Only check if both early and late shifts exist on this station+day
      if (latestEarlyEnd < 0 || earliestLateStart === Infinity) continue;

      if (earliestLateStart > latestEarlyEnd) {
        const gapMinutes = Math.round((earliestLateStart - latestEarlyEnd) / 60000);
        const dayStr = utcDayKey(d);
        const gapH = Math.floor(gapMinutes / 60);
        const gapM = gapMinutes % 60;
        const gapStr = gapH > 0
          ? `${gapH}h${gapM > 0 ? ` ${gapM}min` : ""}`
          : `${gapM}min`;

        warnings.push({
          ruleId: "stationCoverageGap",
          code: "STATION_COVERAGE_GAP",
          message: `Station ${station}, ${dayStr}: ${gapStr} Lücke zwischen frühschicht (Ende ${earlyEndTime}) und spätschicht (Beginn ${lateStartTime}).`,
        });
      }
    }
  }

  return { errors: [], warnings };
}
