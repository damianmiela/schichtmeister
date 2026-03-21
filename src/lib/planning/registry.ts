import type { RuleContext, RuleFn, RuleMessage } from "@/lib/planning/types";

const rules = new Map<string, RuleFn>();

export function registerRule(id: string, fn: RuleFn): void {
  rules.set(id, fn);
}

export function resetRuleRegistry(): void {
  rules.clear();
}

export function runAllRules(ctx: RuleContext): { errors: RuleMessage[]; warnings: RuleMessage[] } {
  const errors: RuleMessage[] = [];
  const warnings: RuleMessage[] = [];

  for (const [ruleId, state] of Object.entries(ctx.snapshot.ruleStates)) {
    if (!state.enabled) continue;
    const fn = rules.get(ruleId);
    if (!fn) continue;
    const out = fn(ctx);
    errors.push(...out.errors);
    warnings.push(...out.warnings);
  }

  return { errors, warnings };
}
