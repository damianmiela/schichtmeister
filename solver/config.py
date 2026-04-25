"""Single source of truth for the CP-SAT objective configuration.

Everything that shapes the cost the solver minimizes lives here:
weights for soft constraints, weights for relaxed-mode (Phase-2)
penalties, the integer scaling factor, and the over-Soll piecewise
tier widths. No imports from anywhere else in the project — config
is at the bottom of the dependency graph.

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
The values below aren't arbitrary. They form a deliberate hierarchy
where each tier dominates the next by orders of magnitude:

  Tier  1  (millions)  — uncovered shift / qualification    must win
  Tier  2  (10s of k)  — utilization
  Tier  3  (10s..1k)   — hours accuracy & overtime
  Tier  4  (1k..1)     — wishes & preferences
  Tier  5  (10k..500k) — cross-month boundary carryover
  Tier -1  (millions)  — relaxed-mode penalties (Phase 2 only)

Concretely: filling EVERY required staffing slot must always beat
ANY combination of overtime / weekend / rest-after-streak penalties.
That's why W_QUALIFICATION (5M) > W_STAFFING_MIN (3M) > W_WBL_BL
(500k) > everything else. If you raise a Tier-3 weight above
W_STAFFING_MIN you will, eventually, see the solver leave a
required slot empty to avoid that Tier-3 cost. Be careful.

The piecewise over-Soll ladder ALSO has internal monotonicity that
must hold: T1 < T2 < T3 < T4 within each contract type, and within
each tier MINI > PT > FT. The fairness cap (W_MAX_OT_*) sits ON TOP
of the per-employee piecewise — it nudges the solver to flatten
peaks across employees when several distributions have similar
total piecewise cost.
"""

from __future__ import annotations


# ══════════════════════════════════════════════════════════════════════
# Structural constants (not weights, but shape the objective math)
# ══════════════════════════════════════════════════════════════════════

# Integer scale factor for hour-based variables. CP-SAT only does
# integer arithmetic, so paid hours (which can be fractional, e.g.
# 7.75) are multiplied by SCALE before entering the model. All
# per-hour weights below assume hours have been pre-multiplied by
# this factor — i.e. effective cost-per-hour = weight × SCALE.
SCALE = 100

# Width (in hours) of the over-Soll piecewise tiers. The cumulative
# edges are 4h, 8h, 16h. So:
#   T1 covers hours 0..+4h above Soll
#   T2 covers hours +4h..+8h
#   T3 covers hours +8h..+16h
#   T4 covers hours +16h..+∞
#
# Chosen so T1 = "absorb a missing shift", T2 = "noticeable", T3 =
# "blowout", T4 = "prohibitive — only to keep a required slot filled".
OVER_SOLL_TIER_WIDTHS_H = (4, 4, 8)


# ══════════════════════════════════════════════════════════════════════
# TIER 1 — Coverage (must dominate everything else)
#
# Uncovered required slots are the worst possible outcome — a nurse
# manager will always rather pay overtime than face an empty
# Frühschicht. These weights are deliberately HUGE so any other cost
# the solver could trade against is dwarfed.
# ══════════════════════════════════════════════════════════════════════

# A required-qualification slot is uncovered (e.g. no Examinierte on
# the shift). Highest priority of all soft penalties.
W_QUALIFICATION = 5_000_000

# Headcount on a shift is below the configured minimum
# (e.g. only 2 of 3 required nurses).
W_STAFFING_MIN = 3_000_000

# A WBL employee (non-fulltime-BL) did NOT get a BL shift in a
# workable ISO week. Almost-hard rule. Sits at ~17% of W_STAFFING_MIN
# so a bare required slot still wins, but the solver strongly
# prefers parking a BL onto each available WBL week.
# Absence-only weeks are skipped automatically by add_wbl_bl_soft.
W_WBL_BL = 500_000


# ══════════════════════════════════════════════════════════════════════
# TIER 2 — Utilization
# ══════════════════════════════════════════════════════════════════════

# Employee is severely underused vs. their contract — gets very few
# shifts assigned. Soft floor on per-employee assignments so the
# solver doesn't park a whole month's load on three convenient FTs.
W_MIN_UTIL = 30_000


# ══════════════════════════════════════════════════════════════════════
# TIER 3 — Hours accuracy
#
# Three sub-groups: legacy generic Soll-deviation, flat overtime
# above hard cap, and the piecewise-linear over-Soll ladder + max-OT
# fairness cap. All are contract-tiered (FT < PT < MJ).
# ══════════════════════════════════════════════════════════════════════

# ── 3a. Legacy generic Soll-deviation ───────────────────────────────

# Generic deviation from monthly Soll-Stunden (both sides). Gentle
# nudge applied to every employee.
W_SOLL_DEV = 100

# Hours below Soll. Pushes the solver toward filling people up.
W_UNDERCUT = 150

# Spread of deviations across employees. Keeps no single person
# unfairly far from Soll.
W_FAIRNESS = 50


# ── 3b. Flat overtime above hard cap, per contract type ─────────────
# Applied per SCALE'd hour above (Soll + maxOvertimeHours).
# FT absorbs cheaply, PT moderately, MJ heavily — the solver only
# pushes mini-jobbers into overtime when nothing else can cover a
# required slot. Note MJ is also separately bounded by add_mini_job_cap
# (the legal monthly cap stays a hard rule).

W_OVERTIME_FT = 30          #     3_000 per hour
W_OVERTIME_PT = 200         #    20_000 per hour
W_OVERTIME_MINI = 2_000     #   200_000 per hour


# ── 3c. Under-Soll hard penalty (hours below Soll + min_delta) ──────
# Used for the UNDER-Soll half only. The OVER-Soll half is handled
# by the piecewise ladder below. Same FT/PT/MJ tiering.

W_SOLL_HARD_FT = 50         #     5_000 per hour
W_SOLL_HARD_PT = 300        #    30_000 per hour
W_SOLL_HARD_MINI = 3_000    #   300_000 per hour


# ── 3d. Over-Soll piecewise-linear ladder ───────────────────────────
# Four monotonically-escalating tiers per contract type. Each
# additional hour over Soll is progressively more expensive, so
# spreading +2h across 5 people is cheaper than dumping +20h on one
# person.
#
# Tier edges (cumulative hours above Soll): see OVER_SOLL_TIER_WIDTHS_H
#   T1 = [0..+4h]   cheap   — "absorb a missing shift" range
#   T2 = [+4..+8h]  moderate — noticeable unfairness
#   T3 = [+8..+16h] steep    — blowout range
#   T4 = [+16h..∞]  prohibit — only accepted to cover required slot
#
# Required orderings:
#   • T1_X < T2_X < T3_X < T4_X within each contract type X
#   • T_n_FT < T_n_PT < T_n_MINI within each tier n
# Breaking these orderings causes pathological behavior (solver
# preferring to push someone deeper over Soll).

# FT piecewise ladder
W_OVER_SOLL_T1_FT = 50          #     5_000 per hour (0..+4h)
W_OVER_SOLL_T2_FT = 150         #    15_000 per hour (+4..+8h)
W_OVER_SOLL_T3_FT = 400         #    40_000 per hour (+8..+16h)
W_OVER_SOLL_T4_FT = 1_000       #   100_000 per hour (+16h+)

# PT piecewise ladder (~3× FT)
W_OVER_SOLL_T1_PT = 150         #    15_000 per hour (0..+4h)
W_OVER_SOLL_T2_PT = 400         #    40_000 per hour (+4..+8h)
W_OVER_SOLL_T3_PT = 1_000       #   100_000 per hour (+8..+16h)
W_OVER_SOLL_T4_PT = 2_500       #   250_000 per hour (+16h+)

# MJ piecewise ladder (~20× FT) — MJ should never take overtime
# unless it's the only way to keep a required slot filled.
W_OVER_SOLL_T1_MINI = 1_000     #   100_000 per hour (0..+4h)
W_OVER_SOLL_T2_MINI = 3_000     #   300_000 per hour (+4..+8h)
W_OVER_SOLL_T3_MINI = 8_000     #   800_000 per hour (+8..+16h)
W_OVER_SOLL_T4_MINI = 20_000    # 2_000_000 per hour (+16h+)


# ── 3e. Fairness cap on peak over-Soll ──────────────────────────────
# A single IntVar per contract type, constrained to be ≥ every
# employee's over-Soll hours. Penalizing the MAX (in addition to the
# per-employee piecewise) pushes the solver to flatten peaks when
# multiple distributions have similar total piecewise cost.
# MJ excluded — the MJ piecewise alone is already prohibitive.

W_MAX_OT_FT = 300               #    30_000 per hour of peak FT over-Soll
W_MAX_OT_PT = 1_000             #   100_000 per hour of peak PT over-Soll


# ══════════════════════════════════════════════════════════════════════
# TIER 4 — Wishes & preferences
#
# Lowest-priority soft penalties. Tiny compared to coverage and hours
# accuracy — wishes lose every fight against staffing math.
# ══════════════════════════════════════════════════════════════════════

# An ordinary wish (Wunschdienst / Frei-Wunsch) is NOT fulfilled.
W_WISH_NORMAL = 3_000

# A strong wish (priority HIGH) is not fulfilled. ~2× normal.
W_WISH_STRONG = 6_000

# Tiebreaker against assigning shift types outside an employee's
# preferredShiftTypes. Tiny — only matters when nothing else is at
# stake.
W_PREFERENCE = 1

# Deviation from an employee's preferred mix of shift profiles
# (e.g. "60% Früh / 40% Spät").
W_DISTRIBUTION = 500


# ══════════════════════════════════════════════════════════════════════
# TIER 5 — Cross-month boundary
#
# Penalties for streaks/weekends that carry over from the previous
# month's plan into the current month.
# ══════════════════════════════════════════════════════════════════════

# Alternating-weekend rule violated when last month's previous
# assignments push someone into a 2-weekends-in-a-row situation.
W_WEEKEND_BOUNDARY = 10_000

# Carryover from previous month creates a streak longer than
# maxConsecutiveDays in the first days of this month. High because
# max-consecutive-days is NOT on the user-breakable list.
W_CONSEC_DAYS_BOUNDARY = 500_000

# After 6+ consecutive days at end of previous month, employee
# should get rest days at the start of this month. Reduced so
# staffing wins.
W_REST_AFTER_6_BOUNDARY = 30_000


# ══════════════════════════════════════════════════════════════════════
# TIER -1 — Relaxed-mode (Phase 2) penalties
#
# These weights apply ONLY when the strict model returned INFEASIBLE
# and we re-solve with selected hard rules turned into very expensive
# soft rules. The high values keep these rules near-hard; the values
# below W_STAFFING_MIN (3M) are deliberately chosen to be broken in
# preference to leaving a required slot empty.
#
# Above W_STAFFING_MIN  → "still near-hard"
# Below W_STAFFING_MIN  → "we'd rather break this than leave a slot empty"
# ══════════════════════════════════════════════════════════════════════

# Min 11h rest between two consecutive shifts. Highest of all relax
# weights — this should almost never break.
W_RELAX_MIN_REST = 20_000_000

# Max consecutive night shifts.
W_RELAX_CONSEC_NIGHTS = 15_000_000

# Max consecutive working days.
W_RELAX_CONSEC_DAYS = 15_000_000

# Max headcount per shift (over-staffing).
W_RELAX_STAFFING_MAX = 8_000_000

# MiniJob legal monthly hour cap.
W_RELAX_MINI_JOB_CAP = 6_000_000

# WBL max weekend days.
W_RELAX_WBL_WEEKEND_LIMIT = 1_500_000

# WBL max one BL shift per week.
W_RELAX_WBL_BL_MAX_PER_WEEK = 1_000_000

# WBL min one BL shift per workable week.
W_RELAX_WBL_BL_WEEKLY_MIN = 800_000

# Required rest days after a 6+ day streak.
# BELOW W_STAFFING_MIN — staffing wins.
W_RELAX_REST_AFTER_6 = 300_000

# Alternating weekends rule.
# BELOW W_STAFFING_MIN — staffing wins.
W_RELAX_ALT_WEEKENDS = 100_000
