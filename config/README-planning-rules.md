# Planning rules configuration

Versioned defaults live in [`planning-rules.default.json`](./planning-rules.default.json). At runtime, numeric limits are merged with the facility row in Postgres (`minRestHours`, `miniJobMaxMonthlyHours`). Which rules run is controlled by the `rules[]` entries (`id`, `enabled`, optional `params`).

**How they run:** [`src/lib/planning/registry.ts`](../src/lib/planning/registry.ts) walks enabled ids in the snapshot and calls the matching function registered in [`src/lib/planning/registerBuiltInRules.ts`](../src/lib/planning/registerBuiltInRules.ts). Each rule reads [`RuleContext`](../src/lib/planning/types.ts) (assignments, employees, profiles, staffing, wishes, snapshot) and returns hard **errors** or soft **warnings**.

**Rule metadata:** Every rule is registered with a [`RuleDescriptor`](../src/lib/planning/types.ts) that declares its `id`, `severity` (`hard` | `soft`), `scope` (`employee` | `day` | `global`), and human-readable `description`. With it, `runScopedRules` can run only the rules of one scope, and the UI can show rule information.

Shared time math (shift start/end on a date, overnight end time, paid hours, date iteration) lives in [`src/lib/planning/time.ts`](../src/lib/planning/time.ts).

---

## Rules (what each one does)

### `noOverlap` — hard, employee scope

**Idea:** One person must not work two shifts whose time ranges overlap in real time (overnight shifts use the next calendar day for the end time).

**Code:** [`src/lib/planning/rules/noOverlap.ts`](../src/lib/planning/rules/noOverlap.ts) groups assignments by employee, builds intervals with `shiftIntervalMs`, then compares pairs (sorted by start). Missing shift profile → error `MISSING_PROFILE`.

---

### `minRestBetweenShifts` — hard, employee scope

**Idea:** After a shift ends, the next shift for the same person must start at least `minRestHours` later. Uses merged facility value on the snapshot (from DB).

**Code:** [`src/lib/planning/rules/minRestBetweenShifts.ts`](../src/lib/planning/rules/minRestBetweenShifts.ts); intervals from `shiftIntervalMs`. Assignments without a resolvable profile are skipped (overlap / data issues are handled elsewhere).

---

### `miniJobMonthlyHours` — hard, employee scope

**Idea:** For employees with contract `MINI_JOB`, total **paid** hours in a calendar month (UTC) cannot exceed their own `miniJobMaxMonthlyHours` if set, otherwise the facility default on the snapshot.

**Code:** [`src/lib/planning/rules/miniJobMonthlyHours.ts`](../src/lib/planning/rules/miniJobMonthlyHours.ts); hours per assignment via `assignmentPaidHours` (duration minus break).

---

### `maxConsecutiveNights` — hard, employee scope

**Idea:** An employee must not work more than N consecutive night shifts. Default N = 3 (configurable via `params.maxCount` in the JSON config or DB).

**Code:** [`src/lib/planning/rules/maxConsecutiveNights.ts`](../src/lib/planning/rules/maxConsecutiveNights.ts); groups NIGHT assignments by employee, sorts by UTC date, detects consecutive-day streaks exceeding the limit.

**Config example:** `{ "id": "maxConsecutiveNights", "enabled": true, "params": { "maxCount": 3 } }`

---

### `staffingMinimum` — hard, global scope

**Idea:** For each day in the schedule period and each [`StaffingRequirement`](../prisma/schema.prisma) row (day of week + shift type), count how many assignments use that shift type on that calendar day. Count must be ≥ `minStaffCount`.

**Code:** [`src/lib/planning/rules/staffingMinimum.ts`](../src/lib/planning/rules/staffingMinimum.ts).

---

### `qualificationCoverage` — hard, global scope

**Idea:** Where staffing lists `requiredQualificationTags`, each tag must appear on **at least one** assigned employee on that day/shift type (employee `qualificationTags` includes the tag). MVP: "at least one person with this tag," not a separate headcount per tag.

**Code:** [`src/lib/planning/rules/qualificationCoverage.ts`](../src/lib/planning/rules/qualificationCoverage.ts).

---

### `wishFulfillment`, `fairnessCounters`, `targetHoursBalance` — soft (stubs)

**Idea:** Placeholders for future policies (wishes, fairness, hour targets). They currently emit nothing.

**Code:** [`src/lib/planning/rules/softStubs.ts`](../src/lib/planning/rules/softStubs.ts).

---

## Scoped execution

Rules declare a **scope** in their descriptor:

- `employee` — validates constraints for individual employees (overlap, rest, hours, consecutive nights). Safe to run on a partial schedule.
- `day` — validates per-day constraints (reserved for future use).
- `global` — validates the complete roster (staffing minimums, qualification coverage). Only meaningful on a full schedule.

During schedule generation, the engine uses `runScopedRules(ctx, 'employee')` so that only employee-scoped rules are checked per tentative placement. Global rules are run once after the full roster is assembled.

---

## Add a new rule

1. **Module:** Create `src/lib/planning/rules/<name>.ts` implementing a `RuleFn` that reads `RuleContext` and returns `{ errors, warnings }`. Use `ruleId` matching your registry id on each message. Import shared helpers from `@/lib/planning/time`.

2. **Register with descriptor:** In `src/lib/planning/registerBuiltInRules.ts`, call:
   ```ts
   registerRule(
     {
       id: "<name>",
       severity: "hard",       // or "soft"
       scope: "employee",      // or "day" or "global"
       description: "Human-readable explanation of the rule.",
     },
     yourRuleFn,
   );
   ```

3. **JSON:** Add `{ "id": "<name>", "enabled": true }` (with `"params": { ... }` if needed) to `config/planning-rules.default.json`.

4. **Tests:** Add cases under `src/lib/planning/__tests__/planning-engine.test.ts` (or a focused `*.test.ts` next to the rule).

5. **Barrel:** Re-export new types if needed from `src/lib/planning/index.ts`.

Load defaults in code via `defaultPlanningRulesConfig` from `@/lib/planning/defaultConfig` (or `@/lib/planning`).
