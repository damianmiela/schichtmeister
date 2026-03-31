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
# Tier 1 — Staffing coverage: fill all required slots first
W_STAFFING_MIN = 50_000
W_QUALIFICATION = 40_000
# Tier 2 — Employee utilization & contractual obligations
W_MIN_UTIL = 30_000
W_WBL_BL = 60_000
# Tier 3 — Hours accuracy & distribution
W_SOLL_DEV = 100
W_OVERTIME = 200
W_UNDERCUT = 150
W_FAIRNESS = 50
# Tier 4 — Wishes & preferences
W_WISH_NORMAL = 3_000
W_WISH_STRONG = 6_000
W_PREFERENCE = 1


def _emp_station_map(req: SolveRequest) -> dict[str, set[int]]:
    return {e.id: set(e.assignedStations) if e.assignedStations else set() for e in req.employees}


def _emp_can_cover_station(emp_stations: set[int], station: int | None, is_fw: bool) -> bool:
    """Check if an employee can cover a staffing requirement's station."""
    if is_fw:
        return True
    if station is None:
        return True
    if not emp_stations:
        return True
    return station in emp_stations


def add_staffing_minimum_soft(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
) -> list[tuple[cp_model.IntVar, int]]:
    """Penalize understaffing — each missing person per day per requirement costs W_STAFFING_MIN."""
    terms: list[tuple[cp_model.IntVar, int]] = []
    dates = dates_in_range(req.periodStart, req.periodEnd)
    emp_stations = _emp_station_map(req)
    for sr in req.staffingRequirements:
        if sr.minTotalCount <= 0:
            continue
        for d in dates:
            ds = d.isoformat()
            covering: list[cp_model.IntVar] = []
            for emp in req.employees:
                if not _emp_can_cover_station(emp_stations[emp.id], sr.stationNumber, sr.isFacilityWide):
                    continue
                for p in req.shiftProfiles:
                    if p.shiftType != sr.shiftType:
                        continue
                    key = (emp.id, ds, p.id)
                    if key in shift:
                        covering.append(shift[key])
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
) -> list[tuple[cp_model.IntVar, int]]:
    """Penalize missing qualification coverage per day."""
    terms: list[tuple[cp_model.IntVar, int]] = []
    dates = dates_in_range(req.periodStart, req.periodEnd)
    emp_tags: dict[str, set[str]] = {
        e.id: set(e.qualificationTags) for e in req.employees
    }
    emp_stations = _emp_station_map(req)
    for sr in req.staffingRequirements:
        for qr in sr.qualificationRequirements:
            tags = [t.strip() for t in ",".join(qr.tags).split(",")]
            if qr.minCount <= 0:
                continue
            for d in dates:
                ds = d.isoformat()
                qualified_vars: list[cp_model.IntVar] = []
                for emp in req.employees:
                    if not _emp_can_cover_station(emp_stations[emp.id], sr.stationNumber, sr.isFacilityWide):
                        continue
                    if not any(t in emp_tags.get(emp.id, set()) for t in tags):
                        continue
                    for p in req.shiftProfiles:
                        if p.shiftType != sr.shiftType:
                            continue
                        key = (emp.id, ds, p.id)
                        if key in shift:
                            qualified_vars.append(shift[key])
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
    """Penalize WBL employees missing BL shifts (at least 1 per ISO week)."""
    terms: list[tuple[cp_model.IntVar, int]] = []
    wbl_emps = [e for e in req.employees if e.isWbl]
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
    """Minimize |total_hours[e] - soll[e]| for each employee."""
    terms: list[tuple[cp_model.IntVar, int]] = []
    dates = dates_in_range(req.periodStart, req.periodEnd)
    soll_map = req.monthlySollHoursByEmployee or {}

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
