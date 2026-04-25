"""Hard constraint builders for the CP-SAT model.

Most functions accept a ``relaxed`` flag. When ``relaxed=False`` (Phase 1
of the two-phase solve) they add hard constraints exactly as before. When
``relaxed=True`` (Phase 2, only used when Phase 1 returned INFEASIBLE) they
add the equivalent *soft* constraints with slack variables + large
objective penalties, so the solver can still produce a plan even if some
rules must be broken.

Functions that ALWAYS remain hard regardless of ``relaxed`` (because they
represent physical impossibility or planner-authoritative overrides):
    - add_one_shift_per_day (H1)
    - add_unavailability (H4 — absences)
    - add_manual_placements (H14)
    - add_station_assignment (H13b — helper)
Constraint IDs map 1:1 with the plan in 03-phase-02-hard-constraints.md.
"""

from __future__ import annotations

import logging
from ortools.sat.python import cp_model

from models import SolveRequest, ShiftProfileInput
from utils import dates_in_range, iso_week_key, rest_violated
# Relaxed-mode (Phase 2) penalty weights are defined in solver/config.py.
# Hard.py only uses these when re-solving an INFEASIBLE strict model with
# selected hard rules turned into very expensive soft rules.
from config import (
    W_RELAX_MIN_REST,
    W_RELAX_CONSEC_NIGHTS,
    W_RELAX_CONSEC_DAYS,
    W_RELAX_REST_AFTER_6,
    W_RELAX_STAFFING_MAX,
    W_RELAX_MINI_JOB_CAP,
    W_RELAX_ALT_WEEKENDS,
    W_RELAX_WBL_WEEKEND_LIMIT,
    W_RELAX_WBL_BL_MAX_PER_WEEK,
    W_RELAX_WBL_BL_WEEKLY_MIN,
)

log = logging.getLogger(__name__)


ShiftVar = dict[tuple[str, str, str], cp_model.IntVar]
WorksDay = dict[tuple[str, str], cp_model.IntVar]
StationAssign = dict[tuple[str, str, int], cp_model.IntVar]


def _profile_map(req: SolveRequest) -> dict[str, ShiftProfileInput]:
    return {p.id: p for p in req.shiftProfiles}


def _dates(req: SolveRequest) -> list[date]:
    return dates_in_range(req.periodStart, req.periodEnd)


def _emp_station_map(req: SolveRequest) -> dict[str, set[int]]:
    return {e.id: set(e.assignedStations) if e.assignedStations else set() for e in req.employees}



def _sh_emp_ids(req: SolveRequest) -> set[str]:
    """IDs of employees with SH (Stationshilfe) qualification.
    These employees are excluded from station coverage counting —
    they don't fill requirement slots or count toward station caps."""
    return {e.id for e in req.employees if "SH" in e.qualificationTags}


def _emp_can_cover_station(emp_stations: set[int], station: int | None, is_fw: bool) -> bool:
    if is_fw:
        return True
    if station is None:
        return True
    if not emp_stations:
        return True
    return station in emp_stations


# ── H1: At most one shift per employee per day ─────────────────────────────

def add_one_shift_per_day(
    model: cp_model.CpModel,
    shift: ShiftVar,
    works_day: WorksDay,
    req: SolveRequest,
):
    dates = _dates(req)
    for emp in req.employees:
        for d in dates:
            ds = d.isoformat()
            day_vars = [
                shift[(emp.id, ds, p.id)]
                for p in req.shiftProfiles
                if (emp.id, ds, p.id) in shift
            ]
            if day_vars:
                model.Add(sum(day_vars) <= 1)
                if (emp.id, ds) in works_day:
                    model.Add(works_day[(emp.id, ds)] == sum(day_vars))


# ── H4: Unavailability (absences + blocked dates) ──────────────────────────

def add_unavailability(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
):
    # Manual placements override unavailability — don't block those specific combos
    mp_forced: set[tuple[str, str, str]] = set()
    for mp in req.manualPlacements:
        mp_forced.add((mp.employeeId, mp.date, mp.shiftProfileId))

    blocked_set: dict[str, set[str]] = {}
    for bd in req.blockedDates:
        blocked_set.setdefault(bd.employeeId, set()).add(bd.date)

    for emp in req.employees:
        unavail = set(emp.unavailableDates)
        unavail.update(blocked_set.get(emp.id, set()))
        for ds in unavail:
            for p in req.shiftProfiles:
                key = (emp.id, ds, p.id)
                if key in shift and key not in mp_forced:
                    model.Add(shift[key] == 0)


# ── H6: Staffing minimum per shift type / station / day ────────────────────

def add_staffing_minimum(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
):
    dates = _dates(req)
    emp_st = _emp_station_map(req)
    for sr in req.staffingRequirements:
        if sr.minTotalCount <= 0:
            continue
        for d in dates:
            ds = d.isoformat()
            covering: list[cp_model.IntVar] = []
            for emp in req.employees:
                if not _emp_can_cover_station(emp_st[emp.id], sr.stationNumber, sr.isFacilityWide):
                    continue
                for p in req.shiftProfiles:
                    if p.shiftType != sr.shiftType:
                        continue
                    key = (emp.id, ds, p.id)
                    if key in shift:
                        covering.append(shift[key])
            if covering:
                model.Add(sum(covering) >= sr.minTotalCount)


# ── H7: Staffing maximum ───────────────────────────────────────────────────
#
# Station-specific max constraints only count employees explicitly assigned to
# that station.  Floaters (no assigned stations) are excluded to avoid the
# "double-counting" problem where one floater simultaneously consumes capacity
# on every station.  Instead, an aggregate per-shift-type max (sum of all
# station maxes) limits the total headcount including floaters.

def add_staffing_maximum(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    station_assign: StationAssign | None = None,
    relaxed: bool = False,
) -> list[tuple[cp_model.IntVar, int]]:
    terms: list[tuple[cp_model.IntVar, int]] = []
    dates = _dates(req)
    emp_stations = _emp_station_map(req)

    # Per-station caps: only employees explicitly assigned to that station
    # BL profiles are excluded — BL workers don't fill station positions
    # SH employees are excluded — they don't count toward station caps
    # Multi-station employees: only count if station_assign says they're at this station
    bl_profile_ids = {p.id for p in req.shiftProfiles if p.shiftType == "BL"}
    sh_employees = _sh_emp_ids(req)

    works_type_cache: dict[tuple[str, str, str], cp_model.IntVar] = {}

    for sr in req.staffingRequirements:
        if sr.maxTotalCount is None:
            continue
        for d in dates:
            ds = d.isoformat()
            covering: list[cp_model.IntVar] = []
            for emp in req.employees:
                if emp.id in sh_employees:
                    continue  # SH don't count toward station caps
                es = emp_stations[emp.id]

                if sr.isFacilityWide:
                    # FW: everyone counts directly
                    for p in req.shiftProfiles:
                        if p.shiftType != sr.shiftType or p.id in bl_profile_ids:
                            continue
                        key = (emp.id, ds, p.id)
                        if key in shift:
                            covering.append(shift[key])
                    continue

                # Station-specific: skip employees not eligible for this station
                if len(es) == 1 and sr.stationNumber is not None and sr.stationNumber not in es:
                    continue
                if len(es) > 1 and sr.stationNumber is not None and sr.stationNumber not in es:
                    continue

                # Collect shift vars for matching type
                emp_shift_vars: list[cp_model.IntVar] = []
                for p in req.shiftProfiles:
                    if p.shiftType != sr.shiftType or p.id in bl_profile_ids:
                        continue
                    key = (emp.id, ds, p.id)
                    if key in shift:
                        emp_shift_vars.append(shift[key])

                if not emp_shift_vars:
                    continue

                if len(es) == 1:
                    # Single-station: count directly
                    covering.extend(emp_shift_vars)
                elif sr.stationNumber is not None and station_assign:
                    # Multi-station OR floater: use station_assign
                    sa_key = (emp.id, ds, sr.stationNumber)
                    if sa_key in station_assign:
                        wt_key = (emp.id, ds, sr.shiftType)
                        if wt_key not in works_type_cache:
                            wt = model.NewBoolVar(f"mx_wt_{emp.id}_{ds}_{sr.shiftType}")
                            model.Add(sum(emp_shift_vars) >= 1).OnlyEnforceIf(wt)
                            model.Add(sum(emp_shift_vars) == 0).OnlyEnforceIf(wt.Not())
                            works_type_cache[wt_key] = wt
                        wt_var = works_type_cache[wt_key]
                        both = model.NewBoolVar(f"mx_cov_{emp.id}_{ds}_{sr.shiftType}_{sr.stationNumber}")
                        model.AddBoolAnd([wt_var, station_assign[sa_key]]).OnlyEnforceIf(both)
                        model.AddBoolOr([wt_var.Not(), station_assign[sa_key].Not()]).OnlyEnforceIf(both.Not())
                        covering.append(both)
                else:
                    # Fallback: count directly (conservative)
                    covering.extend(emp_shift_vars)

            if covering:
                if relaxed:
                    total = model.NewIntVar(0, len(covering), f"smax_tot_{sr.shiftType}_{sr.stationNumber}_{ds}")
                    model.Add(total == sum(covering))
                    over = model.NewIntVar(0, len(covering), f"smax_over_{sr.shiftType}_{sr.stationNumber}_{ds}")
                    model.Add(over >= total - sr.maxTotalCount)
                    terms.append((over, W_RELAX_STAFFING_MAX))
                else:
                    model.Add(sum(covering) <= sr.maxTotalCount)

    # Aggregate per-shift-type cap: sum of station maxes, counting everyone
    type_agg_max: dict[str, int] = {}
    for sr in req.staffingRequirements:
        if sr.maxTotalCount is None or sr.isFacilityWide:
            continue
        type_agg_max[sr.shiftType] = type_agg_max.get(sr.shiftType, 0) + sr.maxTotalCount

    for stype, agg_max in type_agg_max.items():
        for d in dates:
            ds = d.isoformat()
            all_vars: list[cp_model.IntVar] = []
            for emp in req.employees:
                if emp.id in sh_employees:
                    continue  # SH excluded from aggregate cap
                for p in req.shiftProfiles:
                    if p.shiftType != stype:
                        continue
                    if p.id in bl_profile_ids:
                        continue
                    key = (emp.id, ds, p.id)
                    if key in shift:
                        all_vars.append(shift[key])
            if all_vars:
                if relaxed:
                    total = model.NewIntVar(0, len(all_vars), f"smax_agg_tot_{stype}_{ds}")
                    model.Add(total == sum(all_vars))
                    over = model.NewIntVar(0, len(all_vars), f"smax_agg_over_{stype}_{ds}")
                    model.Add(over >= total - agg_max)
                    terms.append((over, W_RELAX_STAFFING_MAX))
                else:
                    model.Add(sum(all_vars) <= agg_max)

    return terms


# ── H8: Qualification coverage (OR-logic tags) ─────────────────────────────

def add_qualification_coverage(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    station_assign: StationAssign | None = None,
):
    """Hard qualification coverage: if enough qualified employees are available
    on a given day, enforce the qualification minimum.  Otherwise skip the day
    (the soft constraint still penalizes the gap, but we don't force the model
    to be infeasible).

    Uses station_assign for multi-station employees to avoid double-counting.
    BL profiles are excluded — BL workers don't fill patient-care positions.
    SH employees are excluded — they don't fill qualification requirement slots.
    """
    dates = _dates(req)
    emp_tags: dict[str, set[str]] = {
        e.id: set(e.qualificationTags) for e in req.employees
    }
    emp_st = _emp_station_map(req)
    bl_profile_ids = {p.id for p in req.shiftProfiles if p.shiftType == "BL"}
    sh_employees = _sh_emp_ids(req)

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

                    es = emp_st[emp.id]

                    # Collect shift vars for matching type (excluding BL)
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
                                wt = model.NewBoolVar(f"hq_wt_{emp.id}_{ds}_{sr.shiftType}")
                                model.Add(sum(emp_shift_vars) >= 1).OnlyEnforceIf(wt)
                                model.Add(sum(emp_shift_vars) == 0).OnlyEnforceIf(wt.Not())
                                works_type_cache[wt_key] = wt
                            wt_var = works_type_cache[wt_key]
                            both = model.NewBoolVar(
                                f"hq_cov_{emp.id}_{ds}_{sr.shiftType}_{sr.stationNumber}")
                            model.AddBoolAnd([wt_var, station_assign[sa_key]]).OnlyEnforceIf(both)
                            model.AddBoolOr([wt_var.Not(), station_assign[sa_key].Not()]).OnlyEnforceIf(both.Not())
                            qualified_vars.append(both)

                # Only enforce if theoretically satisfiable (enough vars exist)
                if len(qualified_vars) >= qr.minCount:
                    model.Add(sum(qualified_vars) >= qr.minCount)

                # Enforce maxCount (hard upper bound on qualified employees)
                if qr.maxCount is not None and qr.maxCount > 0 and qualified_vars:
                    model.Add(sum(qualified_vars) <= qr.maxCount)


# ── H9: Min rest between shifts ────────────────────────────────────────────

def add_min_rest(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    relaxed: bool = False,
) -> list[tuple[cp_model.IntVar, int]]:
    terms: list[tuple[cp_model.IntVar, int]] = []
    dates = _dates(req)
    profiles = _profile_map(req)
    min_rest_h = req.rules.minRestHours

    incompatible: list[tuple[str, str]] = []
    active_profiles = [p for p in req.shiftProfiles if p.isActive]
    for p1 in active_profiles:
        for p2 in active_profiles:
            if rest_violated(p1.endTime, p1.startTime, p2.endTime, p2.startTime, min_rest_h):
                incompatible.append((p1.id, p2.id))

    if not incompatible:
        return terms

    for emp in req.employees:
        # Standard within-period rest check
        for i in range(len(dates) - 1):
            d1 = dates[i].isoformat()
            d2 = dates[i + 1].isoformat()
            for pid1, pid2 in incompatible:
                k1 = (emp.id, d1, pid1)
                k2 = (emp.id, d2, pid2)
                if k1 in shift and k2 in shift:
                    if relaxed:
                        v = model.NewBoolVar(f"rest_v_{emp.id}_{d1}_{pid1}_{d2}_{pid2}")
                        model.Add(shift[k1] + shift[k2] <= 1 + v)
                        terms.append((v, W_RELAX_MIN_REST))
                    else:
                        model.Add(shift[k1] + shift[k2] <= 1)

    # NOTE: Cross-month boundary rest checks are handled by TypeScript
    # validation (warns about violations). Not enforced as hard solver
    # constraints because combined with staffing minimums they can make
    # the problem infeasible.
    return terms


# ── H10: Max consecutive nights ────────────────────────────────────────────

def add_max_consecutive_nights(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    relaxed: bool = False,
) -> list[tuple[cp_model.IntVar, int]]:
    terms: list[tuple[cp_model.IntVar, int]] = []
    max_nights = req.rules.maxConsecutiveNights
    dates = _dates(req)
    night_profiles = {p.id for p in req.shiftProfiles if p.shiftType == "NIGHT"}

    if not night_profiles:
        return terms

    for emp in req.employees:
        # NOTE: Cross-month boundary night checks are handled by TypeScript
        # validation (warns about violations). Not prepended here because
        # combined with staffing minimums they can make the problem infeasible.
        night_vars_by_day: list[cp_model.IntVar | int] = []
        for d in dates:
            ds = d.isoformat()
            day_night = [
                shift[(emp.id, ds, pid)]
                for pid in night_profiles
                if (emp.id, ds, pid) in shift
            ]
            if day_night:
                night_vars_by_day.append(sum(day_night))
            else:
                night_vars_by_day.append(0)

        window = max_nights + 1
        for i in range(len(night_vars_by_day) - window + 1):
            if relaxed:
                slack = model.NewIntVar(0, window, f"cn_slack_{emp.id}_{i}")
                model.Add(sum(night_vars_by_day[i:i + window]) <= max_nights + slack)
                terms.append((slack, W_RELAX_CONSEC_NIGHTS))
            else:
                model.Add(sum(night_vars_by_day[i:i + window]) <= max_nights)

    return terms


# ── H11: Max consecutive working days + required rest ──────────────────────

def add_max_consecutive_days(
    model: cp_model.CpModel,
    works_day: WorksDay,
    req: SolveRequest,
    relaxed: bool = False,
) -> list[tuple[cp_model.IntVar, int]]:
    terms: list[tuple[cp_model.IntVar, int]] = []
    global_max_days = req.rules.maxConsecutiveDays
    rest_after_6 = req.rules.requiredRestDaysAfter6
    dates = _dates(req)

    for emp in req.employees:
        # Per-employee override takes precedence over global setting
        max_days = emp.maxConsecutiveDays if emp.maxConsecutiveDays is not None else global_max_days

        # NOTE: Cross-month boundary day checks are handled by TypeScript
        # validation (warns about violations). Not prepended here because
        # combined with staffing minimums they can make the problem infeasible.
        day_vars: list[cp_model.IntVar | int] = []
        for d in dates:
            ds = d.isoformat()
            if (emp.id, ds) in works_day:
                day_vars.append(works_day[(emp.id, ds)])
            else:
                day_vars.append(0)

        # No more than max_days in a window of max_days+1
        window = max_days + 1
        for i in range(len(day_vars) - window + 1):
            if relaxed:
                slack = model.NewIntVar(0, window, f"cd_slack_{emp.id}_{i}")
                model.Add(sum(day_vars[i:i + window]) <= max_days + slack)
                terms.append((slack, W_RELAX_CONSEC_DAYS))
            else:
                model.Add(sum(day_vars[i:i + window]) <= max_days)

        # After 6+ consecutive days: require rest_after_6 days off
        if rest_after_6 > 0 and len(day_vars) >= 8:
            for i in range(len(day_vars) - 7):
                streak_6 = model.NewBoolVar(f"streak6_{emp.id}_{i}")
                model.Add(sum(day_vars[i:i + 6]) >= 6).OnlyEnforceIf(streak_6)
                model.Add(sum(day_vars[i:i + 6]) <= 5).OnlyEnforceIf(streak_6.Not())
                for off in range(rest_after_6):
                    idx = i + 6 + off
                    if idx < len(day_vars):
                        if relaxed:
                            v = model.NewBoolVar(f"r6_v_{emp.id}_{i}_{off}")
                            # Soft: violated if streak_6 AND day_vars[idx]>0; use implication
                            # day_vars[idx] <= v when streak_6 enforced
                            model.Add(day_vars[idx] <= v).OnlyEnforceIf(streak_6)
                            terms.append((v, W_RELAX_REST_AFTER_6))
                        else:
                            model.Add(day_vars[idx] == 0).OnlyEnforceIf(streak_6)

    return terms


# ── H12: WBL gets at most 1 BL per ISO week ─────────────────────────────────

def add_wbl_bl_max_one_per_week(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    relaxed: bool = False,
) -> list[tuple[cp_model.IntVar, int]]:
    """Each WBL employee gets at most 1 BL shift per ISO week (skip full-time BL)."""
    terms: list[tuple[cp_model.IntVar, int]] = []
    wbl_emps = [e for e in req.employees if e.isWbl and not e.isFullTimeBl]
    bl_profiles = {p.id for p in req.shiftProfiles if p.shiftType == "BL"}
    if not wbl_emps or not bl_profiles:
        return terms

    dates = _dates(req)
    weeks: dict[str, list[date]] = {}
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
            if bl_vars:
                if relaxed:
                    slack = model.NewIntVar(0, len(bl_vars), f"wblmax_{emp.id}_{wk}")
                    model.Add(sum(bl_vars) <= 1 + slack)
                    terms.append((slack, W_RELAX_WBL_BL_MAX_PER_WEEK))
                else:
                    model.Add(sum(bl_vars) <= 1)

    return terms


# ── (legacy) WBL must have at least 1 BL per ISO week ──────────────────────

def add_wbl_bl_weekly(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    relaxed: bool = False,
) -> list[tuple[cp_model.IntVar, int]]:
    terms: list[tuple[cp_model.IntVar, int]] = []
    wbl_emps = [e for e in req.employees if e.isWbl]
    bl_profiles = {p.id for p in req.shiftProfiles if p.shiftType == "BL"}
    if not wbl_emps or not bl_profiles:
        return terms

    dates = _dates(req)
    weeks: dict[str, list[date]] = {}
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
            if bl_vars:
                if relaxed:
                    short = model.NewBoolVar(f"wblmin_{emp.id}_{wk}")
                    model.Add(sum(bl_vars) + short >= 1)
                    terms.append((short, W_RELAX_WBL_BL_WEEKLY_MIN))
                else:
                    model.Add(sum(bl_vars) >= 1)

    return terms


# ── H13: WBL BL shifts on distinct days within a week ──────────────────────

def add_wbl_bl_spread(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
):
    wbl_emps = [e for e in req.employees if e.isWbl]
    bl_profiles = {p.id for p in req.shiftProfiles if p.shiftType == "BL"}
    if len(wbl_emps) < 2 or not bl_profiles:
        return

    dates = _dates(req)
    weeks: dict[str, list[date]] = {}
    for d in dates:
        wk = iso_week_key(d)
        weeks.setdefault(wk, []).append(d)

    for wk, wk_dates in weeks.items():
        for d in wk_dates:
            ds = d.isoformat()
            day_bl_vars = []
            for emp in wbl_emps:
                for pid in bl_profiles:
                    key = (emp.id, ds, pid)
                    if key in shift:
                        day_bl_vars.append(shift[key])
            if len(day_bl_vars) > 1:
                model.Add(sum(day_bl_vars) <= 1)


# ── H13b: Station assignment for multi-station employees ──────────────────

StationAssign = dict[tuple[str, str, int], cp_model.IntVar]


def add_station_assignment(
    model: cp_model.CpModel,
    shift: ShiftVar,
    works_day: WorksDay,
    station_assign: StationAssign,
    req: SolveRequest,
):
    """Multi-station employees and floaters must be assigned to exactly one
    station per working day.

    If an employee works a non-BL shift on a given day, exactly one of their
    station_assign variables must be 1.  If they don't work (or work BL only),
    all station_assign variables must be 0.

    Single-station employees are excluded (they are always at their station).
    """
    bl_profile_ids = {p.id for p in req.shiftProfiles if p.shiftType == "BL"}
    dates = _dates(req)

    # Collect all demand stations for floaters
    all_demand_stations: set[int] = set()
    for sr in req.staffingRequirements:
        if sr.stationNumber is not None and not sr.isFacilityWide:
            all_demand_stations.add(sr.stationNumber)

    for emp in req.employees:
        stations = set(emp.assignedStations) if emp.assignedStations else set()
        if len(stations) == 1:
            continue  # single-station: always at their station

        # Multi-station: their stations; Floater: all demand stations
        assign_stations = stations if stations else all_demand_stations

        for d in dates:
            ds = d.isoformat()
            sa_vars = [station_assign[(emp.id, ds, s)]
                       for s in assign_stations
                       if (emp.id, ds, s) in station_assign]
            if not sa_vars:
                continue

            # Collect non-BL shift variables for this emp+day
            non_bl_vars = [shift[(emp.id, ds, p.id)]
                           for p in req.shiftProfiles
                           if p.id not in bl_profile_ids
                           and (emp.id, ds, p.id) in shift]

            if non_bl_vars:
                works_non_bl = model.NewBoolVar(f"wnbl_{emp.id}_{ds}")
                model.Add(sum(non_bl_vars) >= 1).OnlyEnforceIf(works_non_bl)
                model.Add(sum(non_bl_vars) == 0).OnlyEnforceIf(works_non_bl.Not())

                # Working non-BL → pick exactly one station
                model.Add(sum(sa_vars) == 1).OnlyEnforceIf(works_non_bl)
                model.Add(sum(sa_vars) == 0).OnlyEnforceIf(works_non_bl.Not())
            else:
                # No non-BL shift vars exist → no station assignment
                for sa in sa_vars:
                    model.Add(sa == 0)


# ── H14: Manual placements (pre-gen shift wishes) ──────────────────────────

def add_manual_placements(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    station_assign: StationAssign | None = None,
):
    """Lock manual placement shifts AND their station assignment.

    The shift variable is forced to 1.  If the manual placement also
    specifies a stationNumber *and* the employee has station_assign vars
    (multi-station / floater), lock that station variable to 1 so the
    solver doesn't freely reassign the station during optimization.
    """
    prof_map = {p.id: p for p in req.shiftProfiles}
    for mp in req.manualPlacements:
        prof = prof_map.get(mp.shiftProfileId)
        prof_name = prof.name if prof else "?"
        key = (mp.employeeId, mp.date, mp.shiftProfileId)
        if key in shift:
            model.Add(shift[key] == 1)
            log.info("H14 ManualPlacement LOCKED: emp=%s date=%s profile=%s (%s) station=%s",
                      mp.employeeId[:8], mp.date, mp.shiftProfileId[:8], prof_name, mp.stationNumber)
        else:
            # Find what profiles DO exist for this employee+date
            available = [
                (pid, prof_map[pid].name if pid in prof_map else "?")
                for (eid, ds, pid) in shift
                if eid == mp.employeeId and ds == mp.date
            ]
            log.warning("H14 ManualPlacement SKIPPED (no variable): emp=%s date=%s profile=%s (%s) station=%s. "
                        "Available profiles for this emp+date: %s",
                        mp.employeeId[:8], mp.date, mp.shiftProfileId[:8], prof_name, mp.stationNumber,
                        available)

        # Also lock station if specified and vars exist
        if station_assign and mp.stationNumber is not None:
            sa_key = (mp.employeeId, mp.date, mp.stationNumber)
            if sa_key in station_assign:
                model.Add(station_assign[sa_key] == 1)
                log.info("H14 ManualPlacement station LOCKED: emp=%s date=%s station=%d",
                          mp.employeeId[:8], mp.date, mp.stationNumber)
            else:
                log.info("H14 ManualPlacement station not in solver vars (single-station emp, will be set post-solve): "
                         "emp=%s date=%s station=%d",
                          mp.employeeId[:8], mp.date, mp.stationNumber)


# ── H15: Mini-job monthly hour cap ─────────────────────────────────────────

def add_mini_job_cap(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
    relaxed: bool = False,
) -> list[tuple[cp_model.IntVar, int]]:
    terms: list[tuple[cp_model.IntVar, int]] = []
    profiles = _profile_map(req)
    for emp in req.employees:
        if emp.contractType != "MINI_JOB":
            continue
        limit = emp.miniJobMaxMonthlyHours
        if limit is None:
            continue

        hour_terms: list[tuple[cp_model.IntVar, float]] = []
        for p in req.shiftProfiles:
            for d in _dates(req):
                key = (emp.id, d.isoformat(), p.id)
                if key in shift:
                    hour_terms.append((shift[key], p.paidHours))

        if not hour_terms:
            continue

        scale = 100
        scaled_limit = int(limit * scale)
        total_scaled = sum(int(h * scale) * v for v, h in hour_terms)

        if relaxed:
            # Slack in scaled minutes — bound by rough upper (all shifts taken)
            max_possible = sum(int(h * scale) for _, h in hour_terms)
            slack = model.NewIntVar(0, max(max_possible, 1), f"mini_over_{emp.id}")
            model.Add(total_scaled <= scaled_limit + slack)
            # Dividing weight to approximately penalize per-hour-over rather
            # than per scaled-unit-over. Keep it simple: per scaled-unit.
            terms.append((slack, W_RELAX_MINI_JOB_CAP))
        else:
            model.Add(total_scaled <= scaled_limit)

    return terms


# ── H16: Alternating weekends (every other weekend free) ─────────────────

def add_alternating_weekends(
    model: cp_model.CpModel,
    works_day: WorksDay,
    req: SolveRequest,
    relaxed: bool = False,
) -> list[tuple[cp_model.IntVar, int]]:
    terms: list[tuple[cp_model.IntVar, int]] = []
    if not req.rules.alternatingWeekendsEnabled:
        return terms

    dates = _dates(req)
    weekends: list[tuple[date | None, date | None]] = []
    i = 0
    while i < len(dates):
        d = dates[i]
        if d.isoweekday() == 6:
            sat = d
            sun = dates[i + 1] if i + 1 < len(dates) and dates[i + 1].isoweekday() == 7 else None
            weekends.append((sat, sun))
            i += 2 if sun else 1
        elif d.isoweekday() == 7:
            weekends.append((None, d))
            i += 1
        else:
            i += 1

    if not weekends:
        return terms

    # NOTE: Cross-month boundary weekend checks are handled by TypeScript
    # validation (warns about violations). Not enforced as hard solver
    # constraints because forcing many employees free on the first weekend
    # can conflict with staffing minimums and make the problem infeasible.

    # Standard alternating weekends within the period
    for emp in req.employees:
        if len(weekends) < 2:
            continue

        for wi in range(len(weekends) - 1):
            sat_k, sun_k = weekends[wi]
            sat_next, sun_next = weekends[wi + 1]

            wk_vars = []
            if sat_k:
                key = (emp.id, sat_k.isoformat())
                if key in works_day:
                    wk_vars.append(works_day[key])
            if sun_k:
                key = (emp.id, sun_k.isoformat())
                if key in works_day:
                    wk_vars.append(works_day[key])

            if not wk_vars:
                continue

            works_wk = model.NewBoolVar(f"wknd_{emp.id}_{wi}")
            model.AddMaxEquality(works_wk, wk_vars)

            for next_key_date in (sat_next, sun_next):
                if not next_key_date:
                    continue
                key = (emp.id, next_key_date.isoformat())
                if key not in works_day:
                    continue
                if relaxed:
                    v = model.NewBoolVar(f"altwknd_v_{emp.id}_{wi}_{next_key_date.isoformat()}")
                    # works_wk AND works_day[key] implies v
                    # Encode: works_day[key] <= v when works_wk
                    model.Add(works_day[key] <= v).OnlyEnforceIf(works_wk)
                    terms.append((v, W_RELAX_ALT_WEEKENDS))
                else:
                    model.Add(works_day[key] == 0).OnlyEnforceIf(works_wk)

    return terms


# ── H17: WBL max weekend-days per month ──────────────────────────────────

def add_wbl_weekend_limit(
    model: cp_model.CpModel,
    works_day: WorksDay,
    req: SolveRequest,
    relaxed: bool = False,
) -> list[tuple[cp_model.IntVar, int]]:
    terms: list[tuple[cp_model.IntVar, int]] = []
    max_wd = req.rules.wblMaxWeekendDays
    if max_wd <= 0:
        return terms

    dates = _dates(req)
    weekend_dates = [d for d in dates if d.isoweekday() in (6, 7)]
    if not weekend_dates:
        return terms

    for emp in [e for e in req.employees if e.isWbl]:
        wknd_vars = []
        for d in weekend_dates:
            key = (emp.id, d.isoformat())
            if key in works_day:
                wknd_vars.append(works_day[key])
        if wknd_vars:
            if relaxed:
                slack = model.NewIntVar(0, len(wknd_vars), f"wblwke_{emp.id}")
                model.Add(sum(wknd_vars) <= max_wd + slack)
                terms.append((slack, W_RELAX_WBL_WEEKEND_LIMIT))
            else:
                model.Add(sum(wknd_vars) <= max_wd)

    return terms
