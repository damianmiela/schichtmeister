"""Single source of truth for the CP-SAT objective configuration.

Two halves:

  • DEFAULT_*  — the factory-default value of every weight. These are
                 frozen module-level constants. They never change at
                 runtime and form the floor / fallback for runtime
                 overrides.
  • Weights    — a frozen dataclass instance, one field per weight,
                 used by every constraint builder. Built once per solve
                 from request overrides + defaults via
                 ``weights_from_overrides``.

──────────────────────────────────────────────────────────────────────
Objective math, in one paragraph
──────────────────────────────────────────────────────────────────────
The solver minimizes ``sum(var * weight)`` across every term that
constraint builders return. Variables live in three flavors:

  • boolean (e.g. "shift assigned", "wish unfulfilled")  →  weight = cost
  • integer hours scaled by SCALE (e.g. over-Soll hours × 100)
  • integer slack vars (e.g. "headcount above max" in relaxed mode)

For per-hour costs (overtime, soll-deviation, piecewise ladder, max-OT
cap) the code multiplies hours by SCALE=100 to keep all integer math
inside CP-SAT. So a weight of ``50`` on a SCALE'd hour variable costs
``50 × 100 = 5_000`` per hour. Each per-hour weight has the resulting
"€/hour" effective cost in the trailing comment so you don't have to
do the multiplication in your head.

──────────────────────────────────────────────────────────────────────
Tier hierarchy — DO NOT REORDER WITHOUT THINKING
──────────────────────────────────────────────────────────────────────
The defaults form a deliberate hierarchy where each tier dominates
the next:

  Tier  1  (millions)  — uncovered shift / qualification    must win
  Tier  2  (10s of k)  — utilization
  Tier  3  (10s..1k)   — hours accuracy & overtime
  Tier  4  (1k..1)     — wishes & preferences
  Tier  5  (10k..500k) — cross-month boundary carryover
  Tier -1  (millions)  — relaxed-mode penalties (Phase 2 only)

The piecewise over-Soll ladder ALSO has internal monotonicity that
must hold: T1 ≤ T2 ≤ T3 ≤ T4 within each contract type, and within
each tier MINI ≥ PT ≥ FT. The fairness cap (W_MAX_OT_*) sits ON TOP
of the per-employee piecewise. ``validate_overrides`` enforces these
invariants for any runtime override.
"""

from __future__ import annotations

from dataclasses import dataclass, fields, replace
from typing import Iterable


# ══════════════════════════════════════════════════════════════════════
# Structural constants (NOT user-tunable — locked at code level)
# ══════════════════════════════════════════════════════════════════════

# Integer scale factor for hour-based variables. Changing this would
# invalidate every weight at once, so it's deliberately not exposed
# to admin-tools.
SCALE = 100

# Width (in hours) of the over-Soll piecewise tiers. Cumulative
# edges: 4h, 8h, 16h. Architectural decision, not a tuning knob.
OVER_SOLL_TIER_WIDTHS_H = (4, 4, 8)


# ══════════════════════════════════════════════════════════════════════
# DEFAULT WEIGHT VALUES (factory defaults — runtime fallback floor)
# ══════════════════════════════════════════════════════════════════════
# These constants are the source of truth for the "Default" button in
# admin-tools. ``Weights.defaults()`` reads them, and runtime overrides
# are layered on top.

# ── Tier 1: Coverage ────────────────────────────────────────────────
DEFAULT_W_QUALIFICATION = 5_000_000
DEFAULT_W_STAFFING_MIN = 3_000_000
DEFAULT_W_WBL_BL = 500_000

# ── Tier 2: Utilization ─────────────────────────────────────────────
DEFAULT_W_MIN_UTIL = 30_000

# ── Tier 3a: Generic Soll-deviation ─────────────────────────────────
DEFAULT_W_SOLL_DEV = 100
DEFAULT_W_UNDERCUT = 150
DEFAULT_W_FAIRNESS = 50

# ── Tier 3b: Flat overtime above hard cap ───────────────────────────
DEFAULT_W_OVERTIME_FT = 30
DEFAULT_W_OVERTIME_PT = 200
DEFAULT_W_OVERTIME_MINI = 2_000

# ── Tier 3c: Under-Soll hard penalty ────────────────────────────────
DEFAULT_W_SOLL_HARD_FT = 50
DEFAULT_W_SOLL_HARD_PT = 300
DEFAULT_W_SOLL_HARD_MINI = 3_000

# ── Tier 3d: Over-Soll piecewise ladder (T1 ≤ T2 ≤ T3 ≤ T4) ─────────
DEFAULT_W_OVER_SOLL_T1_FT = 50
DEFAULT_W_OVER_SOLL_T2_FT = 150
DEFAULT_W_OVER_SOLL_T3_FT = 800       # was 400 — 2× steeper escalation
DEFAULT_W_OVER_SOLL_T4_FT = 5_000     # was 2,500 — 2× bump per pruefstand
                                      # combined_t4_x_altw sweep (drops
                                      # max-over-Soll from 40h to 32h on
                                      # May 2026 input, BL preserved).
DEFAULT_W_OVER_SOLL_T1_PT = 150
DEFAULT_W_OVER_SOLL_T2_PT = 400
DEFAULT_W_OVER_SOLL_T3_PT = 2_000     # was 1,000 — 2× steeper
DEFAULT_W_OVER_SOLL_T4_PT = 12_000    # was 6,000 — 2× bump (paired with
                                       # T4_FT 2× bump above, same sweep).
DEFAULT_W_OVER_SOLL_T1_MINI = 1_000
DEFAULT_W_OVER_SOLL_T2_MINI = 3_000
DEFAULT_W_OVER_SOLL_T3_MINI = 8_000
DEFAULT_W_OVER_SOLL_T4_MINI = 20_000   # MJ no longer auto-planned. Value just
                                       # has to stay ≥ T4_PT (6_000) per the
                                       # FT ≤ PT ≤ MJ cross-contract ordering.

# ── Tier 3e: Fairness cap on peak over-Soll ─────────────────────────
DEFAULT_W_MAX_OT_FT = 5_000    # 17× original — peak FT pays 500k/h. Targets
                               # flattening specifically without raising T4
                               # (which would cause leave-slot-empty thresh).
DEFAULT_W_MAX_OT_PT = 18_000   # 18× original — 1.8M/h peak pressure

# ── Tier 4: Wishes & preferences ────────────────────────────────────
DEFAULT_W_WISH_NORMAL = 3_000
DEFAULT_W_WISH_STRONG = 6_000
DEFAULT_W_PREFERENCE = 1
DEFAULT_W_DISTRIBUTION = 500

# ── Tier 5: Cross-month boundary ────────────────────────────────────
DEFAULT_W_WEEKEND_BOUNDARY = 10_000
DEFAULT_W_CONSEC_DAYS_BOUNDARY = 500_000
DEFAULT_W_REST_AFTER_6_BOUNDARY = 30_000

# ── Tier -1: Relaxed-mode penalties ─────────────────────────────────
# Two sub-categories now:
#  • "Legal/physical" rules — only ever soft in Phase 2 (when Phase 1
#    was infeasible). Weights stay huge so they almost never break.
#  • "Policy/fairness" rules — ALWAYS soft (Phase 1 + Phase 2). Weights
#    are tuned to be cheaper than the over-Soll T3/T4 ladder so the
#    solver picks "break a rule" over "dump +20h on one person" when
#    spreading is otherwise impossible.
#
# Legal/physical (hard in Phase 1, near-hard in Phase 2):
DEFAULT_W_RELAX_MIN_REST = 20_000_000
DEFAULT_W_RELAX_STAFFING_MAX = 8_000_000
DEFAULT_W_RELAX_MINI_JOB_CAP = 6_000_000

# Policy/fairness (always soft, calibrated for spreading):
# These all need to be < per-hour over-Soll T3/T4 cost so spreading wins:
#   T3 PT = 200,000/h, T4 PT = 1,250,000/h after the 5× bump.
#   T3 FT = 80,000/h,  T4 FT = 500,000/h.
# Each rule break is per-(employee, week) or per-(employee, day) and
# saves the marginal over-Soll cost on the would-be victim.
DEFAULT_W_RELAX_CONSEC_NIGHTS = 300_000
DEFAULT_W_RELAX_CONSEC_DAYS = 300_000
DEFAULT_W_RELAX_WBL_WEEKEND_LIMIT = 250_000
# WBL-BL constraints are MUST-HAVE in both Vollabdeckung and Slot-leer
# modes — every WBL employee gets exactly one BL shift per ISO week
# (not zero, not two). Weights deliberately above W_STAFFING_MIN (3M
# in Vollabdeckung, 50k in Slot-leer) so missing or doubling a BL is
# strictly more expensive than leaving a slot empty.
DEFAULT_W_RELAX_WBL_BL_MAX_PER_WEEK = 5_000_000
DEFAULT_W_RELAX_WBL_BL_WEEKLY_MIN = 5_000_000
DEFAULT_W_RELAX_REST_AFTER_6 = 150_000
DEFAULT_W_RELAX_ALT_WEEKENDS = 800_000   # was 80,000 — 10× bump per
                                          # pruefstand combined_t4_x_altw
                                          # sweep (drops alt-weekend
                                          # violations from 42 to 35 on
                                          # May 2026, no breakage).


# ══════════════════════════════════════════════════════════════════════
# Weights dataclass — runtime container
# ══════════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class Weights:
    """One field per tunable weight. Built once per solve from request
    overrides layered on top of factory defaults. Constraint builders
    take this as a parameter and read ``w.W_FOO`` instead of importing
    bare module constants.
    """

    # Tier 1
    W_QUALIFICATION: int = DEFAULT_W_QUALIFICATION
    W_STAFFING_MIN: int = DEFAULT_W_STAFFING_MIN
    W_WBL_BL: int = DEFAULT_W_WBL_BL
    # Tier 2
    W_MIN_UTIL: int = DEFAULT_W_MIN_UTIL
    # Tier 3a
    W_SOLL_DEV: int = DEFAULT_W_SOLL_DEV
    W_UNDERCUT: int = DEFAULT_W_UNDERCUT
    W_FAIRNESS: int = DEFAULT_W_FAIRNESS
    # Tier 3b
    W_OVERTIME_FT: int = DEFAULT_W_OVERTIME_FT
    W_OVERTIME_PT: int = DEFAULT_W_OVERTIME_PT
    W_OVERTIME_MINI: int = DEFAULT_W_OVERTIME_MINI
    # Tier 3c
    W_SOLL_HARD_FT: int = DEFAULT_W_SOLL_HARD_FT
    W_SOLL_HARD_PT: int = DEFAULT_W_SOLL_HARD_PT
    W_SOLL_HARD_MINI: int = DEFAULT_W_SOLL_HARD_MINI
    # Tier 3d
    W_OVER_SOLL_T1_FT: int = DEFAULT_W_OVER_SOLL_T1_FT
    W_OVER_SOLL_T2_FT: int = DEFAULT_W_OVER_SOLL_T2_FT
    W_OVER_SOLL_T3_FT: int = DEFAULT_W_OVER_SOLL_T3_FT
    W_OVER_SOLL_T4_FT: int = DEFAULT_W_OVER_SOLL_T4_FT
    W_OVER_SOLL_T1_PT: int = DEFAULT_W_OVER_SOLL_T1_PT
    W_OVER_SOLL_T2_PT: int = DEFAULT_W_OVER_SOLL_T2_PT
    W_OVER_SOLL_T3_PT: int = DEFAULT_W_OVER_SOLL_T3_PT
    W_OVER_SOLL_T4_PT: int = DEFAULT_W_OVER_SOLL_T4_PT
    W_OVER_SOLL_T1_MINI: int = DEFAULT_W_OVER_SOLL_T1_MINI
    W_OVER_SOLL_T2_MINI: int = DEFAULT_W_OVER_SOLL_T2_MINI
    W_OVER_SOLL_T3_MINI: int = DEFAULT_W_OVER_SOLL_T3_MINI
    W_OVER_SOLL_T4_MINI: int = DEFAULT_W_OVER_SOLL_T4_MINI
    # Tier 3e
    W_MAX_OT_FT: int = DEFAULT_W_MAX_OT_FT
    W_MAX_OT_PT: int = DEFAULT_W_MAX_OT_PT
    # Tier 4
    W_WISH_NORMAL: int = DEFAULT_W_WISH_NORMAL
    W_WISH_STRONG: int = DEFAULT_W_WISH_STRONG
    W_PREFERENCE: int = DEFAULT_W_PREFERENCE
    W_DISTRIBUTION: int = DEFAULT_W_DISTRIBUTION
    # Tier 5
    W_WEEKEND_BOUNDARY: int = DEFAULT_W_WEEKEND_BOUNDARY
    W_CONSEC_DAYS_BOUNDARY: int = DEFAULT_W_CONSEC_DAYS_BOUNDARY
    W_REST_AFTER_6_BOUNDARY: int = DEFAULT_W_REST_AFTER_6_BOUNDARY
    # Tier -1
    W_RELAX_MIN_REST: int = DEFAULT_W_RELAX_MIN_REST
    W_RELAX_CONSEC_NIGHTS: int = DEFAULT_W_RELAX_CONSEC_NIGHTS
    W_RELAX_CONSEC_DAYS: int = DEFAULT_W_RELAX_CONSEC_DAYS
    W_RELAX_STAFFING_MAX: int = DEFAULT_W_RELAX_STAFFING_MAX
    W_RELAX_MINI_JOB_CAP: int = DEFAULT_W_RELAX_MINI_JOB_CAP
    W_RELAX_WBL_WEEKEND_LIMIT: int = DEFAULT_W_RELAX_WBL_WEEKEND_LIMIT
    W_RELAX_WBL_BL_MAX_PER_WEEK: int = DEFAULT_W_RELAX_WBL_BL_MAX_PER_WEEK
    W_RELAX_WBL_BL_WEEKLY_MIN: int = DEFAULT_W_RELAX_WBL_BL_WEEKLY_MIN
    W_RELAX_REST_AFTER_6: int = DEFAULT_W_RELAX_REST_AFTER_6
    W_RELAX_ALT_WEEKENDS: int = DEFAULT_W_RELAX_ALT_WEEKENDS

    @classmethod
    def field_names(cls) -> tuple[str, ...]:
        return tuple(f.name for f in fields(cls))


# ══════════════════════════════════════════════════════════════════════
# Factory + validator
# ══════════════════════════════════════════════════════════════════════

def weights_from_overrides(overrides: dict[str, int] | None) -> Weights:
    """Build a Weights instance from optional overrides layered on top
    of factory defaults. Unknown keys are silently ignored — the API
    layer should validate before calling this. Non-int values are
    coerced via ``int()``; if coercion fails the default is used.
    """
    if not overrides:
        return Weights()
    valid = set(Weights.field_names())
    kw: dict[str, int] = {}
    for k, v in overrides.items():
        if k not in valid:
            continue
        try:
            kw[k] = int(v)
        except (TypeError, ValueError):
            continue  # fall back to default for this field
    return Weights(**kw) if kw else Weights()


def validate_overrides(overrides: dict[str, int]) -> list[str]:
    """Return a list of human-readable invariant violations. Empty list
    means the override set is safe. Used by both the API endpoint
    (server-side hard-reject) and the admin UI (live validation).

    The same rules MUST be mirrored in src/lib/solver/weights.ts.
    """
    errors: list[str] = []
    valid = set(Weights.field_names())

    # Build a "merged" view: overrides on top of defaults.
    merged: dict[str, int] = {f.name: f.default for f in fields(Weights)}
    for k, v in overrides.items():
        if k not in valid:
            errors.append(f"Unbekannter Schlüssel: {k}")
            continue
        try:
            merged[k] = int(v)
        except (TypeError, ValueError):
            errors.append(f"{k}: Wert muss eine Ganzzahl sein.")

    # Rule 1 — every weight must be ≥ 0
    for k in valid:
        if merged[k] < 0:
            errors.append(f"{k}: Wert darf nicht negativ sein.")

    # Rule 2 — Tier 1 hierarchy
    if merged["W_QUALIFICATION"] < merged["W_STAFFING_MIN"]:
        errors.append(
            "W_QUALIFICATION muss ≥ W_STAFFING_MIN sein (sonst lässt der "
            "Solver eher eine Qualifikation unbesetzt als einen Headcount-Slot)."
        )
    if merged["W_STAFFING_MIN"] < merged["W_WBL_BL"]:
        errors.append(
            "W_STAFFING_MIN muss ≥ W_WBL_BL sein (sonst lässt der Solver "
            "eher einen Pflicht-Slot leer als WBL ohne BL-Schicht)."
        )

    # Rule 3 — Overtime contract ordering
    if not (merged["W_OVERTIME_FT"] <= merged["W_OVERTIME_PT"] <= merged["W_OVERTIME_MINI"]):
        errors.append(
            "Überstunden-Reihenfolge falsch: erforderlich "
            "W_OVERTIME_FT ≤ W_OVERTIME_PT ≤ W_OVERTIME_MINI."
        )

    # Rule 4 — Under-Soll hard contract ordering
    if not (merged["W_SOLL_HARD_FT"] <= merged["W_SOLL_HARD_PT"] <= merged["W_SOLL_HARD_MINI"]):
        errors.append(
            "Soll-Hard-Reihenfolge falsch: erforderlich "
            "W_SOLL_HARD_FT ≤ W_SOLL_HARD_PT ≤ W_SOLL_HARD_MINI."
        )

    # Rule 5 — Piecewise ladder monotonicity per contract type
    for ct in ("FT", "PT", "MINI"):
        t1, t2, t3, t4 = (merged[f"W_OVER_SOLL_T{n}_{ct}"] for n in (1, 2, 3, 4))
        if not (t1 <= t2 <= t3 <= t4):
            errors.append(
                f"Über-Soll-Treppe ({ct}) falsch: erforderlich "
                f"T1 ≤ T2 ≤ T3 ≤ T4 (aktuell {t1}, {t2}, {t3}, {t4})."
            )

    # Rule 6 — Piecewise ladder cross-contract ordering per tier
    for n in (1, 2, 3, 4):
        ft = merged[f"W_OVER_SOLL_T{n}_FT"]
        pt = merged[f"W_OVER_SOLL_T{n}_PT"]
        mj = merged[f"W_OVER_SOLL_T{n}_MINI"]
        if not (ft <= pt <= mj):
            errors.append(
                f"Über-Soll-Treppe Tier {n}: erforderlich "
                f"FT ≤ PT ≤ MINI (aktuell {ft}, {pt}, {mj})."
            )

    # Rule 7 — Fairness max-OT cap ordering
    if merged["W_MAX_OT_FT"] > merged["W_MAX_OT_PT"]:
        errors.append("W_MAX_OT_FT muss ≤ W_MAX_OT_PT sein.")

    # Rule 8 — Legal/physical relax weights stay near-hard (≥ staffing).
    # CONSEC_DAYS/NIGHTS were moved out of this set when those rules
    # became always-soft policy/fairness rules — the planner explicitly
    # accepts that the solver will break them to spread shifts more
    # fairly across employees rather than dumping +20h on one person.
    # Only truly legal/physical limits remain: 11h rest between shifts,
    # MJ monthly hour cap, and the staffing-max ceiling.
    must_stay_above = (
        "W_RELAX_MIN_REST",
        "W_RELAX_STAFFING_MAX",
        "W_RELAX_MINI_JOB_CAP",
    )
    for k in must_stay_above:
        if merged[k] < merged["W_STAFFING_MIN"]:
            errors.append(
                f"{k} muss ≥ W_STAFFING_MIN bleiben (sonst würde der Solver "
                f"diese harte Regel im Relaxed-Modus brechen statt einen "
                f"Pflicht-Slot zu füllen)."
            )

    # NOTE: We intentionally do NOT enforce W_RELAX_REST_AFTER_6 ≤ W_STAFFING_MIN
    # or W_RELAX_ALT_WEEKENDS ≤ W_STAFFING_MIN here. The "lieber Slot leer
    # lassen" strategy template (TS-side) explicitly inverts these to put
    # leaving-slot-empty cost BELOW the rule-breaking cost. So both
    # orderings are valid depending on the active strategy.

    return errors


# ══════════════════════════════════════════════════════════════════════
# Backwards-compat shims — bare W_* names still available for any
# code that hasn't been migrated yet. These are pure aliases for
# DEFAULT_W_* and never reflect runtime overrides. New code MUST use
# Weights instead.
# ══════════════════════════════════════════════════════════════════════
W_QUALIFICATION = DEFAULT_W_QUALIFICATION
W_STAFFING_MIN = DEFAULT_W_STAFFING_MIN
W_WBL_BL = DEFAULT_W_WBL_BL
W_MIN_UTIL = DEFAULT_W_MIN_UTIL
W_SOLL_DEV = DEFAULT_W_SOLL_DEV
W_UNDERCUT = DEFAULT_W_UNDERCUT
W_FAIRNESS = DEFAULT_W_FAIRNESS
W_OVERTIME_FT = DEFAULT_W_OVERTIME_FT
W_OVERTIME_PT = DEFAULT_W_OVERTIME_PT
W_OVERTIME_MINI = DEFAULT_W_OVERTIME_MINI
W_SOLL_HARD_FT = DEFAULT_W_SOLL_HARD_FT
W_SOLL_HARD_PT = DEFAULT_W_SOLL_HARD_PT
W_SOLL_HARD_MINI = DEFAULT_W_SOLL_HARD_MINI
W_OVER_SOLL_T1_FT = DEFAULT_W_OVER_SOLL_T1_FT
W_OVER_SOLL_T2_FT = DEFAULT_W_OVER_SOLL_T2_FT
W_OVER_SOLL_T3_FT = DEFAULT_W_OVER_SOLL_T3_FT
W_OVER_SOLL_T4_FT = DEFAULT_W_OVER_SOLL_T4_FT
W_OVER_SOLL_T1_PT = DEFAULT_W_OVER_SOLL_T1_PT
W_OVER_SOLL_T2_PT = DEFAULT_W_OVER_SOLL_T2_PT
W_OVER_SOLL_T3_PT = DEFAULT_W_OVER_SOLL_T3_PT
W_OVER_SOLL_T4_PT = DEFAULT_W_OVER_SOLL_T4_PT
W_OVER_SOLL_T1_MINI = DEFAULT_W_OVER_SOLL_T1_MINI
W_OVER_SOLL_T2_MINI = DEFAULT_W_OVER_SOLL_T2_MINI
W_OVER_SOLL_T3_MINI = DEFAULT_W_OVER_SOLL_T3_MINI
W_OVER_SOLL_T4_MINI = DEFAULT_W_OVER_SOLL_T4_MINI
W_MAX_OT_FT = DEFAULT_W_MAX_OT_FT
W_MAX_OT_PT = DEFAULT_W_MAX_OT_PT
W_WISH_NORMAL = DEFAULT_W_WISH_NORMAL
W_WISH_STRONG = DEFAULT_W_WISH_STRONG
W_PREFERENCE = DEFAULT_W_PREFERENCE
W_DISTRIBUTION = DEFAULT_W_DISTRIBUTION
W_WEEKEND_BOUNDARY = DEFAULT_W_WEEKEND_BOUNDARY
W_CONSEC_DAYS_BOUNDARY = DEFAULT_W_CONSEC_DAYS_BOUNDARY
W_REST_AFTER_6_BOUNDARY = DEFAULT_W_REST_AFTER_6_BOUNDARY
W_RELAX_MIN_REST = DEFAULT_W_RELAX_MIN_REST
W_RELAX_CONSEC_NIGHTS = DEFAULT_W_RELAX_CONSEC_NIGHTS
W_RELAX_CONSEC_DAYS = DEFAULT_W_RELAX_CONSEC_DAYS
W_RELAX_STAFFING_MAX = DEFAULT_W_RELAX_STAFFING_MAX
W_RELAX_MINI_JOB_CAP = DEFAULT_W_RELAX_MINI_JOB_CAP
W_RELAX_WBL_WEEKEND_LIMIT = DEFAULT_W_RELAX_WBL_WEEKEND_LIMIT
W_RELAX_WBL_BL_MAX_PER_WEEK = DEFAULT_W_RELAX_WBL_BL_MAX_PER_WEEK
W_RELAX_WBL_BL_WEEKLY_MIN = DEFAULT_W_RELAX_WBL_BL_WEEKLY_MIN
W_RELAX_REST_AFTER_6 = DEFAULT_W_RELAX_REST_AFTER_6
W_RELAX_ALT_WEEKENDS = DEFAULT_W_RELAX_ALT_WEEKENDS
