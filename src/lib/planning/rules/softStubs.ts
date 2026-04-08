import type { RuleFn } from "@/lib/planning/types";

/** Placeholder: policies not defined; only emits when explicitly enabled later. */
export const wishFulfillmentRule: RuleFn = () => ({ errors: [], warnings: [] });

export const fairnessCountersRule: RuleFn = () => ({ errors: [], warnings: [] });

export const targetHoursBalanceRule: RuleFn = () => ({ errors: [], warnings: [] });

export const restAfter6DaysRule: RuleFn = () => ({ errors: [], warnings: [] });

export const wblWeekendLimitRule: RuleFn = () => ({ errors: [], warnings: [] });
