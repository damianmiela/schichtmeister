"""Soft objective terms for the CP-SAT model.

All functions return lists of (variable, weight) tuples to be added to the
global minimization objective.  Positive weight = cost to minimize.
"""

from __future__ import annotations

from datetime import timedelta

from ortools.sat.python import cp_model

from models import SolveRequest
from utils import dates_in_range, iso_week_key

# All objective weights live on the Weights dataclass in solver/config.py.
# Constraint builders take the active Weights instance (`w`) as their
# trailing parameter and read e.g. ``w.W_QUALIFICATION`` instead of
# importing bare module constants. SCALE and OVER_SOLL_TIER_WIDTHS_H are
# structural (NOT user-tunable) so they're imported as constants.
from config import SCALE, OVER_SOLL_TIER_WIDTHS_H, Weights

ShiftVar = dict[tuple[str, str, str], cp_model.IntVar]


def _contract_type(emp) -> str:
    ct = getattr(emp, "contractType", None) or "FULL_TIME"
    return ct.upper()


def overtime_weight(emp, w: Weights) -> int:
    """Return per-scaled-unit overtime penalty weight for an employee."""
    ct = _contract_type(emp)
    if ct == "MINI_JOB":
        return w.W_OVERTIME_MINI
    if ct == "PART_TIME":
        return w.W_OVERTIME_PT
    return w.W_OVERTIME_FT


def soll_hard_weight(emp, w: Weights) -> int:
    """Return per-scaled-unit penalty for hours outside soll delta range.

    NOTE: Only used for the UNDER-soll half (hours below soll+min_delta).
    Over-soll is now handled by the piecewise ladder in
    `over_soll_piecewise_weights`.
    """
    ct = _contract_type(emp)
    if ct == "MINI_JOB":
        return w.W_SOLL_HARD_MINI
    if ct == "PART_TIME":
        return w.W_SOLL_HARD_PT
    return w.W_SOLL_HARD_FT


def over_soll_piecewise_weights(emp, w: Weights) -> tuple[int, int, int, int]:
    """Return the (T1, T2, T3, T4) piecewise weights per scaled unit
    for over-soll hours, tiered by contract type.

    Tier edges (cumulative hours above soll): T1=[0..4], T2=[4..8],
    T3=[8..16], T4=[16..∞).
    """
    ct = _contract_type(emp)
    if ct == "MINI_JOB":
        return (
            w.W_OVER_SOLL_T1_MINI,
            w.W_OVER_SOLL_T2_MINI,
            w.W_OVER_SOLL_T3_MINI,
            w.W_OVER_SOLL_T4_MINI,
        )
    if ct == "PART_TIME":
        return (
            w.W_OVER_SOLL_T1_PT,
            w.W_OVER_SOLL_T2_PT,
            w.W_OVER_SOLL_T3_PT,
            w.W_OVER_SOLL_T4_PT,
        )
    return (
        w.W_OVER_SOLL_T1_FT,
        w.W_OVER_SOLL_T2_FT,
        w.W_OVER_SOLL_T3_FT,
        w.W_OVER_SOLL_T4_FT,
    )


def max_ot_cap_weight(emp, w: Weights) -> int:
    """Per-scaled-unit weight for the fairness max-overtime cap.
    MJ excluded (piecewise alone is prohibitive).
    """
    ct = _contract_type(emp)
    if ct == "PART_TIME":
        return w.W_MAX_OT_PT
    if ct == "MINI_JOB":
        return 0
    return w.W_MAX_OT_FT


# Tier -1 (relaxed-mode penalties) is defined in solver/config.py and
# imported at the top of this file. See config.py for the full list
# and the rationale for which sit above vs. below W_STAFFING_MIN.


def _emp_station_map(req: SolveRequest) -> dict[str, set[int]]:
    return {e.id: set(e.assignedStations) if e.assignedStations else set() for e in req.employees}


def _sh_emp_ids(req: SolveRequest) -> set[str]:
    """IDs of SH (Stationshilfe) employees — excluded from station coverage."""
    return {e.id for e in req.employees if "SH" in e.qualificationTags}


def _emp_can_cover_station(emp_stations: set[int], station: int | None, is_fw: bool) -> bool:
    """Check if an employee can cover a staffing requirement's station."""
    if is_fw:
        return True
    if station is None:
        return True
    if not emp_stations:
        return True
    return station in emp_stations


StationAssign = dict[tuple[str, str, int], cp_model.IntVar]


def _make_both_var(
    model: cp_model.CpModel,
    a: cp_model.IntVar,
    b: cp_model.IntVar,
    name: str,
) -> cp_model.IntVar:
    """Create a boolean variable that equals a AND b."""
    both = model.NewBoolVar(name)
    model.AddBoolAnd([a, b]).OnlyEnforceIf(both)
    model.AddBoolOr([a.Not(), b.Not()]).OnlyEnforceIf(both.Not())
    return both


def add_staffing_minimum_soft(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    station_assign: StationAssign | None = None,
    w: Weights = Weights(),
) -> list[tuple[cp_model.IntVar, int]]:
    """Penalize understaffing — each missing person per day per requirement costs W_STAFFING_MIN.

    BL profiles are excluded from station headcount.
    SH employees are excluded — they don't count toward station coverage.
    Multi-station employees only count toward the station they are assigned to
    (via station_assign variables), preventing double-counting.
    """
    terms: list[tuple[cp_model.IntVar, int]] = []
    dates = dates_in_range(req.periodStart, req.periodEnd)
    emp_stations = _emp_station_map(req)
    bl_profile_ids = {p.id for p in req.shiftProfiles if p.shiftType == "BL"}
    sh_employees = _sh_emp_ids(req)

    # Precompute works_type[emp_id, ds, shiftType] indicator vars (cached)
    works_type_cache: dict[tuple[str, str, str], cp_model.IntVar] = {}

    for sr in req.staffingRequirements:
        if sr.minTotalCount <= 0:
            continue
        for d in dates:
            ds = d.isoformat()
            covering: list[cp_model.IntVar] = []
            for emp in req.employees:
                if emp.id in sh_employees:
                    continue  # SH don't count toward station coverage
                es = emp_stations[emp.id]

                # Collect shift vars for this employee + day + matching shiftType
                emp_shift_vars: list[cp_model.IntVar] = []
                for p in req.shiftProfiles:
                    if p.shiftType != sr.shiftType or p.id in bl_profile_ids:
                        continue
                    key = (emp.id, ds, p.id)
                    if key in shift:
                        emp_shift_vars.append(shift[key])

                if not emp_shift_vars:
                    continue

                if sr.isFacilityWide:
                    # Facility-wide: everyone counts directly
                    covering.extend(emp_shift_vars)
                elif sr.stationNumber is None:
                    covering.extend(emp_shift_vars)
                elif len(es) == 1:
                    # Single-station: count only if they match the required station
                    if sr.stationNumber in es:
                        covering.extend(emp_shift_vars)
                else:
                    # Multi-station OR floater: use station_assign
                    sa_key = (emp.id, ds, sr.stationNumber)
                    if station_assign and sa_key in station_assign:
                        wt_key = (emp.id, ds, sr.shiftType)
                        if wt_key not in works_type_cache:
                            wt = model.NewBoolVar(f"wt_{emp.id}_{ds}_{sr.shiftType}")
                            model.Add(sum(emp_shift_vars) >= 1).OnlyEnforceIf(wt)
                            model.Add(sum(emp_shift_vars) == 0).OnlyEnforceIf(wt.Not())
                            works_type_cache[wt_key] = wt
                        wt_var = works_type_cache[wt_key]
                        both = _make_both_var(
                            model, wt_var, station_assign[sa_key],
                            f"cov_{emp.id}_{ds}_{sr.shiftType}_{sr.stationNumber}",
                        )
                        covering.append(both)

            if not covering:
                continue
            total_assigned = model.NewIntVar(0, len(covering), f"staff_{sr.shiftType}_{sr.stationNumber}_{ds}")
            model.Add(total_assigned == sum(covering))
            shortfall = model.NewIntVar(0, sr.minTotalCount, f"staff_short_{sr.shiftType}_{sr.stationNumber}_{ds}")
            model.Add(shortfall >= sr.minTotalCount - total_assigned)
            terms.append((shortfall, w.W_STAFFING_MIN))
    return terms


def add_qualification_coverage_soft(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    station_assign: StationAssign | None = None,
    w: Weights = Weights(),
) -> list[tuple[cp_model.IntVar, int]]:
    """Penalize missing qualification coverage per day.

    BL profiles excluded.  SH employees excluded — they don't fill
    qualification requirement slots.  Multi-station employees only count
    toward the station they are assigned to (via station_assign).
    """
    terms: list[tuple[cp_model.IntVar, int]] = []
    dates = dates_in_range(req.periodStart, req.periodEnd)
    emp_tags: dict[str, set[str]] = {
        e.id: set(e.qualificationTags) for e in req.employees
    }
    emp_stations = _emp_station_map(req)
    bl_profile_ids = {p.id for p in req.shiftProfiles if p.shiftType == "BL"}
    sh_employees = _sh_emp_ids(req)

    # Reuse works_type cache across iterations
    works_type_cache: dict[tuple[str, str, str], cp_model.IntVar] = {}

    for sr in req.staffingRequirements:
        for qr in sr.qualificationRequirements:
            tags = [t.strip() for t in ",".join(qr.tags).split(",")]
            if qr.minCount <= 0:
                continue
            for d in dates:
                ds = d.isoformat()
                qualified_vars: list[cp_model.IntVar] = []
                for emp in req.employees:
                    if emp.id in sh_employees:
                        continue  # SH don't fill qual requirement slots
                    if not any(t in emp_tags.get(emp.id, set()) for t in tags):
                        continue

                    es = emp_stations[emp.id]

                    # Collect shift vars for matching shiftType (excluding BL)
                    emp_shift_vars: list[cp_model.IntVar] = []
                    for p in req.shiftProfiles:
                        if p.shiftType != sr.shiftType or p.id in bl_profile_ids:
                            continue
                        key = (emp.id, ds, p.id)
                        if key in shift:
                            emp_shift_vars.append(shift[key])

                    if not emp_shift_vars:
                        continue

                    if sr.isFacilityWide:
                        qualified_vars.extend(emp_shift_vars)
                    elif sr.stationNumber is None:
                        qualified_vars.extend(emp_shift_vars)
                    elif len(es) == 1:
                        if sr.stationNumber in es:
                            qualified_vars.extend(emp_shift_vars)
                    else:
                        # Multi-station OR floater: use station_assign
                        sa_key = (emp.id, ds, sr.stationNumber)
                        if station_assign and sa_key in station_assign:
                            wt_key = (emp.id, ds, sr.shiftType)
                            if wt_key not in works_type_cache:
                                wt = model.NewBoolVar(f"wt_{emp.id}_{ds}_{sr.shiftType}")
                                model.Add(sum(emp_shift_vars) >= 1).OnlyEnforceIf(wt)
                                model.Add(sum(emp_shift_vars) == 0).OnlyEnforceIf(wt.Not())
                                works_type_cache[wt_key] = wt
                            wt_var = works_type_cache[wt_key]
                            both = _make_both_var(
                                model, wt_var, station_assign[sa_key],
                                f"qcov_{emp.id}_{ds}_{sr.shiftType}_{sr.stationNumber}_{'_'.join(tags[:1])}",
                            )
                            qualified_vars.append(both)

                if not qualified_vars:
                    continue
                total_qualified = model.NewIntVar(0, len(qualified_vars), f"qual_{sr.shiftType}_{sr.stationNumber}_{ds}_{'_'.join(tags[:2])}")
                model.Add(total_qualified == sum(qualified_vars))
                shortfall = model.NewIntVar(0, qr.minCount, f"qual_short_{sr.shiftType}_{sr.stationNumber}_{ds}_{'_'.join(tags[:2])}")
                model.Add(shortfall >= qr.minCount - total_qualified)
                terms.append((shortfall, w.W_QUALIFICATION))

                # Penalize exceeding maxCount
                if qr.maxCount is not None and qr.maxCount > 0:
                    excess = model.NewIntVar(0, len(qualified_vars), f"qual_excess_{sr.shiftType}_{sr.stationNumber}_{ds}_{'_'.join(tags[:2])}")
                    model.Add(excess >= total_qualified - qr.maxCount)
                    terms.append((excess, w.W_QUALIFICATION))
    return terms


def add_wbl_bl_soft(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    w: Weights = Weights(),
) -> list[tuple[cp_model.IntVar, int]]:
    """Penalize WBL employees missing BL shifts (at least 1 per ISO week). Skip full-time BL."""
    terms: list[tuple[cp_model.IntVar, int]] = []
    wbl_emps = [e for e in req.employees if e.isWbl and not e.isFullTimeBl]
    bl_profiles = {p.id for p in req.shiftProfiles if p.shiftType == "BL"}
    if not wbl_emps or not bl_profiles:
        return terms

    dates = dates_in_range(req.periodStart, req.periodEnd)
    weeks: dict[str, list] = {}
    for d in dates:
        wk = iso_week_key(d)
        weeks.setdefault(wk, []).append(d)

    for emp in wbl_emps:
        emp_bl = {pid for pid in bl_profiles
                  if emp.allowedShiftProfileIds == [] or pid in emp.allowedShiftProfileIds}
        if not emp_bl:
            continue
        for wk, wk_dates in weeks.items():
            bl_vars = []
            for d in wk_dates:
                ds = d.isoformat()
                for pid in emp_bl:
                    key = (emp.id, ds, pid)
                    if key in shift:
                        bl_vars.append(shift[key])
            if not bl_vars:
                continue
            has_bl = model.NewBoolVar(f"wbl_bl_{emp.id}_{wk}")
            model.Add(sum(bl_vars) >= 1).OnlyEnforceIf(has_bl)
            model.Add(sum(bl_vars) == 0).OnlyEnforceIf(has_bl.Not())
            miss_bl = model.NewBoolVar(f"wbl_miss_{emp.id}_{wk}")
            model.Add(miss_bl == 1 - has_bl)
            terms.append((miss_bl, w.W_WBL_BL))
    return terms


def add_min_utilization_soft(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    w: Weights = Weights(),
) -> list[tuple[cp_model.IntVar, int]]:
    """Penalize employees who get far fewer shifts than their soll requires.

    For each employee, compute a target shift count from soll hours and the
    average shift duration.  Penalize each missing shift below half that target
    with W_MIN_UTIL.  This prevents the solver from concentrating all work on
    a subset of employees while leaving others idle.
    """
    terms: list[tuple[cp_model.IntVar, int]] = []
    dates = dates_in_range(req.periodStart, req.periodEnd)
    soll_map = req.monthlySollHoursByEmployee or {}

    active_hours = [p.paidHours for p in req.shiftProfiles if p.isActive and p.paidHours > 0]
    avg_hours = sum(active_hours) / len(active_hours) if active_hours else 8.0

    for emp in req.employees:
        soll = soll_map.get(emp.id)
        if soll is None:
            pct = emp.targetHoursPercent
            if pct is None:
                continue
            wd = req.monthlyWorkingDays or 22
            soll = wd * 8.0 * (pct / 100.0)

        if soll <= 0:
            continue

        target_shifts = soll / avg_hours
        min_shifts = max(1, int(target_shifts * 0.5))

        emp_vars: list[cp_model.IntVar] = []
        for d in dates:
            ds = d.isoformat()
            for p in req.shiftProfiles:
                key = (emp.id, ds, p.id)
                if key in shift:
                    emp_vars.append(shift[key])

        if not emp_vars:
            continue

        total_shifts = model.NewIntVar(0, len(emp_vars), f"util_count_{emp.id}")
        model.Add(total_shifts == sum(emp_vars))

        shortfall = model.NewIntVar(0, min_shifts, f"util_short_{emp.id}")
        model.Add(shortfall >= min_shifts - total_shifts)
        terms.append((shortfall, w.W_MIN_UTIL))

    return terms


def add_soll_deviation(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    w: Weights = Weights(),
) -> list[tuple[cp_model.IntVar, int]]:
    """Minimize |total_hours[e] - soll[e]| with tiered penalties.

    Over-soll hours are penalized via a 4-tier piecewise-linear ladder
    with monotonically escalating weights (see W_OVER_SOLL_T*_* in this
    module). Additionally a single per-contract-type max-overtime IntVar
    is penalized to discourage concentrating all the month's overtime
    on a few employees — this is the "fairness cap".

    Under-soll hours below soll+min_delta retain the legacy flat
    soll_hard penalty.
    """
    terms: list[tuple[cp_model.IntVar, int]] = []
    dates = dates_in_range(req.periodStart, req.periodEnd)
    soll_map = req.monthlySollHoursByEmployee or {}
    min_delta = req.rules.sollMinDelta

    # Precompute scaled tier edges (cumulative hours above soll).
    t1_w, t2_w, t3_w = OVER_SOLL_TIER_WIDTHS_H
    edge1_scaled = t1_w * SCALE              # end of T1 / start of T2
    edge2_scaled = (t1_w + t2_w) * SCALE     # end of T2 / start of T3
    edge3_scaled = (t1_w + t2_w + t3_w) * SCALE  # end of T3 / start of T4

    BIG = 744 * SCALE

    # Max-overtime fairness cap variables (created lazily; only added to
    # the objective if at least one employee of that contract type is
    # present).
    max_ot_ft = model.NewIntVar(0, BIG, "max_ot_ft")
    max_ot_pt = model.NewIntVar(0, BIG, "max_ot_pt")
    has_ft = False
    has_pt = False

    for emp in req.employees:
        soll = soll_map.get(emp.id)
        if soll is None:
            pct = emp.targetHoursPercent
            if pct is None:
                continue
            wd = req.monthlyWorkingDays or 22
            soll = wd * 8.0 * (pct / 100.0)

        hour_vars: list[tuple[cp_model.IntVar, int]] = []
        for p in req.shiftProfiles:
            ph = int(p.paidHours * SCALE)
            for d in dates:
                key = (emp.id, d.isoformat(), p.id)
                if key in shift:
                    hour_vars.append((shift[key], ph))

        if not hour_vars:
            continue

        soll_scaled = int(soll * SCALE)
        total = model.NewIntVar(0, BIG, f"total_{emp.id}")
        model.Add(total == sum(v * h for v, h in hour_vars))

        # |total - soll| baseline deviation (keeps the legacy gentle nudge).
        dev = model.NewIntVar(0, BIG, f"dev_{emp.id}")
        model.Add(dev >= total - soll_scaled)
        model.Add(dev >= soll_scaled - total)
        terms.append((dev, w.W_SOLL_DEV))

        # ── Piecewise-linear OVER-soll penalty (tiers T1..T4) ─────────
        # over_total = max(0, total - soll).
        # excess_over_edgeN = max(0, over_total - edgeN).
        # Cost encoded incrementally:
        #   weight_used_for_first_hour   = w1
        #   weight_used_for_hours_past_4 = w2 (so add (w2 - w1) to excess_over_edge1)
        #   weight_used_for_hours_past_8 = w3 (so add (w3 - w2) to excess_over_edge2)
        #   weight_used_for_hours_past_16 = w4
        # This yields a piecewise-linear penalty with slope
        # w1 / w2 / w3 / w4 in the four tiers.
        over_total = model.NewIntVar(0, BIG, f"over_total_{emp.id}")
        model.Add(over_total >= total - soll_scaled)

        excess_e1 = model.NewIntVar(0, BIG, f"over_e1_{emp.id}")
        model.Add(excess_e1 >= over_total - edge1_scaled)

        excess_e2 = model.NewIntVar(0, BIG, f"over_e2_{emp.id}")
        model.Add(excess_e2 >= over_total - edge2_scaled)

        excess_e3 = model.NewIntVar(0, BIG, f"over_e3_{emp.id}")
        model.Add(excess_e3 >= over_total - edge3_scaled)

        w1, w2, w3, w4 = over_soll_piecewise_weights(emp, w)
        # Base tier 1 weight on the full over_total; subsequent tiers
        # add the *delta* so slopes monotonically escalate.
        terms.append((over_total, w1))
        terms.append((excess_e1, max(w2 - w1, 0)))
        terms.append((excess_e2, max(w3 - w2, 0)))
        terms.append((excess_e3, max(w4 - w3, 0)))

        # ── Fairness cap: max over_total across FT / PT ───────────────
        ct = _contract_type(emp)
        if ct == "FULL_TIME":
            model.Add(max_ot_ft >= over_total)
            has_ft = True
        elif ct == "PART_TIME":
            model.Add(max_ot_pt >= over_total)
            has_pt = True

        # ── Legacy UNDER-soll hard penalty (unchanged) ────────────────
        lower_bound_scaled = int((soll + min_delta) * SCALE)
        w_hard = soll_hard_weight(emp, w)

        under_excess = model.NewIntVar(0, BIG, f"soll_under_{emp.id}")
        model.Add(under_excess >= lower_bound_scaled - total)
        terms.append((under_excess, w_hard))

    if has_ft:
        terms.append((max_ot_ft, w.W_MAX_OT_FT))
    if has_pt:
        terms.append((max_ot_pt, w.W_MAX_OT_PT))

    return terms


def add_overtime_penalty(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    w: Weights = Weights(),
) -> list[tuple[cp_model.IntVar, int]]:
    """Extra penalty when total > soll + maxOvertimeHours."""
    terms: list[tuple[cp_model.IntVar, int]] = []
    dates = dates_in_range(req.periodStart, req.periodEnd)
    soll_map = req.monthlySollHoursByEmployee or {}
    max_ot = req.rules.maxOvertimeHours

    for emp in req.employees:
        soll = soll_map.get(emp.id)
        if soll is None:
            pct = emp.targetHoursPercent
            if pct is None:
                continue
            wd = req.monthlyWorkingDays or 22
            soll = wd * 8.0 * (pct / 100.0)

        hour_vars: list[tuple[cp_model.IntVar, int]] = []
        for p in req.shiftProfiles:
            ph = int(p.paidHours * SCALE)
            for d in dates:
                key = (emp.id, d.isoformat(), p.id)
                if key in shift:
                    hour_vars.append((shift[key], ph))

        if not hour_vars:
            continue

        cap_scaled = int((soll + max_ot) * SCALE)
        total = model.NewIntVar(0, 744 * SCALE, f"ot_total_{emp.id}")
        model.Add(total == sum(v * h for v, h in hour_vars))

        excess = model.NewIntVar(0, 744 * SCALE, f"ot_excess_{emp.id}")
        model.Add(excess >= total - cap_scaled)
        # Contract-tiered: cheap for full-timers, heavy for mini-jobbers.
        terms.append((excess, overtime_weight(emp, w)))

    return terms


def add_undercut_penalty(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    w: Weights = Weights(),
) -> list[tuple[cp_model.IntVar, int]]:
    """Penalty when total < soll - maxUndercutHours."""
    terms: list[tuple[cp_model.IntVar, int]] = []
    dates = dates_in_range(req.periodStart, req.periodEnd)
    soll_map = req.monthlySollHoursByEmployee or {}
    max_under = req.rules.maxUndercutHours

    for emp in req.employees:
        soll = soll_map.get(emp.id)
        if soll is None:
            pct = emp.targetHoursPercent
            if pct is None:
                continue
            wd = req.monthlyWorkingDays or 22
            soll = wd * 8.0 * (pct / 100.0)

        hour_vars: list[tuple[cp_model.IntVar, int]] = []
        for p in req.shiftProfiles:
            ph = int(p.paidHours * SCALE)
            for d in dates:
                key = (emp.id, d.isoformat(), p.id)
                if key in shift:
                    hour_vars.append((shift[key], ph))

        if not hour_vars:
            continue

        floor_scaled = int((soll - max_under) * SCALE)
        total = model.NewIntVar(0, 744 * SCALE, f"uc_total_{emp.id}")
        model.Add(total == sum(v * h for v, h in hour_vars))

        under = model.NewIntVar(0, 744 * SCALE, f"uc_under_{emp.id}")
        model.Add(under >= floor_scaled - total)
        terms.append((under, w.W_UNDERCUT))

    return terms


def add_wish_fulfillment(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    w: Weights = Weights(),
) -> list[tuple[cp_model.IntVar, int]]:
    """Penalize unfulfilled wishes (higher weight for STRONG)."""
    terms: list[tuple[cp_model.IntVar, int]] = []

    for wish in req.wishes:
        matching_vars: list[cp_model.IntVar] = []
        for p in req.shiftProfiles:
            if wish.shiftProfileId and p.id != wish.shiftProfileId:
                continue
            if wish.shiftType and p.shiftType != wish.shiftType:
                continue
            key = (wish.employeeId, wish.date, p.id)
            if key in shift:
                matching_vars.append(shift[key])

        if not matching_vars:
            continue

        fulfilled = model.NewBoolVar(f"wish_{wish.id}")
        model.Add(sum(matching_vars) >= 1).OnlyEnforceIf(fulfilled)
        model.Add(sum(matching_vars) == 0).OnlyEnforceIf(fulfilled.Not())

        weight = w.W_WISH_STRONG if wish.priority == "STRONG" else w.W_WISH_NORMAL
        miss = model.NewBoolVar(f"wish_miss_{wish.id}")
        model.Add(miss == 1 - fulfilled)
        terms.append((miss, weight))

    return terms


def add_fairness(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    w: Weights = Weights(),
) -> list[tuple[cp_model.IntVar, int]]:
    """Minimax: minimize the maximum absolute deviation across employees."""
    terms: list[tuple[cp_model.IntVar, int]] = []
    dates = dates_in_range(req.periodStart, req.periodEnd)
    soll_map = req.monthlySollHoursByEmployee or {}

    dev_vars: list[cp_model.IntVar] = []
    for emp in req.employees:
        soll = soll_map.get(emp.id)
        if soll is None:
            pct = emp.targetHoursPercent
            if pct is None:
                continue
            wd = req.monthlyWorkingDays or 22
            soll = wd * 8.0 * (pct / 100.0)

        hour_vars: list[tuple[cp_model.IntVar, int]] = []
        for p in req.shiftProfiles:
            ph = int(p.paidHours * SCALE)
            for d in dates:
                key = (emp.id, d.isoformat(), p.id)
                if key in shift:
                    hour_vars.append((shift[key], ph))

        if not hour_vars:
            continue

        soll_scaled = int(soll * SCALE)
        total = model.NewIntVar(0, 744 * SCALE, f"fair_total_{emp.id}")
        model.Add(total == sum(v * h for v, h in hour_vars))

        dev = model.NewIntVar(0, 744 * SCALE, f"fair_dev_{emp.id}")
        model.Add(dev >= total - soll_scaled)
        model.Add(dev >= soll_scaled - total)
        dev_vars.append(dev)

    if dev_vars:
        max_dev = model.NewIntVar(0, 744 * SCALE, "max_dev")
        model.AddMaxEquality(max_dev, dev_vars)
        terms.append((max_dev, w.W_FAIRNESS))

    return terms


def add_preference_bonus(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    w: Weights = Weights(),
) -> list[tuple[cp_model.IntVar, int]]:
    """Small penalty for non-preferred shift types."""
    terms: list[tuple[cp_model.IntVar, int]] = []
    dates = dates_in_range(req.periodStart, req.periodEnd)

    for emp in req.employees:
        if not emp.preferredShiftTypes:
            continue
        pref_set = set(emp.preferredShiftTypes)
        for p in req.shiftProfiles:
            if p.shiftType in pref_set:
                continue
            for d in dates:
                key = (emp.id, d.isoformat(), p.id)
                if key in shift:
                    terms.append((shift[key], w.W_PREFERENCE))

    return terms


# W_DISTRIBUTION is defined in solver/config.py.


def add_shift_distribution_soft(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    w: Weights = Weights(),
) -> list[tuple[cp_model.IntVar, int]]:
    """Penalize deviation from employee's preferred shift profile distribution."""
    terms: list[tuple[cp_model.IntVar, int]] = []
    dates = dates_in_range(req.periodStart, req.periodEnd)
    soll_map = req.monthlySollHoursByEmployee or {}

    active_hours = [p.paidHours for p in req.shiftProfiles if p.isActive and p.paidHours > 0]
    avg_hours = sum(active_hours) / len(active_hours) if active_hours else 8.0

    for emp in req.employees:
        dist = emp.shiftDistribution
        if not dist:
            continue

        soll = soll_map.get(emp.id)
        if soll is None:
            pct = emp.targetHoursPercent
            if pct is None:
                continue
            wd = req.monthlyWorkingDays or 22
            soll = wd * 8.0 * (pct / 100.0)

        total_target_shifts = soll / avg_hours if avg_hours > 0 else 0

        for profile_id, percentage in dist.items():
            target_count = max(1, int(total_target_shifts * percentage / 100.0))

            profile_vars: list[cp_model.IntVar] = []
            for d in dates:
                ds = d.isoformat()
                key = (emp.id, ds, profile_id)
                if key in shift:
                    profile_vars.append(shift[key])

            if not profile_vars:
                continue

            actual = model.NewIntVar(0, len(profile_vars), f"dist_{emp.id}_{profile_id}")
            model.Add(actual == sum(profile_vars))

            dev = model.NewIntVar(0, len(profile_vars), f"dist_dev_{emp.id}_{profile_id}")
            model.Add(dev >= actual - target_count)
            model.Add(dev >= target_count - actual)
            terms.append((dev, w.W_DISTRIBUTION))

    return terms


# ── Cross-month boundary soft constraints ────────────────────────────
# W_CONSEC_DAYS_BOUNDARY and W_REST_AFTER_6_BOUNDARY are defined in
# solver/config.py (Tier 5).

WorksDay = dict[tuple[str, str], cp_model.IntVar]


def add_consecutive_days_boundary_soft(
    model: cp_model.CpModel,
    works_day: WorksDay,
    req: SolveRequest,
    w: Weights = Weights(),
) -> list[tuple[cp_model.IntVar, int]]:
    """Soft penalty for cross-month consecutive day streaks exceeding maxConsecutiveDays.

    Looks at previous assignments to find employees who worked the last N days
    of the previous month.  For each such employee, penalizes working on the
    first days of the current period that would extend their streak beyond the
    max.
    """
    terms: list[tuple[cp_model.IntVar, int]] = []

    if not req.previousAssignments:
        return terms

    dates = dates_in_range(req.periodStart, req.periodEnd)
    if not dates:
        return terms

    global_max = req.rules.maxConsecutiveDays
    first_date = dates[0]

    # Build previous work dates per employee
    prev_worked: dict[str, set[str]] = {}
    for pa in req.previousAssignments:
        prev_worked.setdefault(pa.employeeId, set()).add(pa.date)

    for emp in req.employees:
        max_days = emp.maxConsecutiveDays if emp.maxConsecutiveDays is not None else global_max
        emp_dates = prev_worked.get(emp.id, set())
        if not emp_dates:
            continue

        # Count consecutive days worked immediately before period start
        streak = 0
        for offset in range(1, 8):
            d = first_date - timedelta(days=offset)
            if d.isoformat() in emp_dates:
                streak += 1
            else:
                break

        if streak == 0:
            continue

        # Penalize working on the first days that would push streak > max_days
        remaining_before_violation = max(0, max_days - streak)
        # For each day in the current period that extends the streak past max_days,
        # add penalty.  But only if all prior current-period days are also worked.
        # Simplification: penalize days 0..min(streak, 3) of the current period
        # proportionally to how close the streak is to the limit.
        days_to_penalize = max(0, streak - remaining_before_violation + 1)
        for i in range(min(days_to_penalize, len(dates))):
            ds = dates[i].isoformat()
            key = (emp.id, ds)
            if key in works_day:
                # Higher penalty for days that definitively break the limit
                terms.append((works_day[key], w.W_CONSEC_DAYS_BOUNDARY))

    return terms


def add_rest_after_streak_boundary_soft(
    model: cp_model.CpModel,
    works_day: WorksDay,
    req: SolveRequest,
    w: Weights = Weights(),
) -> list[tuple[cp_model.IntVar, int]]:
    """Soft penalty for missing rest days after a 6+ day streak that spans
    the month boundary.

    If an employee worked 6+ consecutive days ending at the previous month's
    last day, penalize working on the first 2 days of the current period
    (they should be resting).
    """
    terms: list[tuple[cp_model.IntVar, int]] = []

    if not req.previousAssignments:
        return terms

    dates = dates_in_range(req.periodStart, req.periodEnd)
    if not dates:
        return terms

    rest_required = req.rules.requiredRestDaysAfter6
    first_date = dates[0]

    prev_worked: dict[str, set[str]] = {}
    for pa in req.previousAssignments:
        prev_worked.setdefault(pa.employeeId, set()).add(pa.date)

    for emp in req.employees:
        emp_dates = prev_worked.get(emp.id, set())
        if not emp_dates:
            continue

        # Count consecutive work days ending at the day before period start
        streak = 0
        for offset in range(1, 8):
            d = first_date - timedelta(days=offset)
            if d.isoformat() in emp_dates:
                streak += 1
            else:
                break

        if streak < 6:
            continue

        # Employee had 6+ consecutive days before period start.
        # Penalize working on the first rest_required days.
        for i in range(min(rest_required, len(dates))):
            ds = dates[i].isoformat()
            key = (emp.id, ds)
            if key in works_day:
                terms.append((works_day[key], w.W_REST_AFTER_6_BOUNDARY))

    return terms


def add_alternating_weekends_boundary_soft(
    model: cp_model.CpModel,
    works_day: WorksDay,
    req: SolveRequest,
    w: Weights = Weights(),
) -> list[tuple[cp_model.IntVar, int]]:
    """Soft penalty for employees who worked the previous month's last weekend
    and are also scheduled on the first weekend of the current period.

    Returns penalty terms: each employee who violates gets a W_WEEKEND_BOUNDARY
    penalty per weekend day worked, incentivizing the solver to keep them free
    but not making the problem infeasible if staffing requires it.
    """
    terms: list[tuple[cp_model.IntVar, int]] = []

    if not req.previousAssignments or not req.rules.alternatingWeekendsEnabled:
        return terms

    dates = dates_in_range(req.periodStart, req.periodEnd)
    if not dates:
        return terms

    # Find the first weekend in the current period
    first_weekend_days: list[str] = []
    for d in dates:
        if d.isoweekday() in (6, 7):
            first_weekend_days.append(d.isoformat())
            if d.isoweekday() == 7:
                break  # found Sat+Sun or just Sun
        elif first_weekend_days:
            break  # moved past the weekend

    if not first_weekend_days:
        return terms

    # Find the previous weekend (before period start)
    first_date = dates[0]
    prev_sat = None
    for offset in range(1, 8):
        d = first_date - timedelta(days=offset)
        if d.isoweekday() == 6:
            prev_sat = d
            break

    if prev_sat is None:
        return terms

    prev_sun = prev_sat + timedelta(days=1)
    prev_sat_iso = prev_sat.isoformat()
    prev_sun_iso = prev_sun.isoformat()

    # Build set of employees who worked previous weekend
    prev_worked: dict[str, set[str]] = {}
    for pa in req.previousAssignments:
        prev_worked.setdefault(pa.employeeId, set()).add(pa.date)

    for emp in req.employees:
        emp_dates = prev_worked.get(emp.id, set())
        if prev_sat_iso not in emp_dates and prev_sun_iso not in emp_dates:
            continue  # didn't work previous weekend

        # This employee worked the previous weekend — penalize working the first weekend
        for ds in first_weekend_days:
            key = (emp.id, ds)
            if key in works_day:
                terms.append((works_day[key], w.W_WEEKEND_BOUNDARY))

    return terms
