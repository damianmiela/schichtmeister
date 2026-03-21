import { z } from "zod";
import type { PlanningRulesConfig } from "@/lib/planning/types";

const PlanningRuleEntrySchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const PlanningRulesConfigSchema = z.object({
  schemaVersion: z.number().int().nonnegative(),
  maxConsecutiveNights: z.object({ enabled: z.boolean() }).optional(),
  rules: z.array(PlanningRuleEntrySchema).default([]),
});

export function parsePlanningRulesConfig(data: unknown): PlanningRulesConfig {
  const parsed = PlanningRulesConfigSchema.parse(data);
  return {
    schemaVersion: parsed.schemaVersion,
    maxConsecutiveNights: parsed.maxConsecutiveNights,
    rules: parsed.rules.map((r) => ({
      id: r.id,
      enabled: r.enabled,
      params: r.params,
    })),
  };
}
