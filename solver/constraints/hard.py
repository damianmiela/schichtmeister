"""Hard constraint builders for the CP-SAT model.

Each function adds constraints to the model and returns nothing.
Constraint IDs map 1:1 with the plan in 03-phase-02-hard-constraints.md.
"""

from __future__ import annotations

from datetime import date
from ortools.sat.python import cp_model

from models import SolveRequest, ShiftProfileInput
from utils import dates_in_range, iso_week_key, rest_violated


ShiftVar = dict[tuple[str, str, str], cp_model.IntVar]
WorksDay = dict[tuple[str, str], cp_model.IntVar]


def _profile_map(req: SolveRequest) -> dict[str, ShiftProfileInput]:
    return {p.id: p for p in req.shiftProfiles}


def _dates(req: SolveRequest) -> list[date]:
    return dates_in_range(req.periodStart, req.periodEnd)


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
    blocked_set: dict[str, set[str]] = {}
    for bd in req.blockedDates:
        blocked_set.setdefault(bd.employeeId, set()).add(bd.date)

    for emp in req.employees:
        unavail = set(emp.unavailableDates)
        unavail.update(blocked_set.get(emp.id, set()))
        for ds in unavail:
            for p in req.shiftProfiles:
                key = (emp.id, ds, p.id)
                if key in shift:
                    model.Add(shift[key] == 0)


# ── H6: Staffing minimum per shift type / station / day ────────────────────

def add_staffing_minimum(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
):
    profiles = _profile_map(req)
    dates = _dates(req)
    for sr in req.staffingRequirements:
        if sr.minTotalCount <= 0:
            continue
        for d in dates:
            ds = d.isoformat()
            covering: list[cp_model.IntVar] = []
            for emp in req.employees:
                for p in req.shiftProfiles:
                    if p.shiftType != sr.shiftType:
                        continue
                    if not sr.isFacilityWide:
                        if p.stationNumber is not None and p.stationNumber != sr.stationNumber:
                            continue
                    key = (emp.id, ds, p.id)
                    if key in shift:
                        covering.append(shift[key])
            if covering:
                model.Add(sum(covering) >= sr.minTotalCount)


# ── H7: Staffing maximum (modeled as hard for now) ─────────────────────────

def add_staffing_maximum(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
):
    dates = _dates(req)
    for sr in req.staffingRequirements:
        if sr.maxTotalCount is None:
            continue
        for d in dates:
            ds = d.isoformat()
            covering: list[cp_model.IntVar] = []
            for emp in req.employees:
                for p in req.shiftProfiles:
                    if p.shiftType != sr.shiftType:
                        continue
                    if not sr.isFacilityWide:
                        if p.stationNumber is not None and p.stationNumber != sr.stationNumber:
                            continue
                    key = (emp.id, ds, p.id)
                    if key in shift:
                        covering.append(shift[key])
            if covering:
                model.Add(sum(covering) <= sr.maxTotalCount)


# ── H8: Qualification coverage (OR-logic tags) ─────────────────────────────

def add_qualification_coverage(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
):
    dates = _dates(req)
    emp_tags: dict[str, set[str]] = {
        e.id: set(e.qualificationTags) for e in req.employees
    }
    for sr in req.staffingRequirements:
        for qr in sr.qualificationRequirements:
            tags = [t.strip() for t in ",".join(qr.tags).split(",")]
            if qr.minCount <= 0:
                continue
            for d in dates:
                ds = d.isoformat()
                qualified_vars: list[cp_model.IntVar] = []
                for emp in req.employees:
                    if not any(t in emp_tags.get(emp.id, set()) for t in tags):
                        continue
                    for p in req.shiftProfiles:
                        if p.shiftType != sr.shiftType:
                            continue
                        if not sr.isFacilityWide:
                            if p.stationNumber is not None and p.stationNumber != sr.stationNumber:
                                continue
                        key = (emp.id, ds, p.id)
                        if key in shift:
                            qualified_vars.append(shift[key])
                if qualified_vars:
                    model.Add(sum(qualified_vars) >= qr.minCount)


# ── H9: Min rest between shifts ────────────────────────────────────────────

def add_min_rest(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
):
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
        return

    for emp in req.employees:
        for i in range(len(dates) - 1):
            d1 = dates[i].isoformat()
            d2 = dates[i + 1].isoformat()
            for pid1, pid2 in incompatible:
                k1 = (emp.id, d1, pid1)
                k2 = (emp.id, d2, pid2)
                if k1 in shift and k2 in shift:
                    model.Add(shift[k1] + shift[k2] <= 1)


# ── H10: Max consecutive nights ────────────────────────────────────────────

def add_max_consecutive_nights(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
):
    max_nights = req.rules.maxConsecutiveNights
    dates = _dates(req)
    night_profiles = {p.id for p in req.shiftProfiles if p.shiftType == "NIGHT"}

    if not night_profiles:
        return

    for emp in req.employees:
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
            model.Add(sum(night_vars_by_day[i:i + window]) <= max_nights)


# ── H11: Max consecutive working days + required rest ──────────────────────

def add_max_consecutive_days(
    model: cp_model.CpModel,
    works_day: WorksDay,
    req: SolveRequest,
):
    max_days = req.rules.maxConsecutiveDays
    dates = _dates(req)

    for emp in req.employees:
        day_vars: list[cp_model.IntVar | int] = []
        for d in dates:
            ds = d.isoformat()
            if (emp.id, ds) in works_day:
                day_vars.append(works_day[(emp.id, ds)])
            else:
                day_vars.append(0)

        window = max_days + 1
        for i in range(len(day_vars) - window + 1):
            model.Add(sum(day_vars[i:i + window]) <= max_days)


# ── H12: WBL must have at least 1 BL per ISO week ──────────────────────────

def add_wbl_bl_weekly(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
):
    wbl_emps = [e for e in req.employees if e.isWbl]
    bl_profiles = {p.id for p in req.shiftProfiles if p.shiftType == "BL"}
    if not wbl_emps or not bl_profiles:
        return

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
                model.Add(sum(bl_vars) >= 1)


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


# ── H14: Manual placements (pre-gen shift wishes) ──────────────────────────

def add_manual_placements(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
):
    for mp in req.manualPlacements:
        key = (mp.employeeId, mp.date, mp.shiftProfileId)
        if key in shift:
            model.Add(shift[key] == 1)


# ── H15: Mini-job monthly hour cap ─────────────────────────────────────────

def add_mini_job_cap(
    model: cp_model.CpModel,
    shift: ShiftVar,
    req: SolveRequest,
):
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
        model.Add(
            sum(int(h * scale) * v for v, h in hour_terms) <= scaled_limit
        )
