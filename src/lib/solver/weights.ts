/**
 * Solver weight definitions, defaults, and validation — TypeScript mirror
 * of solver/config.py. The Python file is the original source of truth;
 * this file MUST stay byte-identical with it for both default values and
 * validation rules. When you change one, change the other.
 *
 * Used by:
 *   - /api/admin/solver-weights (GET returns this; PUT validates against it)
 *   - SolverWeightsTab admin UI (live validation, default-reset, descriptions)
 *   - generate-stream route (when injecting saved overrides into the payload)
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
// Per-weight metadata for the admin UI: tier, label, short description,
// and an "effective €/hour" hint where applicable. Order in this array
// drives display order in the form.
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
  tier_1_coverage: "Tier 1 — Abdeckung (muss alles dominieren)",
  tier_2_utilization: "Tier 2 — Auslastung",
  tier_3a_soll_deviation: "Tier 3a — Soll-Abweichung (allgemein)",
  tier_3b_overtime: "Tier 3b — Flat-Überstunden über Hard-Cap",
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
  /** Effective €/hour cost when the weight is applied to a per-hour
   * SCALE'd variable. Omit for boolean / count-based weights. */
  perHourCost?: number;
};

const SCALE = 100; // mirrors solver/config.py

export const WEIGHT_DEFINITIONS: readonly WeightDef[] = [
  // ── Tier 1 ────────────────────────────────────────────────────────
  {
    key: "W_QUALIFICATION", tier: "tier_1_coverage",
    label: "Qualifikation unbesetzt",
    description:
      "Strafe wenn ein Pflicht-Slot mit benötigter Qualifikation leer bleibt (z.B. keine Examinierte in der Frühschicht). Höchste Priorität.",
  },
  {
    key: "W_STAFFING_MIN", tier: "tier_1_coverage",
    label: "Headcount unter Minimum",
    description:
      "Strafe pro fehlender Person pro Schicht unter dem konfigurierten Minimum.",
  },
  {
    key: "W_WBL_BL", tier: "tier_1_coverage",
    label: "WBL ohne BL-Schicht",
    description:
      "Strafe wenn eine WBL-Mitarbeiterin in einer arbeitbaren ISO-Woche keine BL-Schicht bekommt.",
  },
  // ── Tier 2 ────────────────────────────────────────────────────────
  {
    key: "W_MIN_UTIL", tier: "tier_2_utilization",
    label: "Unterauslastung",
    description:
      "Strafe wenn ein Mitarbeiter weit weniger Schichten als vertraglich erwartet bekommt.",
  },
  // ── Tier 3a ───────────────────────────────────────────────────────
  {
    key: "W_SOLL_DEV", tier: "tier_3a_soll_deviation",
    label: "Soll-Abweichung allgemein",
    description: "Sanfte Strafe für Abweichung vom Monats-Soll (beidseitig).",
  },
  {
    key: "W_UNDERCUT", tier: "tier_3a_soll_deviation",
    label: "Stunden unter Soll",
    description: "Drückt den Solver dazu, Mitarbeiter aufzufüllen.",
  },
  {
    key: "W_FAIRNESS", tier: "tier_3a_soll_deviation",
    label: "Fairness Soll-Spreizung",
    description: "Strafe für die Spreizung der Abweichungen über alle Mitarbeiter.",
  },
  // ── Tier 3b ───────────────────────────────────────────────────────
  {
    key: "W_OVERTIME_FT", tier: "tier_3b_overtime",
    label: "Überstunden FT (Stunde)",
    description: "Strafe pro Stunde über (Soll + maxOvertimeHours) für Vollzeit.",
    perHourCost: DEFAULT_WEIGHTS.W_OVERTIME_FT * SCALE,
  },
  {
    key: "W_OVERTIME_PT", tier: "tier_3b_overtime",
    label: "Überstunden PT (Stunde)",
    description: "Strafe pro Stunde Überstunden für Teilzeit.",
    perHourCost: DEFAULT_WEIGHTS.W_OVERTIME_PT * SCALE,
  },
  {
    key: "W_OVERTIME_MINI", tier: "tier_3b_overtime",
    label: "Überstunden MJ (Stunde)",
    description: "Strafe pro Stunde Überstunden für MiniJob — sehr hoch.",
    perHourCost: DEFAULT_WEIGHTS.W_OVERTIME_MINI * SCALE,
  },
  // ── Tier 3c ───────────────────────────────────────────────────────
  {
    key: "W_SOLL_HARD_FT", tier: "tier_3c_undersoll",
    label: "Unter-Soll FT (Stunde)",
    description: "Strafe pro Stunde unter (Soll + min_delta) für Vollzeit.",
    perHourCost: DEFAULT_WEIGHTS.W_SOLL_HARD_FT * SCALE,
  },
  {
    key: "W_SOLL_HARD_PT", tier: "tier_3c_undersoll",
    label: "Unter-Soll PT (Stunde)",
    description: "Strafe pro Stunde unter Soll für Teilzeit.",
    perHourCost: DEFAULT_WEIGHTS.W_SOLL_HARD_PT * SCALE,
  },
  {
    key: "W_SOLL_HARD_MINI", tier: "tier_3c_undersoll",
    label: "Unter-Soll MJ (Stunde)",
    description: "Strafe pro Stunde unter Soll für MiniJob.",
    perHourCost: DEFAULT_WEIGHTS.W_SOLL_HARD_MINI * SCALE,
  },
  // ── Tier 3d (12 fields) ───────────────────────────────────────────
  {
    key: "W_OVER_SOLL_T1_FT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll FT T1 (0..+4h)", description: "FT, 0–4h über Soll — billige „Schicht absorbieren“-Stufe.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T1_FT * SCALE,
  },
  {
    key: "W_OVER_SOLL_T2_FT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll FT T2 (+4..+8h)", description: "FT, +4–8h über Soll — moderat.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T2_FT * SCALE,
  },
  {
    key: "W_OVER_SOLL_T3_FT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll FT T3 (+8..+16h)", description: "FT, +8–16h über Soll — steil.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T3_FT * SCALE,
  },
  {
    key: "W_OVER_SOLL_T4_FT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll FT T4 (+16h+)", description: "FT, +16h+ über Soll — prohibitiv.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T4_FT * SCALE,
  },
  {
    key: "W_OVER_SOLL_T1_PT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll PT T1 (0..+4h)", description: "PT, 0–4h über Soll.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T1_PT * SCALE,
  },
  {
    key: "W_OVER_SOLL_T2_PT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll PT T2 (+4..+8h)", description: "PT, +4–8h über Soll.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T2_PT * SCALE,
  },
  {
    key: "W_OVER_SOLL_T3_PT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll PT T3 (+8..+16h)", description: "PT, +8–16h über Soll.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T3_PT * SCALE,
  },
  {
    key: "W_OVER_SOLL_T4_PT", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll PT T4 (+16h+)", description: "PT, +16h+ über Soll.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T4_PT * SCALE,
  },
  {
    key: "W_OVER_SOLL_T1_MINI", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll MJ T1 (0..+4h)", description: "MJ, 0–4h über Soll. ~20× FT.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T1_MINI * SCALE,
  },
  {
    key: "W_OVER_SOLL_T2_MINI", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll MJ T2 (+4..+8h)", description: "MJ, +4–8h über Soll.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T2_MINI * SCALE,
  },
  {
    key: "W_OVER_SOLL_T3_MINI", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll MJ T3 (+8..+16h)", description: "MJ, +8–16h über Soll.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T3_MINI * SCALE,
  },
  {
    key: "W_OVER_SOLL_T4_MINI", tier: "tier_3d_oversoll_ladder",
    label: "Über-Soll MJ T4 (+16h+)", description: "MJ, +16h+ über Soll. Quasi nie.",
    perHourCost: DEFAULT_WEIGHTS.W_OVER_SOLL_T4_MINI * SCALE,
  },
  // ── Tier 3e ───────────────────────────────────────────────────────
  {
    key: "W_MAX_OT_FT", tier: "tier_3e_fairness_cap",
    label: "Max-Über-Soll Cap FT (Stunde)",
    description: "Strafe für die einzelne FT-Person mit größter Über-Soll-Spitze.",
    perHourCost: DEFAULT_WEIGHTS.W_MAX_OT_FT * SCALE,
  },
  {
    key: "W_MAX_OT_PT", tier: "tier_3e_fairness_cap",
    label: "Max-Über-Soll Cap PT (Stunde)",
    description: "Wie oben für PT. (MJ ausgenommen — Treppe ist schon prohibitiv.)",
    perHourCost: DEFAULT_WEIGHTS.W_MAX_OT_PT * SCALE,
  },
  // ── Tier 4 ────────────────────────────────────────────────────────
  {
    key: "W_WISH_NORMAL", tier: "tier_4_wishes",
    label: "Wunsch nicht erfüllt",
    description: "Strafe wenn ein normaler Wunschdienst / Frei-Wunsch nicht erfüllt wird.",
  },
  {
    key: "W_WISH_STRONG", tier: "tier_4_wishes",
    label: "Starker Wunsch nicht erfüllt",
    description: "Strafe wenn ein STRONG-Priority-Wunsch nicht erfüllt wird.",
  },
  {
    key: "W_PREFERENCE", tier: "tier_4_wishes",
    label: "Schichtart außerhalb Präferenz",
    description: "Sehr kleiner Tiebreaker — wirkt nur, wenn nichts anderes auf dem Spiel steht.",
  },
  {
    key: "W_DISTRIBUTION", tier: "tier_4_wishes",
    label: "Schicht-Verteilungs-Abweichung",
    description: "Strafe für Abweichung vom bevorzugten Profil-Mix (z.B. „60% Früh / 40% Spät“).",
  },
  // ── Tier 5 ────────────────────────────────────────────────────────
  {
    key: "W_WEEKEND_BOUNDARY", tier: "tier_5_boundary",
    label: "Wochenend-Übertrag",
    description: "Strafe wenn Vormonats-Übertrag die Wechsel-Wochenenden-Regel verletzt.",
  },
  {
    key: "W_CONSEC_DAYS_BOUNDARY", tier: "tier_5_boundary",
    label: "Aufeinanderfolgende-Tage-Übertrag",
    description: "Strafe wenn Übertrag eine zu lange Tage-Strähne erzeugt. Hoch — diese Regel ist nicht „brechbar“.",
  },
  {
    key: "W_REST_AFTER_6_BOUNDARY", tier: "tier_5_boundary",
    label: "Ruhe nach 6+ Tagen Übertrag",
    description: "Strafe wenn nach 6+ Tagen am Vormonatsende keine Ruhetage am Monatsanfang folgen.",
  },
  // ── Tier −1 ───────────────────────────────────────────────────────
  {
    key: "W_RELAX_MIN_REST", tier: "tier_neg1_relax",
    label: "Relax: 11h Ruhe zw. Schichten",
    description: "Phase-2-Strafe wenn min. 11h Ruhe gebrochen wird. Sollte praktisch nie greifen.",
  },
  {
    key: "W_RELAX_CONSEC_NIGHTS", tier: "tier_neg1_relax",
    label: "Relax: max Nachtschichten in Folge",
    description: "Phase-2-Strafe für zu viele Nachtschichten in Folge.",
  },
  {
    key: "W_RELAX_CONSEC_DAYS", tier: "tier_neg1_relax",
    label: "Relax: max Tage in Folge",
    description: "Phase-2-Strafe für zu viele Arbeitstage in Folge.",
  },
  {
    key: "W_RELAX_STAFFING_MAX", tier: "tier_neg1_relax",
    label: "Relax: Headcount-Maximum",
    description: "Phase-2-Strafe für Überbelegung einer Schicht.",
  },
  {
    key: "W_RELAX_MINI_JOB_CAP", tier: "tier_neg1_relax",
    label: "Relax: MJ Stunden-Limit",
    description: "Phase-2-Strafe für MiniJob über gesetzlichem Monatslimit.",
  },
  {
    key: "W_RELAX_WBL_WEEKEND_LIMIT", tier: "tier_neg1_relax",
    label: "Relax: WBL Wochenend-Limit",
    description: "Phase-2-Strafe für WBL über max Wochenend-Tage.",
  },
  {
    key: "W_RELAX_WBL_BL_MAX_PER_WEEK", tier: "tier_neg1_relax",
    label: "Relax: WBL BL max 1×/Woche",
    description: "Phase-2-Strafe für mehr als eine BL-Schicht pro Woche bei WBL.",
  },
  {
    key: "W_RELAX_WBL_BL_WEEKLY_MIN", tier: "tier_neg1_relax",
    label: "Relax: WBL BL min 1×/Woche",
    description: "Phase-2-Strafe wenn WBL keine BL-Schicht in arbeitbarer Woche bekommt.",
  },
  {
    key: "W_RELAX_REST_AFTER_6", tier: "tier_neg1_relax",
    label: "Relax: Ruhe nach 6+ Tagen",
    description: "Phase-2-Strafe — bewusst unter W_STAFFING_MIN (Abdeckung gewinnt).",
  },
  {
    key: "W_RELAX_ALT_WEEKENDS", tier: "tier_neg1_relax",
    label: "Relax: Wechsel-Wochenenden",
    description: "Phase-2-Strafe — bewusst unter W_STAFFING_MIN.",
  },
];

// ───────────────────────────────────────────────────────────────────────
// Validation — must mirror validate_overrides() in solver/config.py.
// Returns array of human-readable violation strings. Empty = safe.
// ───────────────────────────────────────────────────────────────────────

export function validateWeights(overrides: WeightMap): string[] {
  const errors: string[] = [];

  // Build merged view (defaults + overrides)
  const merged: Record<WeightKey, number> = { ...DEFAULT_WEIGHTS };
  for (const k of Object.keys(overrides) as WeightKey[]) {
    const v = overrides[k];
    if (v === undefined || v === null) continue;
    if (!Number.isFinite(v) || !Number.isInteger(v)) {
      errors.push(`${k}: Wert muss eine Ganzzahl sein.`);
      continue;
    }
    merged[k] = v;
  }

  // Rule 1 — every weight must be ≥ 0
  for (const k of WEIGHT_KEYS) {
    if (merged[k] < 0) {
      errors.push(`${k}: Wert darf nicht negativ sein.`);
    }
  }

  // Rule 2 — Tier 1 hierarchy
  if (merged.W_QUALIFICATION < merged.W_STAFFING_MIN) {
    errors.push(
      "W_QUALIFICATION muss ≥ W_STAFFING_MIN sein (sonst lässt der Solver eher eine Qualifikation unbesetzt als einen Headcount-Slot).",
    );
  }
  if (merged.W_STAFFING_MIN < merged.W_WBL_BL) {
    errors.push(
      "W_STAFFING_MIN muss ≥ W_WBL_BL sein (sonst lässt der Solver eher einen Pflicht-Slot leer als WBL ohne BL-Schicht).",
    );
  }

  // Rule 3 — Overtime contract ordering
  if (
    !(
      merged.W_OVERTIME_FT <= merged.W_OVERTIME_PT &&
      merged.W_OVERTIME_PT <= merged.W_OVERTIME_MINI
    )
  ) {
    errors.push(
      "Überstunden-Reihenfolge falsch: erforderlich W_OVERTIME_FT ≤ W_OVERTIME_PT ≤ W_OVERTIME_MINI.",
    );
  }

  // Rule 4 — Under-Soll hard contract ordering
  if (
    !(
      merged.W_SOLL_HARD_FT <= merged.W_SOLL_HARD_PT &&
      merged.W_SOLL_HARD_PT <= merged.W_SOLL_HARD_MINI
    )
  ) {
    errors.push(
      "Soll-Hard-Reihenfolge falsch: erforderlich W_SOLL_HARD_FT ≤ W_SOLL_HARD_PT ≤ W_SOLL_HARD_MINI.",
    );
  }

  // Rule 5 — Piecewise ladder monotonicity per contract type
  for (const ct of ["FT", "PT", "MINI"] as const) {
    const t1 = merged[`W_OVER_SOLL_T1_${ct}`];
    const t2 = merged[`W_OVER_SOLL_T2_${ct}`];
    const t3 = merged[`W_OVER_SOLL_T3_${ct}`];
    const t4 = merged[`W_OVER_SOLL_T4_${ct}`];
    if (!(t1 <= t2 && t2 <= t3 && t3 <= t4)) {
      errors.push(
        `Über-Soll-Treppe (${ct}) falsch: erforderlich T1 ≤ T2 ≤ T3 ≤ T4 (aktuell ${t1}, ${t2}, ${t3}, ${t4}).`,
      );
    }
  }

  // Rule 6 — Piecewise ladder cross-contract ordering per tier
  for (const n of [1, 2, 3, 4] as const) {
    const ft = merged[`W_OVER_SOLL_T${n}_FT`];
    const pt = merged[`W_OVER_SOLL_T${n}_PT`];
    const mj = merged[`W_OVER_SOLL_T${n}_MINI`];
    if (!(ft <= pt && pt <= mj)) {
      errors.push(
        `Über-Soll-Treppe Tier ${n}: erforderlich FT ≤ PT ≤ MINI (aktuell ${ft}, ${pt}, ${mj}).`,
      );
    }
  }

  // Rule 7 — Fairness max-OT cap ordering
  if (merged.W_MAX_OT_FT > merged.W_MAX_OT_PT) {
    errors.push("W_MAX_OT_FT muss ≤ W_MAX_OT_PT sein.");
  }

  // Rule 8 — Relaxed-mode "above staffing" floor
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
        `${k} muss ≥ W_STAFFING_MIN bleiben (sonst würde der Solver diese harte Regel im Relaxed-Modus brechen statt einen Pflicht-Slot zu füllen).`,
      );
    }
  }

  // Rule 9 — Relaxed-mode "below staffing" ceiling
  const mustStayBelow: readonly WeightKey[] = [
    "W_RELAX_REST_AFTER_6",
    "W_RELAX_ALT_WEEKENDS",
  ];
  for (const k of mustStayBelow) {
    if (merged[k] > merged.W_STAFFING_MIN) {
      errors.push(
        `${k} muss ≤ W_STAFFING_MIN bleiben (sonst würde der Solver eher einen Pflicht-Slot leer lassen als diese Regel zu brechen).`,
      );
    }
  }

  return errors;
}

/** Filter an override map to only fields that DIFFER from the default
 * (canonical storage form — keeps the JSON small). */
export function pruneToOverrides(input: WeightMap): WeightMap {
  const out: WeightMap = {};
  for (const k of Object.keys(input) as WeightKey[]) {
    const v = input[k];
    if (v === undefined || v === null) continue;
    if (v !== DEFAULT_WEIGHTS[k]) out[k] = v;
  }
  return out;
}

/** Parse the JSON column from the DB into a WeightMap. Tolerant of
 * malformed input — falls back to {}. */
export function parseStoredWeights(raw: string | null | undefined): WeightMap {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return {};
    const out: WeightMap = {};
    for (const k of WEIGHT_KEYS) {
      const v = obj[k];
      if (typeof v === "number" && Number.isInteger(v)) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}
