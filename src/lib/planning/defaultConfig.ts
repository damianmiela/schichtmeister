import defaultRaw from "../../../config/planning-rules.default.json";
import { parsePlanningRulesConfig } from "@/lib/planning/rules/schema";
import type { PlanningRulesConfig } from "@/lib/planning/types";

export const defaultPlanningRulesConfig: PlanningRulesConfig =
  parsePlanningRulesConfig(defaultRaw);
