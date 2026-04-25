/**
 * Solver weight definitions, defaults, strategy templates, and validation.
 * TypeScript mirror of solver/config.py — defaults must stay byte-identical
 * with the Python file. When you change one, change the other.
 *
 * Used by:
 *   - /api/admin/solver-weights (GET returns full config; PUT validates)
 *   - SolverWeightsTab admin UI (3-zone editor: common + 2 strategy columns)
 *   - generate-stream route (resolves active weights from strategy + config)
 *   - Pre-generation modal (toggle for strategy choice)
 *
 * ─────────────────────────────────────────────────────────────────────
 * The two-strategy model
 * ─────────────────────────────────────────────────────────────────────
 *
 * The user picks ONE strategy per schedule generation:
 *
 *  • PREFER_FULL_COVERAGE  → "Vollabdeckung anstreben" (DEFAULT)
 *      Solver fills every required slot, paying overtime and (in extreme
 *      cases) breaking soft Phase-2 rules to do so.
 *
 *  • PREFER_GAPS           → "Lieber Slot leer lassen"
 *      Solver leaves slots empty before paying expensive overtime or
 *      breaking weekend / consec-day / rest-after rules.
 *
 * Of the 38 weights, only ~13 actually need to differ between the two
 * strategies (W_STAFFING_MIN, the three overtime weights, W_QUALIFICATION,
 * W_WBL_BL, and 7 W_RELAX_*). The other 25 are "common" — same value
 * regardless of which strategy is active.
 */

// ───────────────────────────────────────────────────────────────────────
// Default weight values — must match DEFAULT_W_* in solver/config.py
// ───────────────────────────────────────────────────────────────────────

export const DEFAULT_WEIGHTS = {
  // Tier 1 — Coverage
  W_QUALIFICATION: 5_000_000,
  W_STAFFING_MIN: 3_000_000,
  W_WBL_BL: 500_000,
  // Tier 2 — Utilization
  W_MIN_UTIL: 30_000,
  // Tier 3a — Generic Soll-deviation
  W_SOLL_DEV: 100,
  W_UNDERCUT: 150,
  W_FAIRNESS: 50,
  // Tier 3b — Flat overtime
  W_OVERTIME_FT: 30,
  W_OVERTIME_PT: 200,
  W_OVERTIME_MINI: 2_000,
  // Tier 3c — Under-Soll hard
  W_SOLL_HARD_FT: 50,
  W_SOLL_HARD_PT: 300,
  W_SOLL_HARD_MINI: 3_000,
  // Tier 3d — Over-Soll piecewise ladder
  W_OVER_SOLL_T1_FT: 50,
  W_OVER_SOLL_T2_FT: 150,
  W_OVER_SOLL_T3_FT: 400,
  W_OVER_SOLL_T4_FT: 1_000,
  W_OVER_SOLL_T1_PT: 150,
  W_OVER_SOLL_T2_PT: 400,
  W_OVER_SOLL_T3_PT: 1_000,
  W_OVER_SOLL_T4_PT: 2_500,
  W_OVER_SOLL_T1_MINI: 1_000,
  W_OVER_SOLL_T2_MINI: 3_000,
  W_OVER_SOLL_T3_MINI: 8_000,
  W_OVER_SOLL_T4_MINI: 20_000,
  // Tier 3e — Fairness max-OT cap
  W_MAX_OT_FT: 300,
  W_MAX_OT_PT: 1_000,
  // Tier 4 — Wishes & preferences
  W_WISH_NORMAL: 3_000,
  W_WISH_STRONG: 6_000,
  W_PREFERENCE: 1,
  W_DISTRIBUTION: 500,
  // Tier 5 — Cross-month boundary
  W_WEEKEND_BOUNDARY: 10_000,
  W_CONSEC_DAYS_BOUNDARY: 500_000,
  W_REST_AFTER_6_BOUNDARY: 30_000,
  // Tier -1 — Relaxed-mode (Phase 2)
  W_RELAX_MIN_REST: 20_000_000,
  W_RELAX_CONSEC_NIGHTS: 15_000_000,
  W_RELAX_CONSEC_DAYS: 15_000_000,
  W_RELAX_STAFFING_MAX: 8_000_000,
  W_RELAX_MINI_JOB_CAP: 6_000_000,
  W_RELAX_WBL_WEEKEND_LIMIT: 1_500_000,
  W_RELAX_WBL_BL_MAX_PER_WEEK: 1_000_000,
  W_RELAX_WBL_BL_WEEKLY_MIN: 800_000,
  W_RELAX_REST_AFTER_6: 300_000,
  W_RELAX_ALT_WEEKENDS: 100_000,
} as const;

export type WeightKey = keyof typeof DEFAULT_WEIGHTS;
export type WeightMap = Partial<Record<WeightKey, number>>;

export const WEIGHT_KEYS: readonly WeightKey[] = Object.keys(
  DEFAULT_WEIGHTS,
) as WeightKey[];

// ───────────────────────────────────────────────────────────────────────
// Strategies & template scope
// ───────────────────────────────────────────────────────────────────────

export type Strategy = "PREFER_FULL_COVERAGE" | "PREFER_GAPS";

export const DEFAULT_STRATEGY: Strategy = "PREFER_FULL_COVERAGE";

export const STRATEGY_LABELS: Record<Strategy, string> = {
  PREFER_FULL_COVERAGE: "Vollabdeckung anstreben",
  PREFER_GAPS: "Lieber Slot leer lassen",
};

export const STRATEGY_DESCRIPTIONS: Record<Strategy, string> = {
  PREFER_FULL_COVERAGE:
    "Standard. Der Solver füllt jeden Pflicht-Slot, auch wenn dafür Überstunden gegeben oder im Notfall weiche Regeln (Wechsel-Wochenenden, max. Tage in Folge, Ruhe nach 6+ Tagen) gebrochen werden müssen.",
  PREFER_GAPS:
    "Der Solver lässt Slots lieber unbesetzt als Überstunden zu vergeben oder Regeln zu brechen. Der Planer füllt die Lücken anschließend von Hand. Sinnvoll wenn das Team die Mehrarbeit selbst entscheiden soll.",
};

/** Which weights differ between the two strategies. The other ~25 are
 * "common" and shared across both. This list is the SINGLE SOURCE OF
 * TRUTH for the split — used by the validator, the resolver, and the
 * admin UI's 3-zone editor. */
export const STRATEGY_SPECIFIC_KEYS: readonly WeightKey[] = [
  // Tier 1 — must scale together so qualification ≥ staffing ≥ WBL holds
  "W_QUALIFICATION",
  "W_STAFFING_MIN",
  "W_WBL_BL",
  // Tier 3b — overtime cost (cheap in B, expensive in A).
  // Note: W_OVERTIME_MINI is no longer in this list — MJ employees are no
  // longer auto-planned (autoPlanDisabled), so the weight is unused and
  // not exposed in the admin UI. Default value preserved in DEFAULT_WEIGHTS
  // for backwards compat with stored configs.
  "W_OVERTIME_FT",
  "W_OVERTIME_PT",
  // Tier -1 — relax weights that flip role between strategies
  "W_RELAX_MIN_REST",
  "W_RELAX_CONSEC_NIGHTS",
  "W_RELAX_CONSEC_DAYS",
  "W_RELAX_STAFFING_MAX",
  "W_RELAX_MINI_JOB_CAP",
  "W_RELAX_REST_AFTER_6",
  "W_RELAX_ALT_WEEKENDS",
] as const;

const STRATEGY_KEY_SET = new Set<WeightKey>(STRATEGY_SPECIFIC_KEYS);

/** True if a given weight is strategy-specific (differs between A and B). */
export function isStrategySpecific(k: WeightKey): boolean {
  return STRATEGY_KEY_SET.has(k);
}

/** Built-in template values for "Vollabdeckung anstreben". This is just
 * the factory-default value for each strategy-specific weight — Template B
 * is the historical default behavior. */
export const TEMPLATE_B_FACTORY_DEFAULTS: Partial<Record<WeightKey, number>> = (() => {
  const out: Partial<Record<WeightKey, number>> = {};
  for (const k of STRATEGY_SPECIFIC_KEYS) {
    out[k] = DEFAULT_WEIGHTS[k];
  }
  return out as Record<(typeof STRATEGY_SPECIFIC_KEYS)[number], number>;
})();

/** Built-in template values for "Lieber Slot leer lassen". Carefully
 * tuned so leaving a slot empty (W_STAFFING_MIN = 50_000) is cheaper than
 * any of: paying 1+ hour of overtime, or breaking any Phase-2 rule.
 *
 * Validation invariants this set respects:
 *   - W_QUALIFICATION (150k) ≥ W_STAFFING_MIN (50k)        ✓
 *   - W_STAFFING_MIN (50k) ≥ W_WBL_BL (20k)                ✓
 *   - W_OVERTIME_FT ≤ W_OVERTIME_PT ≤ W_OVERTIME_MINI       ✓
 *   - W_RELAX_MIN_REST (1M) ≥ W_STAFFING_MIN (50k)         ✓ (physical/legal)
 *   - W_RELAX_CONSEC_NIGHTS / DAYS / STAFFING_MAX / MJ_CAP ≥ staffing   ✓
 *   - W_RELAX_REST_AFTER_6 (100k) > W_STAFFING_MIN (50k)   ✓ INVERTED
 *   - W_RELAX_ALT_WEEKENDS (100k) > W_STAFFING_MIN (50k)   ✓ INVERTED
 *
 * The last two inversions are the whole point of this template: when
 * something has to give, leaving a slot empty (50k) wins over breaking
 * the rule (100k).
 */
export const TEMPLATE_A_FACTORY_DEFAULTS: Partial<Record<WeightKey, number>> = {
  // Tier 1 — scaled down so leaving slot empty is cheap
  W_QUALIFICATION: 150_000,
  W_STAFFING_MIN: 50_000,
  W_WBL_BL: 20_000,
  // Tier 3b — overtime made expensive (~50k/h FT, 100k/h PT)
  // (W_OVERTIME_MINI dropped — MJ no longer auto-planned)
  W_OVERTIME_FT: 500,
  W_OVERTIME_PT: 1_000,
  // Tier -1 — physical/legal rules stay near-hard but scaled to new staffing
  W_RELAX_MIN_REST: 1_000_000,
  W_RELAX_CONSEC_NIGHTS: 500_000,
  W_RELAX_CONSEC_DAYS: 500_000,
  W_RELAX_STAFFING_MAX: 200_000,
  W_RELAX_MINI_JOB_CAP: 200_000,
  // Tier -1 — flipped above staffing (the actual "prefer empty" mechanism)
  W_RELAX_REST_AFTER_6: 100_000,
  W_RELAX_ALT_WEEKENDS: 100_000,
};

/** Resolve the active 38-weight map from (strategy, common overrides,
 * per-template overrides). Order: factory defaults → strategy template
 * → admin's common overrides → admin's template overrides → final. */
export function resolveActiveWeights(
  strategy: Strategy,
  config: WeightsConfig,
): Record<WeightKey, number> {
  const out: Record<WeightKey, number> = { ...DEFAULT_WEIGHTS };

  // Layer 1: factory template for the chosen strategy (only strategy keys)
  const factoryTemplate =
    strategy === "PREFER_GAPS"
      ? TEMPLATE_A_FACTORY_DEFAULTS
      : TEMPLATE_B_FACTORY_DEFAULTS;
  for (const k of STRATEGY_SPECIFIC_KEYS) {
    const v = factoryTemplate[k];
    if (typeof v === "number") out[k] = v;
  }

  // Layer 2: admin's common overrides (non-strategy keys only)
  for (const k of WEIGHT_KEYS) {
    if (STRATEGY_KEY_SET.has(k)) continue;
    const v = config.common?.[k];
    if (typeof v === "number") out[k] = v;
  }

  // Layer 3: admin's per-template overrides (strategy keys only)
  const templateOverrides =
    strategy === "PREFER_GAPS" ? config.templateA : config.templateB;
  for (const k of STRATEGY_SPECIFIC_KEYS) {
    const v = templateOverrides?.[k];
    if (typeof v === "number") out[k] = v;
  }

  return out;
}

// ───────────────────────────────────────────────────────────────────────
// Per-weight metadata for the admin UI
// ───────────────────────────────────────────────────────────────────────

export type WeightTier =
  | "tier_1_coverage"
  | "tier_2_utilization"
  | "tier_3a_soll_deviation"
  | "tier_3b_overtime"
  | "tier_3c_undersoll"
  | "tier_3d_oversoll_ladder"
  | "tier_3e_fairness_cap"
  | "tier_4_wishes"
  | "tier_5_boundary"
  | "tier_neg1_relax";

export const TIER_LABELS: Record<WeightTier, string> = {
  tier_1_coverage: "Tier 1 — Abdeckung",
  tier_2_utilization: "Tier 2 — Auslastung",
  tier_3a_soll_deviation: "Tier 3a — Soll-Abweichung (allgemein)",
  tier_3b_overtime: "Tier 3b — Überstunden über Hard-Cap",
  tier_3c_undersoll: "Tier 3c — Unter-Soll Hard-Strafe",
  tier_3d_oversoll_ladder: "Tier 3d — Über-Soll Treppen-Strafe",
  tier_3e_fairness_cap: "Tier 3e — Fairness-Spitzenkappung",
  tier_4_wishes: "Tier 4 — Wünsche & Präferenzen",
  tier_5_boundary: "Tier 5 — Monatsgrenze (Übertrag)",
  tier_neg1_relax: "Tier −1 — Relaxed-Modus (Phase 2 Notfall)",
};

export type WeightDef = {
  key: WeightKey;
  tier: WeightTier;
  label: string;
  description: string;
  /** Effective €/hour cost when applied to a per-hour SCALE'd variable. */
  perHourCost?: number;
};

const SCALE = 100;

export const WEIGHT_DEFINITIONS: readonly WeightDef[] = [
  { key: "W_QUALIFICATION", tier: "tier_1_coverage",
    label: "Qualifikation unbesetzt",
    description: "Strafe wenn ein Pflicht-Slot mit benötigter Qualifikation leer bleibt." },
  { key: "W_STAFFING_MIN", tier: "tier_1_coverage",
    label: "Headcount unter Minimum",
    description: "Strafe pro fehlender Person pro Schicht unter dem konfigurierten Minimum." },
  { key: "W_WBL_BL", tier: "tier_1_coverage",
    label: "WBL ohne BL-Schicht",
    description: "Strafe wenn eine WBL-Mitarbeiterin in einer arbeitbaren ISO-Woche keine BL-Schicht bekommt." },
  { key: "W_MIN_UTIL", tier: "tier_2_utilization",
    label: "Unterauslastung",
    description: "Strafe wenn ein Mitarbeiter weit weniger Schichten als vertraglich erwartet bekommt." },
  { key: "W_SOLL_DEV", tier: "tier_3a_soll_deviation",
    label: "Soll-Abweichung allgemein",
    description: "Sanfte Strafe für Abweichung vom Monats-Soll (beidseitig)." },
  { key: "W_UNDERCUT", tier: "tier_3a_soll_deviation",
    label: "Stunden unter Soll",
    description: "Drückt den Solver dazu, Mitarbeiter aufzufüllen." },
  { key: "W_FAIRNESS", tier: "tier_3a_soll_deviation",
    label: "Fairness Soll-Spreizung",
    description: "Strafe für die Spreizung der Abweichungen über alle Mitarbeiter." },
  { key: "W_OVERTIME_FT", tier: "tier_3b_overtime",
    label: "Überstunden FT (Stunde)",
    description: "Strafe pro Stunde über Soll + maxOvertimeHours für Vollzeit.",
    perHourCost: DEFAULT_WEIGHTS.W_OVERTIME_FT * SCALE },
  { key: "W_OVERTIME_PT", tier: "tier_3b_overtime",
    label: "Überstunden PT (Stunde)",
    description: "Strafe pro Stunde Überstunden für Teilzeit.",
    perHourCost: DEFAULT_WEIGHTS.W_OVERTIME_PT * SCALE },
  // W_OVERTIME_MINI removed: MJ employees are no longer auto-planned
  // (autoPlanDisabled), so this weight applies to nobody. Default value
  // still exists in DEFAULT_WEIGHTS for backwards compat with stored configs.
  { key: "W_SOLL_HARD_FT", tier: "tier_3c_undersoll",
    label: "Unter-Soll FT (Stunde)",
    description: "Strafe pro Stunde unter Soll + min_delta für Vollzeit.",
    perHourCost: DEFAULT_WEIGHTS.W_SOLL_HARD_FT * SCALE },
  { key: "W_SOLL_HARD_PT", tier: "tier_3c_undersoll",
    label: "Unter-Soll PT (Stunde)",
    description: "Strafe pro Stunde unter Soll für Teilzeit.",
    perHourCost: DEFAULT_WEIGHTS.W_SOLL_HARD_PT * SCALE },
  // W_SOLL_HARD_MINI removed: MJ no longer auto-planned.
  { key: "W_OVER_SOLL_T1_FT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll FT T1 (0..+4h)", description: "FT, 0–4h über Soll.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T1_FT * SCALE },
  { key: "W_OVER_SOLL_T2_FT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll FT T2 (+4..+8h)", description: "FT, +4–8h über Soll.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T2_FT * SCALE },
  { key: "W_OVER_SOLL_T3_FT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll FT T3 (+8..+16h)", description: "FT, +8–16h über Soll.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T3_FT * SCALE },
  { key: "W_OVER_SOLL_T4_FT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll FT T4 (+16h+)", description: "FT, +16h+ über Soll.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T4_FT * SCALE },
  { key: "W_OVER_SOLL_T1_PT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll PT T1 (0..+4h)", description: "PT, 0–4h über Soll.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T1_PT * SCALE },
  { key: "W_OVER_SOLL_T2_PT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll PT T2 (+4..+8h)", description: "PT, +4–8h über Soll.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T2_PT * SCALE },
  { key: "W_OVER_SOLL_T3_PT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll PT T3 (+8..+16h)", description: "PT, +8–16h über Soll.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T3_PT * SCALE },
  { key: "W_OVER_SOLL_T4_PT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll PT T4 (+16h+)", description: "PT, +16h+ über Soll.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T4_PT * SCALE },
  // 4×W_OVER_SOLL_T*_MINI removed: MJ no longer auto-planned, ladder unused.
  { key: "W_MAX_OT_FT", tier: "tier_3e_fairness_cap",
    label: "Max-Über-Soll Cap FT (Stunde)",
    description: "Strafe für die FT-Person mit größter Über-Soll-Spitze.",
    perHourCost: DEFAULT_WEIGHTS.W_MAX_OT_FT * SCALE },
  { key: "W_MAX_OT_PT", tier: "tier_3e_fairness_cap",
    label: "Max-Über-Soll Cap PT (Stunde)",
    description: "Wie oben, für PT.",
    perHourCost: DEFAULT_WEIGHTS.W_MAX_OT_PT * SCALE },
  { key: "W_WISH_NORMAL", tier: "tier_4_wishes",
    label: "Wunsch nicht erfüllt", description: "Strafe für nicht erfüllten Wunsch (NORMAL)." },
  { key: "W_WISH_STRONG", tier: "tier_4_wishes",
    label: "Starker Wunsch nicht erfüllt", description: "Strafe für nicht erfüllten Wunsch (STRONG)." },
  { key: "W_PREFERENCE", tier: "tier_4_wishes",
    label: "Schichtart außerhalb Präferenz", description: "Sehr kleiner Tiebreaker." },
  { key: "W_DISTRIBUTION", tier: "tier_4_wishes",
    label: "Schicht-Verteilungs-Abweichung", description: "Strafe für Abweichung vom Profil-Mix." },
  { key: "W_WEEKEND_BOUNDARY", tier: "tier_5_boundary",
    label: "Wochenend-Übertrag", description: "Vormonats-Übertrag verletzt Wechsel-Wochenenden." },
  { key: "W_CONSEC_DAYS_BOUNDARY", tier: "tier_5_boundary",
    label: "Aufeinanderfolgende-Tage-Übertrag", description: "Übertrag erzeugt zu lange Tage-Strähne." },
  { key: "W_REST_AFTER_6_BOUNDARY", tier: "tier_5_boundary",
    label: "Ruhe nach 6+ Tagen Übertrag", description: "Nach 6+ Tagen am Vormonatsende fehlen Ruhetage." },
  { key: "W_RELAX_MIN_REST", tier: "tier_neg1_relax",
    label: "Relax: 11h Ruhe zw. Schichten", description: "Phase-2-Strafe wenn min. 11h Ruhe gebrochen wird." },
  { key: "W_RELAX_CONSEC_NIGHTS", tier: "tier_neg1_relax",
    label: "Relax: max Nachtschichten in Folge", description: "Phase-2-Strafe für zu viele Nachtschichten in Folge." },
  { key: "W_RELAX_CONSEC_DAYS", tier: "tier_neg1_relax",
    label: "Relax: max Tage in Folge", description: "Phase-2-Strafe für zu viele Arbeitstage in Folge." },
  { key: "W_RELAX_STAFFING_MAX", tier: "tier_neg1_relax",
    label: "Relax: Headcount-Maximum", description: "Phase-2-Strafe für Überbelegung einer Schicht." },
  { key: "W_RELAX_MINI_JOB_CAP", tier: "tier_neg1_relax",
    label: "Relax: MJ Stunden-Limit", description: "Phase-2-Strafe für MJ über gesetzlichem Monatslimit." },
  { key: "W_RELAX_WBL_WEEKEND_LIMIT", tier: "tier_neg1_relax",
    label: "Relax: WBL Wochenend-Limit", description: "Phase-2-Strafe für WBL über max Wochenend-Tage." },
  { key: "W_RELAX_WBL_BL_MAX_PER_WEEK", tier: "tier_neg1_relax",
    label: "Relax: WBL BL max 1×/Woche", description: "Phase-2-Strafe für mehr als eine BL-Schicht pro Woche bei WBL." },
  { key: "W_RELAX_WBL_BL_WEEKLY_MIN", tier: "tier_neg1_relax",
    label: "Relax: WBL BL min 1×/Woche", description: "Phase-2-Strafe wenn WBL keine BL-Schicht in arbeitbarer Woche bekommt." },
  { key: "W_RELAX_REST_AFTER_6", tier: "tier_neg1_relax",
    label: "Relax: Ruhe nach 6+ Tagen",
    description: "Phase-2-Strafe — bei Strategie A bewusst über W_STAFFING_MIN, bei Strategie B darunter." },
  { key: "W_RELAX_ALT_WEEKENDS", tier: "tier_neg1_relax",
    label: "Relax: Wechsel-Wochenenden",
    description: "Phase-2-Strafe — bei Strategie A bewusst über W_STAFFING_MIN, bei Strategie B darunter." },
];

// ───────────────────────────────────────────────────────────────────────
// Config object (DB shape) + parser/serializer
// ───────────────────────────────────────────────────────────────────────

/** What's stored in Facility.solverWeightsJson. All three sub-maps are
 * optional, and within each sub-map only fields that DIFFER from the
 * factory default are stored (compact JSON). */
export type WeightsConfig = {
  /** Overrides for the ~25 weights that are SAME across both strategies. */
  common?: WeightMap;
  /** Strategy-specific overrides for "Lieber Slot leer lassen". */
  templateA?: WeightMap;
  /** Strategy-specific overrides for "Vollabdeckung anstreben". */
  templateB?: WeightMap;
};

/** Parse the stored JSON column into a WeightsConfig. Tolerant — falls
 * back to {} on malformed input. Only known keys are kept. */
export function parseWeightsConfig(
  raw: string | null | undefined,
): WeightsConfig {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return {};
    return {
      common: pickValidWeights(obj.common, /*strategyKeysAllowed*/ false),
      templateA: pickValidWeights(obj.templateA, /*strategyKeysAllowed*/ true, true),
      templateB: pickValidWeights(obj.templateB, /*strategyKeysAllowed*/ true, true),
    };
  } catch {
    return {};
  }
}

function pickValidWeights(
  raw: unknown,
  strategyKeysAllowed: boolean,
  strategyKeysOnly: boolean = false,
): WeightMap | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: WeightMap = {};
  for (const k of WEIGHT_KEYS) {
    const isStrategy = STRATEGY_KEY_SET.has(k);
    if (strategyKeysOnly && !isStrategy) continue;
    if (!strategyKeysAllowed && isStrategy) continue;
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isInteger(v)) {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Strip out fields that match the relevant default — keeps DB JSON small.
 * Per-template overrides are pruned against TEMPLATE_*_FACTORY_DEFAULTS,
 * common overrides against DEFAULT_WEIGHTS. */
export function pruneWeightsConfig(input: WeightsConfig): WeightsConfig {
  const out: WeightsConfig = {};

  if (input.common) {
    const c: WeightMap = {};
    for (const k of WEIGHT_KEYS) {
      if (STRATEGY_KEY_SET.has(k)) continue;
      const v = input.common[k];
      if (v !== undefined && v !== DEFAULT_WEIGHTS[k]) c[k] = v;
    }
    if (Object.keys(c).length > 0) out.common = c;
  }

  if (input.templateA) {
    const a: WeightMap = {};
    for (const k of STRATEGY_SPECIFIC_KEYS) {
      const v = input.templateA[k];
      if (v !== undefined && v !== TEMPLATE_A_FACTORY_DEFAULTS[k]) a[k] = v;
    }
    if (Object.keys(a).length > 0) out.templateA = a;
  }

  if (input.templateB) {
    const b: WeightMap = {};
    for (const k of STRATEGY_SPECIFIC_KEYS) {
      const v = input.templateB[k];
      if (v !== undefined && v !== TEMPLATE_B_FACTORY_DEFAULTS[k]) b[k] = v;
    }
    if (Object.keys(b).length > 0) out.templateB = b;
  }

  return out;
}

// ───────────────────────────────────────────────────────────────────────
// Validation — universal mathematical invariants only
// ───────────────────────────────────────────────────────────────────────
//
// We dropped these heuristic rules that the templates explicitly invert:
//   - W_RELAX_REST_AFTER_6 ≤ W_STAFFING_MIN
//   - W_RELAX_ALT_WEEKENDS ≤ W_STAFFING_MIN
// (Template A intentionally flips both above staffing.)
//
// Kept: non-negative, intra-tier monotonicity, contract-tier ordering,
// and the "physical/legal" relax floor (rest 11h, consec, MJ cap stay
// near-hard).

export function validateMergedWeights(
  merged: Record<WeightKey, number>,
): string[] {
  const errors: string[] = [];

  // R1 — every weight ≥ 0
  for (const k of WEIGHT_KEYS) {
    if (merged[k] < 0) errors.push(`${k}: Wert darf nicht negativ sein.`);
  }

  // R2 — Tier 1 sub-hierarchy (qualification ≥ headcount ≥ WBL-BL)
  if (merged.W_QUALIFICATION < merged.W_STAFFING_MIN) {
    errors.push(
      "W_QUALIFICATION muss ≥ W_STAFFING_MIN sein (sonst lässt der Solver eher eine Qualifikation unbesetzt als einen Headcount-Slot).",
    );
  }
  if (merged.W_STAFFING_MIN < merged.W_WBL_BL) {
    errors.push(
      "W_STAFFING_MIN muss ≥ W_WBL_BL sein (sonst würde der Solver eher einen Pflicht-Slot leer lassen als WBL ohne BL-Schicht).",
    );
  }

  // R3 — Overtime contract ordering (FT ≤ PT only — MJ no longer auto-planned)
  if (merged.W_OVERTIME_FT > merged.W_OVERTIME_PT) {
    errors.push("Überstunden-Reihenfolge falsch: W_OVERTIME_FT ≤ W_OVERTIME_PT erforderlich.");
  }

  // R4 — Under-Soll hard contract ordering (FT ≤ PT only)
  if (merged.W_SOLL_HARD_FT > merged.W_SOLL_HARD_PT) {
    errors.push("Soll-Hard-Reihenfolge falsch: W_SOLL_HARD_FT ≤ W_SOLL_HARD_PT erforderlich.");
  }

  // R5 — Piecewise ladder T1 ≤ T2 ≤ T3 ≤ T4 within FT and PT contract types
  // (MINI tier dropped — MJ employees no longer reach the soft constraints)
  for (const ct of ["FT", "PT"] as const) {
    const t1 = merged[`W_OVER_SOLL_T1_${ct}`];
    const t2 = merged[`W_OVER_SOLL_T2_${ct}`];
    const t3 = merged[`W_OVER_SOLL_T3_${ct}`];
    const t4 = merged[`W_OVER_SOLL_T4_${ct}`];
    if (!(t1 <= t2 && t2 <= t3 && t3 <= t4)) {
      errors.push(
        `Über-Soll-Treppe (${ct}): T1 ≤ T2 ≤ T3 ≤ T4 erforderlich (aktuell ${t1}, ${t2}, ${t3}, ${t4}).`,
      );
    }
  }

  // R6 — Piecewise ladder cross-contract per tier (FT ≤ PT only)
  for (const n of [1, 2, 3, 4] as const) {
    const ft = merged[`W_OVER_SOLL_T${n}_FT`];
    const pt = merged[`W_OVER_SOLL_T${n}_PT`];
    if (ft > pt) {
      errors.push(
        `Über-Soll Tier ${n}: FT ≤ PT erforderlich (aktuell ${ft}, ${pt}).`,
      );
    }
  }

  // R7 — Fairness max-OT cap ordering
  if (merged.W_MAX_OT_FT > merged.W_MAX_OT_PT) {
    errors.push("W_MAX_OT_FT muss ≤ W_MAX_OT_PT sein.");
  }

  // R8 — Physical/legal relax weights stay near-hard (≥ staffing)
  // Kept because these aren't policy choices — they're physical/legal
  // limits (11h rest, consecutive shifts, MJ legal cap, headcount max).
  // No template should flip these.
  const mustStayAbove: readonly WeightKey[] = [
    "W_RELAX_MIN_REST",
    "W_RELAX_CONSEC_NIGHTS",
    "W_RELAX_CONSEC_DAYS",
    "W_RELAX_STAFFING_MAX",
    "W_RELAX_MINI_JOB_CAP",
  ];
  for (const k of mustStayAbove) {
    if (merged[k] < merged.W_STAFFING_MIN) {
      errors.push(
        `${k} muss ≥ W_STAFFING_MIN bleiben (physische/gesetzliche Regel — soll fast nie brechen).`,
      );
    }
  }

  return errors;
}

/** Validate a full WeightsConfig: runs validateMergedWeights against
 * the resolved weights for BOTH strategies. Returns a flat list with
 * each error tagged by source ("Vollabdeckung: …" / "Slot leer: …" /
 * "Allgemein: …"). */
export function validateWeightsConfig(config: WeightsConfig): string[] {
  const errors: string[] = [];

  const mergedB = resolveActiveWeights("PREFER_FULL_COVERAGE", config);
  for (const e of validateMergedWeights(mergedB)) {
    errors.push(`Vollabdeckung: ${e}`);
  }

  const mergedA = resolveActiveWeights("PREFER_GAPS", config);
  for (const e of validateMergedWeights(mergedA)) {
    errors.push(`Slot leer: ${e}`);
  }

  return errors;
}
