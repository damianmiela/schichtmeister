# Planning rules configuration

Versioned defaults live in [`planning-rules.default.json`](./planning-rules.default.json). At runtime, numeric limits are merged with the facility row in Postgres (`minRestHours`, `miniJobMaxMonthlyHours`). Which rules run is controlled by the `rules[]` entries (`id`, `enabled`, optional `params`).

**How they run:** [`src/lib/planning/registry.ts`](../src/lib/planning/registry.ts) walks enabled ids in the snapshot and calls the matching function registered in [`src/lib/planning/registerBuiltInRules.ts`](../src/lib/planning/registerBuiltInRules.ts). Each rule reads [`RuleContext`](../src/lib/planning/types.ts) (assignments, employees, profiles, staffing, wishes, snapshot) and returns hard **errors** or soft **warnings**.

Shared time math (shift start/end on a date, overnight end time, paid hours) lives in [`src/lib/planning/time.ts`](../src/lib/planning/time.ts).

---

## Rules (what each one does)

### `noOverlap` — hard

**Idea:** One person must not work two shifts whose time ranges overlap in real time (overnight shifts use the next calendar day for the end time).

**Code:** [`src/lib/planning/rules/noOverlap.ts`](../src/lib/planning/rules/noOverlap.ts) groups assignments by employee, builds intervals with `shiftIntervalMs`, then compares pairs (sorted by start). Missing shift profile → error `MISSING_PROFILE`.

---

### `minRestBetweenShifts` — hard

**Idea:** After a shift ends, the next shift for the same person must start at least `minRestHours` later. Uses merged facility value on the snapshot (from DB).

**Code:** [`src/lib/planning/rules/minRestBetweenShifts.ts`](../src/lib/planning/rules/minRestBetweenShifts.ts); intervals from `shiftIntervalMs`. Assignments without a resolvable profile are skipped (overlap / data issues are handled elsewhere).

---

### `miniJobMonthlyHours` — hard

**Idea:** For employees with contract `MINI_JOB`, total **paid** hours in a calendar month (UTC) cannot exceed their own `miniJobMaxMonthlyHours` if set, otherwise the facility default on the snapshot.

**Code:** [`src/lib/planning/rules/miniJobMonthlyHours.ts`](../src/lib/planning/rules/miniJobMonthlyHours.ts); hours per assignment via `assignmentPaidHours` (duration minus break).

---

### `staffingMinimum` — hard

**Idea:** For each day in the schedule period and each [`StaffingRequirement`](../prisma/schema.prisma) row (day of week + shift type), count how many assignments use that shift type on that calendar day. Count must be ≥ `minStaffCount`.

**Code:** [`src/lib/planning/rules/staffingMinimum.ts`](../src/lib/planning/rules/staffingMinimum.ts).

---

### `qualificationCoverage` — hard

**Idea:** Where staffing lists `requiredQualificationTags`, each tag must appear on **at least one** assigned employee on that day/shift type (employee `qualificationTags` includes the tag). MVP: “at least one person with this tag,” not a separate headcount per tag.

**Code:** [`src/lib/planning/rules/qualificationCoverage.ts`](../src/lib/planning/rules/qualificationCoverage.ts).

---

### `wishFulfillment`, `fairnessCounters`, `targetHoursBalance` — soft (stubs)

**Idea:** Placeholders for future policies (wishes, fairness, hour targets). They currently emit nothing.

**Code:** [`src/lib/planning/rules/softStubs.ts`](../src/lib/planning/rules/softStubs.ts).

---

### `maxConsecutiveNights` (JSON toggle only)

**Idea:** `maxConsecutiveNights.enabled` is merged into [`PlanningRulesSnapshot`](../src/lib/planning/merge.ts) as `maxConsecutiveNightsEnabled`. There is **no** rule module for it yet; turning it on in JSON does not run extra checks until a rule is added.

---

## Add a new rule

1. **Module:** Implement a `RuleFn` in `src/lib/planning/rules/<name>.ts` that reads `RuleContext` and returns `{ errors, warnings }` with `ruleId` on each message (use the same string as the registry id).
2. **Register:** Call `registerRule("<id>", fn)` from `registerBuiltInPlanningRules()` in `src/lib/planning/registerBuiltInRules.ts`.
3. **JSON:** Add `{ "id": "<id>", "enabled": true }` (and `params` if needed) to `config/planning-rules.default.json`.
4. **Tests:** Add cases under `src/lib/planning/__tests__/planning-engine.test.ts` (or a focused `*.test.ts` next to the rule).

Load defaults in code via `defaultPlanningRulesConfig` from `@/lib/planning/defaultConfig` (or `@/lib/planning`).
