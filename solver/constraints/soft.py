"""Soft objective terms for the CP-SAT model.

All functions return lists of (variable, weight) tuples to be added to the
global minimization objective.  Positive weight = cost to minimize.
"""

from __future__ import annotations

from ortools.sat.python import cp_model

from models import SolveRequest
from utils import dates_in_range, iso_week_key

ShiftVar = dict[tuple[str, str, str], cp_model.IntVar]

SCALE = 100

# ── Weight hierarchy ──────────────────────────────────────────────────
# Tier 1 — Qualification coverage MUST outweigh staffing minimum so the
#          solver leaves a slot empty rather than filling it with an
#          unqualified person.
W_STAFFING_MIN = 50_000
W_QUALIFICATION = 500_000
# Tier 2 — Employee utilization & contractual obligations
W_MIN_UTIL = 30_000
W_WBL_BL = 60_000
# Tier 3 — Hours accuracy & distribution
W_SOLL_DEV = 100
W_OVERTIME = 200
W_UNDERCUT = 150
W_FAIRNESS = 50
# Tier 0 — Soll hard-delta bounds (nearly hard constraint)
W_SOLL_HARD = 200_000
# Tier 4 — Wishes & preferences
W_WISH_NORMAL = 3_000
W_WISH_STRONG = 6_000
W_PREFERENCE = 1


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
            terms.append((shortfall, W_STAFFING_MIN))
    return terms


def add_qualification_coverage_soft(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    station_assign: StationAssign | None = None,
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
                terms.append((shortfall, W_QUALIFICATION))
    return terms


def add_wbl_bl_soft(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
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
            terms.append((miss_bl, W_WBL_BL))
    return terms


def add_min_utilization_soft(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
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
        terms.append((shortfall, W_MIN_UTIL))

    return terms


def add_soll_deviation(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
) -> list[tuple[cp_model.IntVar, int]]:
    """Minimize |total_hours[e] - soll[e]| with tiered penalties.
    
    Within [sollMinDelta, sollMaxDelta]: normal W_SOLL_DEV weight.
    Outside that range: very heavy W_SOLL_HARD penalty per extra hour.
    """
    terms: list[tuple[cp_model.IntVar, int]] = []
    dates = dates_in_range(req.periodStart, req.periodEnd)
    soll_map = req.monthlySollHoursByEmployee or {}
    min_delta = req.rules.sollMinDelta
    max_delta = req.rules.sollMaxDelta

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
        total = model.NewIntVar(0, 744 * SCALE, f"total_{emp.id}")
        model.Add(total == sum(v * h for v, h in hour_vars))

        dev = model.NewIntVar(0, 744 * SCALE, f"dev_{emp.id}")
        model.Add(dev >= total - soll_scaled)
        model.Add(dev >= soll_scaled - total)
        terms.append((dev, W_SOLL_DEV))

        # Tier 0 heavy penalty: beyond allowed delta range
        upper_bound_scaled = int((soll + max_delta) * SCALE)
        lower_bound_scaled = int((soll + min_delta) * SCALE)

        over_excess = model.NewIntVar(0, 744 * SCALE, f"soll_over_{emp.id}")
        model.Add(over_excess >= total - upper_bound_scaled)
        terms.append((over_excess, W_SOLL_HARD))

        under_excess = model.NewIntVar(0, 744 * SCALE, f"soll_under_{emp.id}")
        model.Add(under_excess >= lower_bound_scaled - total)
        terms.append((under_excess, W_SOLL_HARD))

    return terms


def add_overtime_penalty(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
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
        terms.append((excess, W_OVERTIME))

    return terms


def add_undercut_penalty(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
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
        terms.append((under, W_UNDERCUT))

    return terms


def add_wish_fulfillment(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
) -> list[tuple[cp_model.IntVar, int]]:
    """Penalize unfulfilled wishes (higher weight for STRONG)."""
    terms: list[tuple[cp_model.IntVar, int]] = []

    for w in req.wishes:
        matching_vars: list[cp_model.IntVar] = []
        for p in req.shiftProfiles:
            if w.shiftProfileId and p.id != w.shiftProfileId:
                continue
            if w.shiftType and p.shiftType != w.shiftType:
                continue
            key = (w.employeeId, w.date, p.id)
            if key in shift:
                matching_vars.append(shift[key])

        if not matching_vars:
            continue

        fulfilled = model.NewBoolVar(f"wish_{w.id}")
        model.Add(sum(matching_vars) >= 1).OnlyEnforceIf(fulfilled)
        model.Add(sum(matching_vars) == 0).OnlyEnforceIf(fulfilled.Not())

        weight = W_WISH_STRONG if w.priority == "STRONG" else W_WISH_NORMAL
        miss = model.NewBoolVar(f"wish_miss_{w.id}")
        model.Add(miss == 1 - fulfilled)
        terms.append((miss, weight))

    return terms


def add_fairness(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
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
        terms.append((max_dev, W_FAIRNESS))

    return terms


def add_preference_bonus(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
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
                    terms.append((shift[key], W_PREFERENCE))

    return terms


W_DISTRIBUTION = 500


def add_shift_distribution_soft(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
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
            terms.append((dev, W_DISTRIBUTION))

    return terms
