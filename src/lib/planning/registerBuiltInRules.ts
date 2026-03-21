import { registerRule } from "@/lib/planning/registry";
import { fairnessCountersRule, targetHoursBalanceRule, wishFulfillmentRule } from "@/lib/planning/rules/softStubs";
import { minRestBetweenShiftsRule } from "@/lib/planning/rules/minRestBetweenShifts";
import { miniJobMonthlyHoursRule } from "@/lib/planning/rules/miniJobMonthlyHours";
import { noOverlapRule } from "@/lib/planning/rules/noOverlap";
import { qualificationCoverageRule } from "@/lib/planning/rules/qualificationCoverage";
import { staffingMinimumRule } from "@/lib/planning/rules/staffingMinimum";

/** Idempotent: overwrites any prior registration for the same rule ids. */
export function registerBuiltInPlanningRules(): void {
  registerRule("noOverlap", noOverlapRule);
  registerRule("minRestBetweenShifts", minRestBetweenShiftsRule);
  registerRule("miniJobMonthlyHours", miniJobMonthlyHoursRule);
  registerRule("staffingMinimum", staffingMinimumRule);
  registerRule("qualificationCoverage", qualificationCoverageRule);
  registerRule("wishFulfillment", wishFulfillmentRule);
  registerRule("fairnessCounters", fairnessCountersRule);
  registerRule("targetHoursBalance", targetHoursBalanceRule);
}
