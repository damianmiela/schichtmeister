import type { RuleContext, RuleResult } from "@/lib/planning/types";

export function allowedShiftProfilesRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];
  
  for (const a of ctx.assignments) {
    const emp = ctx.employeesById.get(a.employeeId);
    if (!emp) continue;
    const allowed = emp.allowedShiftProfileIds;
    if (!allowed || allowed.length === 0) continue;
    if (!allowed.includes(a.shiftProfileId)) {
      errors.push({
        ruleId: "allowedShiftProfiles",
        code: "PROFILE_NOT_ALLOWED",
        message: `Employee ${a.employeeId} assigned to profile ${a.shiftProfileId} which is not in their allowed list.`,
        employeeIds: [a.employeeId],
      });
    }
  }
  return { errors, warnings: [] };
}
