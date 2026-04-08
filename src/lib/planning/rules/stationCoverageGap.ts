import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { datesInPeriodUtc, shiftIntervalMs, sameUtcCalendarDay, utcDayKey } from "@/lib/planning/time";

/**
 * Station-Abdeckungslücken:
 * For each day and each station (1-3), collect all EARLY and LATE shift
 * assignments, sort by start time, and warn about time gaps between
 * consecutive shifts.
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
  const EXCLUDED_SHIFT_TYPES = new Set(["BL", "NIGHT"]);

  for (const d of dates) {
    for (const station of STATIONS) {
      // Collect all non-BL, non-NIGHT assignments for this station+day
      const intervals: { startMs: number; endMs: number; profileName: string }[] = [];

      for (const a of ctx.assignments) {
        if (!sameUtcCalendarDay(a.date, d)) continue;

        const profile = ctx.profilesById.get(a.shiftProfileId);
        if (!profile) continue;
        if (EXCLUDED_SHIFT_TYPES.has(profile.shiftType)) continue;

        const aStation = (a as { stationNumber?: number }).stationNumber;
        if (aStation == null || aStation !== station) continue;

        const { startMs, endMs } = shiftIntervalMs(a.date, profile.startTime, profile.endTime);
        const label = `${profile.shiftType} (${profile.startTime}–${profile.endTime})`;
        intervals.push({ startMs, endMs, profileName: label });
      }

      if (intervals.length < 2) continue;

      // Sort by start time
      intervals.sort((a, b) => a.startMs - b.startMs);

      // Check for gaps between consecutive shifts
      for (let i = 1; i < intervals.length; i++) {
        const prev = intervals[i - 1]!;
        const curr = intervals[i]!;

        if (curr.startMs > prev.endMs) {
          const gapMinutes = Math.round((curr.startMs - prev.endMs) / 60000);
          const dayStr = utcDayKey(d);
          const gapH = Math.floor(gapMinutes / 60);
          const gapM = gapMinutes % 60;
          const gapStr = gapH > 0
            ? `${gapH}h ${gapM > 0 ? `${gapM}min` : ""}`
            : `${gapM}min`;

          warnings.push({
            ruleId: "stationCoverageGap",
            code: "STATION_COVERAGE_GAP",
            message: `Station ${station}, ${dayStr}: ${gapStr.trim()} Lücke zwischen ${prev.profileName} und ${curr.profileName}.`,
          });
        }
      }
    }
  }

  return { errors: [], warnings };
}
