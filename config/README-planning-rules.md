# Planning rules configuration

Versioned defaults live in [`planning-rules.default.json`](./planning-rules.default.json). At runtime, numeric limits are merged with the facility row in Postgres (`minRestHours`, `miniJobMaxMonthlyHours`). Which rules run is controlled by the `rules[]` entries (`id`, `enabled`, optional `params`).

## Add a new rule

1. **Module:** Implement a `RuleFn` in `src/lib/planning/rules/<name>.ts` that reads `RuleContext` and returns `{ errors, warnings }` with `ruleId` on each message (use the same string as the registry id).
2. **Register:** Call `registerRule("<id>", fn)` from `registerBuiltInPlanningRules()` in `src/lib/planning/registerBuiltInRules.ts`.
3. **JSON:** Add `{ "id": "<id>", "enabled": true }` (and `params` if needed) to `config/planning-rules.default.json`.
4. **Tests:** Add cases under `src/lib/planning/__tests__/planning-engine.test.ts` (or a focused `*.test.ts` next to the rule).

Load defaults in code via `defaultPlanningRulesConfig` from `@/lib/planning/defaultConfig` (or `@/lib/planning`).
