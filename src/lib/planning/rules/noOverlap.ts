import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { shiftIntervalMs } from "@/lib/planning/time";

function intervalsOverlapHalfOpen(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function noOverlapRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];
  const byEmployee = new Map<string, { id: string; startMs: number; endMs: number }[]>();

  for (const a of ctx.assignments) {
    // When targeted, only check the target employee
    if (ctx.targetFilter && a.employeeId !== ctx.targetFilter.employeeId) continue;

    const profile = ctx.profilesById.get(a.shiftProfileId);
    if (!profile) {
      errors.push({
        ruleId: "noOverlap",
        code: "MISSING_PROFILE",
        message: `Shift profile not found for assignment ${a.id}.`,
        assignmentIds: [a.id],
      });
      continue;
    }
    const { startMs, endMs } = shiftIntervalMs(a.date, profile.startTime, profile.endTime);
    const list = byEmployee.get(a.employeeId) ?? [];
    list.push({ id: a.id, startMs, endMs });
    byEmployee.set(a.employeeId, list);
  }

  for (const [employeeId, list] of byEmployee) {
    const sorted = [...list].sort((x, y) => x.startMs - y.startMs);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const A = sorted[i]!;
        const B = sorted[j]!;
        if (B.startMs >= A.endMs) break;
        if (intervalsOverlapHalfOpen(A.startMs, A.endMs, B.startMs, B.endMs)) {
          const emp = ctx.employeesById.get(employeeId);
          const name = emp?.displayName ?? employeeId;
          const profileB = [...ctx.profilesById.values()].find((p) => {
            const iv = shiftIntervalMs(ctx.assignments.find((x) => x.id === B.id)?.date ?? new Date(), p.startTime, p.endTime);
            return iv.startMs === B.startMs && iv.endMs === B.endMs;
          });
          errors.push({
            ruleId: "noOverlap",
            code: "OVERLAP",
            message: ctx.targetFilter
              ? `${name} hat bereits eine überlappende Schicht.`
              : "Employee has overlapping shift assignments.",
            assignmentIds: [A.id, B.id],
            employeeIds: [employeeId],
          });
        }
      }
    }
  }

  return { errors, warnings: [] };
}
