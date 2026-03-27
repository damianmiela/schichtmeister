import type { RuleContext, RuleDescriptor, RuleFn, RuleMessage, RuleScope } from "@/lib/planning/types";

type RuleEntry = { descriptor: RuleDescriptor; fn: RuleFn };

const rules = new Map<string, RuleEntry>();

export function registerRule(descriptor: RuleDescriptor, fn: RuleFn): void {
  rules.set(descriptor.id, { descriptor, fn });
}

export function resetRuleRegistry(): void {
  rules.clear();
}

export function getRegisteredRules(): RuleDescriptor[] {
  return [...rules.values()].map((e) => e.descriptor);
}

export function runAllRules(ctx: RuleContext): { errors: RuleMessage[]; warnings: RuleMessage[] } {
  const errors: RuleMessage[] = [];
  const warnings: RuleMessage[] = [];

  for (const [ruleId, state] of Object.entries(ctx.snapshot.ruleStates)) {
    if (!state.enabled) continue;
    const entry = rules.get(ruleId);
    if (!entry) continue;
    const out = entry.fn(ctx);
    errors.push(...out.errors);
    warnings.push(...out.warnings);
  }

  return { errors, warnings };
}

/**
 * Run only rules whose descriptor matches the given scope. Useful during
 * incremental generation where global-scope rules (staffing, qualification)
 * would always fail on a partial schedule.
 */
export function runScopedRules(
  ctx: RuleContext,
  scope: RuleScope,
): { errors: RuleMessage[]; warnings: RuleMessage[] } {
  const errors: RuleMessage[] = [];
  const warnings: RuleMessage[] = [];

  for (const [ruleId, state] of Object.entries(ctx.snapshot.ruleStates)) {
    if (!state.enabled) continue;
    const entry = rules.get(ruleId);
    if (!entry) continue;
    if (entry.descriptor.scope !== scope) continue;
    const out = entry.fn(ctx);
    errors.push(...out.errors);
    warnings.push(...out.warnings);
  }

  return { errors, warnings };
}
