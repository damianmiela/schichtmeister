import type { Facility } from "@prisma/client";
import type { PlanningRulesConfig, PlanningRulesSnapshot } from "@/lib/planning/types";

function decimalToNumber(value: Facility["minRestHours"]): number {
  return Number(value);
}

export type FacilityRulesSlice = Pick<
  Facility,
  "minRestHours" | "miniJobMaxMonthlyHours" | "maxSolveTimeSeconds" | "ruleOverridesJson"
>;

type RuleOverrides = Record<string, { enabled?: boolean; params?: Record<string, unknown> }>;

function parseOverrides(json: string | null | undefined): RuleOverrides {
  if (!json) return {};
  try {
    return JSON.parse(json) as RuleOverrides;
  } catch {
    return {};
  }
}

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

  const overrides = parseOverrides(facility.ruleOverridesJson);
  for (const [ruleId, ov] of Object.entries(overrides)) {
    const existing = ruleStates[ruleId];
    if (existing) {
      if (ov.enabled !== undefined) existing.enabled = ov.enabled;
      if (ov.params) existing.params = { ...existing.params, ...ov.params };
    } else {
      ruleStates[ruleId] = {
        enabled: ov.enabled ?? false,
        params: ov.params ?? {},
      };
    }
  }

  return {
    schemaVersion: defaultConfig.schemaVersion,
    minRestHours: decimalToNumber(facility.minRestHours),
    miniJobMaxMonthlyHours: decimalToNumber(facility.miniJobMaxMonthlyHours),
    maxConsecutiveNightsEnabled: defaultConfig.maxConsecutiveNights?.enabled ?? false,
    ruleStates,
  };
}
