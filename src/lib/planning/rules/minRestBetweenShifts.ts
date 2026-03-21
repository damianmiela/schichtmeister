import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { shiftIntervalMs } from "@/lib/planning/time";

export function minRestBetweenShiftsRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];
  const minRestMs = ctx.snapshot.minRestHours * 60 * 60 * 1000;
  const byEmployee = new Map<string, { id: string; startMs: number; endMs: number }[]>();

  for (const a of ctx.assignments) {
    const profile = ctx.profilesById.get(a.shiftProfileId);
    if (!profile) continue;
    const { startMs, endMs } = shiftIntervalMs(a.date, profile.startTime, profile.endTime);
    const list = byEmployee.get(a.employeeId) ?? [];
    list.push({ id: a.id, startMs, endMs });
    byEmployee.set(a.employeeId, list);
  }

  for (const [employeeId, list] of byEmployee) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((x, y) => x.startMs - y.startMs);
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i]!;
      const next = sorted[i + 1]!;
      const gap = next.startMs - cur.endMs;
      if (gap < minRestMs) {
        errors.push({
          ruleId: "minRestBetweenShifts",
          code: "INSUFFICIENT_REST",
          message: `Less than ${ctx.snapshot.minRestHours}h rest between shifts.`,
          assignmentIds: [cur.id, next.id],
          employeeIds: [employeeId],
        });
      }
    }
  }

  return { errors, warnings: [] };
}
