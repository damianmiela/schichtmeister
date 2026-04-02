import { ContractType } from "@prisma/client";
import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { assignmentPaidHours, utcMonthKey } from "@/lib/planning/time";

export function miniJobMonthlyHoursRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];
  const sums = new Map<string, number>();

  for (const a of ctx.assignments) {
    // When targeted, only check the target employee
    if (ctx.targetFilter && a.employeeId !== ctx.targetFilter.employeeId) continue;

    const emp = ctx.employeesById.get(a.employeeId);
    if (!emp || emp.contractType !== ContractType.MINI_JOB) continue;
    const profile = ctx.profilesById.get(a.shiftProfileId);
    if (!profile) continue;
    const hours = assignmentPaidHours(
      a.date,
      profile.startTime,
      profile.endTime,
      profile.breakMinutes,
    );
    const month = utcMonthKey(a.date);
    const key = `${a.employeeId}|${month}`;
    sums.set(key, (sums.get(key) ?? 0) + hours);
  }

  for (const [key, total] of sums) {
    const [employeeId] = key.split("|");
    const emp = ctx.employeesById.get(employeeId!);
    if (!emp) continue;
    const limit =
      emp.miniJobMaxMonthlyHours ?? ctx.snapshot.miniJobMaxMonthlyHours;
    if (total > limit + 1e-6) {
      const name = emp.displayName ?? employeeId!;
      errors.push({
        ruleId: "miniJobMonthlyHours",
        code: "MINI_JOB_CAP",
        message: ctx.targetFilter
          ? `${name}: Minijob-Stunden ${total.toFixed(1)}h überschreiten Limit ${limit}h.`
          : `Mini-job hours in month exceed limit (${total.toFixed(2)}h > ${limit}h).`,
        employeeIds: [employeeId!],
      });
    }
  }

  return { errors, warnings: [] };
}
