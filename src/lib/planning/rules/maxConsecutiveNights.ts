import { ShiftType } from "@prisma/client";
import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { utcDayKey } from "@/lib/planning/time";

const DEFAULT_MAX_COUNT = 3;

export function maxConsecutiveNightsRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];
  const maxCount =
    (ctx.snapshot.ruleStates.maxConsecutiveNights?.params?.maxCount as number | undefined) ??
    DEFAULT_MAX_COUNT;

  const allAssignments = [...(ctx.boundaryAssignments ?? []), ...ctx.assignments];
  const byEmployee = new Map<string, string[]>();

  for (const a of allAssignments) {
    // When targeted, only check the target employee (but all their assignments for streak calc)
    if (ctx.targetFilter && a.employeeId !== ctx.targetFilter.employeeId) continue;
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
    let maxStreak = 1;

    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]! + "T00:00:00Z");
      const curr = new Date(sorted[i]! + "T00:00:00Z");
      const diffDays = (curr.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000);

      if (diffDays === 1) {
        streak++;
        if (streak > maxStreak) maxStreak = streak;
      } else {
        streak = 1;
      }
    }

    if (maxStreak > maxCount) {
      const emp = ctx.employeesById.get(employeeId);
      const name = emp?.displayName ?? employeeId;
      errors.push({
        ruleId: "maxConsecutiveNights",
        code: "MAX_CONSECUTIVE_NIGHTS",
        message: ctx.targetFilter
          ? `${name}: ${maxStreak} Nachtschichten am Stück (max. ${maxCount}).`
          : `Employee has ${maxStreak} consecutive night shifts (max ${maxCount}).`,
        employeeIds: [employeeId],
      });
    }
  }

  return { errors, warnings: [] };
}
