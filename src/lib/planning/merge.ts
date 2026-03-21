import type { Facility } from "@prisma/client";
import type { PlanningRulesConfig, PlanningRulesSnapshot } from "@/lib/planning/types";

function decimalToNumber(value: Facility["minRestHours"]): number {
  return Number(value);
}

export type FacilityRulesSlice = Pick<
  Facility,
  "minRestHours" | "miniJobMaxMonthlyHours"
>;

export function mergePlanningRules(
  facility: FacilityRulesSlice,
  defaultConfig: PlanningRulesConfig,
): PlanningRulesSnapshot {
  const ruleStates: PlanningRulesSnapshot["ruleStates"] = {};
  for (const r of defaultConfig.rules) {
    ruleStates[r.id] = {
      enabled: r.enabled,
      params: r.params ?? {},
    };
  }

  return {
    schemaVersion: defaultConfig.schemaVersion,
    minRestHours: decimalToNumber(facility.minRestHours),
    miniJobMaxMonthlyHours: decimalToNumber(facility.miniJobMaxMonthlyHours),
    maxConsecutiveNightsEnabled: defaultConfig.maxConsecutiveNights?.enabled ?? false,
    ruleStates,
  };
}
