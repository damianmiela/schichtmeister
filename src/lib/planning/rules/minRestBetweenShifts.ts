import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { shiftIntervalMs } from "@/lib/planning/time";

export function minRestBetweenShiftsRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];
  const minRestMs = ctx.snapshot.minRestHours * 60 * 60 * 1000;
  const byEmployee = new Map<string, { id: string; startMs: number; endMs: number }[]>();

  const allAssignments = [...(ctx.boundaryAssignments ?? []), ...ctx.assignments];
  for (const a of allAssignments) {
    // When targeted, only collect assignments for the target employee
    // (need ALL of their assignments to check gaps, not just target date)
    if (ctx.targetFilter && a.employeeId !== ctx.targetFilter.employeeId) continue;

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
        const emp = ctx.employeesById.get(employeeId);
        const name = emp?.displayName ?? employeeId;
        const gapH = (gap / (60 * 60 * 1000)).toFixed(2);
        // Use UTC ISO date strings so the formatter can parse them with the
        // standard /\d{4}-\d{2}-\d{2}/ pattern. Encode the actual rest gap
        // in the message so the formatter can show it without re-deriving.
        const fromIso = new Date(cur.endMs).toISOString().slice(0, 10);
        const toIso = new Date(next.startMs).toISOString().slice(0, 10);
        errors.push({
          ruleId: "minRestBetweenShifts",
          code: "INSUFFICIENT_REST",
          message: ctx.targetFilter
            ? `${name}: Nur ${gapH}h Ruhezeit (mind. ${ctx.snapshot.minRestHours}h, ${fromIso} → ${toIso}).`
            : `Less than ${ctx.snapshot.minRestHours}h rest between shifts: ${gapH}h from ${fromIso} to ${toIso}.`,
          assignmentIds: [cur.id, next.id],
          employeeIds: [employeeId],
        });
      }
    }
  }

  return { errors, warnings: [] };
}
