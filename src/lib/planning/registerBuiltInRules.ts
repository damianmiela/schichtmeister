import { registerRule } from "@/lib/planning/registry";
import { fairnessCountersRule, targetHoursBalanceRule, wishFulfillmentRule } from "@/lib/planning/rules/softStubs";
import { maxConsecutiveNightsRule } from "@/lib/planning/rules/maxConsecutiveNights";
import { minRestBetweenShiftsRule } from "@/lib/planning/rules/minRestBetweenShifts";
import { miniJobMonthlyHoursRule } from "@/lib/planning/rules/miniJobMonthlyHours";
import { noOverlapRule } from "@/lib/planning/rules/noOverlap";
import { qualificationCoverageRule } from "@/lib/planning/rules/qualificationCoverage";
import { staffingMinimumRule } from "@/lib/planning/rules/staffingMinimum";

/** Idempotent: overwrites any prior registration for the same rule ids. */
export function registerBuiltInPlanningRules(): void {
  registerRule(
    { id: "noOverlap", severity: "hard", scope: "employee", description: "No overlapping shift assignments for the same employee." },
    noOverlapRule,
  );
  registerRule(
    { id: "minRestBetweenShifts", severity: "hard", scope: "employee", description: "Minimum rest hours between consecutive shifts for the same employee." },
    minRestBetweenShiftsRule,
  );
  registerRule(
    { id: "miniJobMonthlyHours", severity: "hard", scope: "employee", description: "Mini-job employees must not exceed their monthly hours cap." },
    miniJobMonthlyHoursRule,
  );
  registerRule(
    { id: "staffingMinimum", severity: "hard", scope: "global", description: "Minimum staff count per shift type per day must be met." },
    staffingMinimumRule,
  );
  registerRule(
    { id: "qualificationCoverage", severity: "hard", scope: "global", description: "Required qualification tags must be covered by at least one assigned employee per shift." },
    qualificationCoverageRule,
  );
  registerRule(
    { id: "wishFulfillment", severity: "soft", scope: "global", description: "Warn when employee shift wishes are not fulfilled." },
    wishFulfillmentRule,
  );
  registerRule(
    { id: "fairnessCounters", severity: "soft", scope: "global", description: "Warn on uneven distribution of nights and weekends." },
    fairnessCountersRule,
  );
  registerRule(
    { id: "targetHoursBalance", severity: "soft", scope: "employee", description: "Warn when an employee is significantly over or under target hours." },
    targetHoursBalanceRule,
  );
  registerRule(
    { id: "maxConsecutiveNights", severity: "hard", scope: "employee", description: "Limit consecutive night shifts per employee (default 3)." },
    maxConsecutiveNightsRule,
  );
}
