import type { RuleContext, RuleResult } from "@/lib/planning/types";

export function allowedShiftProfilesRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];

  for (const a of ctx.assignments) {
    // When targeted, only check the target employee
    if (ctx.targetFilter && a.employeeId !== ctx.targetFilter.employeeId) continue;

    const emp = ctx.employeesById.get(a.employeeId);
    if (!emp) continue;
    const allowed = emp.allowedShiftProfileIds;
    if (!allowed || allowed.length === 0) continue;
    if (!allowed.includes(a.shiftProfileId)) {
      const name = emp.displayName ?? a.employeeId;
      const profileName = ctx.profilesById.get(a.shiftProfileId)?.id ?? a.shiftProfileId;
      errors.push({
        ruleId: "allowedShiftProfiles",
        code: "PROFILE_NOT_ALLOWED",
        message: ctx.targetFilter
          ? `${name} darf dieses Schichtprofil nicht arbeiten.`
          : `Employee ${a.employeeId} assigned to profile ${a.shiftProfileId} which is not in their allowed list.`,
        employeeIds: [a.employeeId],
      });
    }
  }
  return { errors, warnings: [] };
}
