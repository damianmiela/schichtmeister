import { ShiftType } from "@prisma/client";
import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { utcDayKey } from "@/lib/planning/time";

const DEFAULT_MAX_COUNT = 3;

export function maxConsecutiveNightsRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];
  const maxCount =
    (ctx.snapshot.ruleStates.maxConsecutiveNights?.params?.maxCount as number | undefined) ??
    DEFAULT_MAX_COUNT;

  const byEmployee = new Map<string, string[]>();

  for (const a of ctx.assignments) {
    const profile = ctx.profilesById.get(a.shiftProfileId);
    if (!profile || profile.shiftType !== ShiftType.NIGHT) continue;
    const day = utcDayKey(a.date);
    const list = byEmployee.get(a.employeeId) ?? [];
    list.push(day);
    byEmployee.set(a.employeeId, list);
  }

  for (const [employeeId, days] of byEmployee) {
    const sorted = [...new Set(days)].sort();
    let streak = 1;

    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]! + "T00:00:00Z");
      const curr = new Date(sorted[i]! + "T00:00:00Z");
      const diffDays = (curr.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000);

      if (diffDays === 1) {
        streak++;
        if (streak > maxCount) {
          errors.push({
            ruleId: "maxConsecutiveNights",
            code: "MAX_CONSECUTIVE_NIGHTS",
            message: `Employee has ${streak} consecutive night shifts (max ${maxCount}).`,
            employeeIds: [employeeId],
          });
        }
      } else {
        streak = 1;
      }
    }
  }

  return { errors, warnings: [] };
}
