"""CP-SAT solver engine — builds the model, adds constraints, solves, returns results."""

from __future__ import annotations

import logging
import time
from datetime import date

from ortools.sat.python import cp_model

log = logging.getLogger(__name__)

from models import (
    SolveRequest, SolveResponse, AssignmentOutput,
    ModelStats, Diagnostics, SollDelta,
)
from utils import dates_in_range, paid_hours
from constraints.hard import (
    add_one_shift_per_day,
    add_unavailability,
    add_staffing_maximum,
    add_min_rest,
    add_max_consecutive_nights,
    add_max_consecutive_days,
    add_manual_placements,
    add_mini_job_cap,
    add_wbl_bl_max_one_per_week,
    add_alternating_weekends,
    add_wbl_weekend_limit,
)
from constraints.soft import (
    add_staffing_minimum_soft,
    add_qualification_coverage_soft,
    add_wbl_bl_soft,
    add_min_utilization_soft,
    add_soll_deviation,
    add_overtime_penalty,
    add_undercut_penalty,
    add_wish_fulfillment,
    add_fairness,
    add_preference_bonus,
    add_shift_distribution_soft,
)


def _build_variables(
    model: cp_model.CpModel,
    req: SolveRequest,
) -> tuple[
    dict[tuple[str, str, str], cp_model.IntVar],
    dict[tuple[str, str], cp_model.IntVar],
]:
    """Create boolean variables for shift assignments and works_day indicators.

    Variable reduction: skip (employee, date, profile) combos that are
    impossible by construction (wrong station, not in allowed profiles, inactive,
    BL for non-WBL employees).
    """
    dates = dates_in_range(req.periodStart, req.periodEnd)
    active_profiles = [p for p in req.shiftProfiles if p.isActive]

    emp_allowed: dict[str, set[str]] = {}
    emp_stations: dict[str, set[int]] = {}
    emp_unavail: dict[str, set[str]] = {}
    emp_is_wbl: dict[str, bool] = {}
    for e in req.employees:
        emp_allowed[e.id] = set(e.allowedShiftProfileIds) if e.allowedShiftProfileIds else set()
        emp_stations[e.id] = set(e.assignedStations) if e.assignedStations else set()
        emp_unavail[e.id] = set(e.unavailableDates)
        emp_is_wbl[e.id] = e.isWbl

    blocked_dates: dict[str, set[str]] = {}
    for bd in req.blockedDates:
        blocked_dates.setdefault(bd.employeeId, set()).add(bd.date)

    shift: dict[tuple[str, str, str], cp_model.IntVar] = {}
    works_day: dict[tuple[str, str], cp_model.IntVar] = {}

    for emp in req.employees:
        allowed = emp_allowed[emp.id]
        stations = emp_stations[emp.id]
        unavail = emp_unavail[emp.id] | blocked_dates.get(emp.id, set())
        is_wbl = emp_is_wbl[emp.id]

        for d in dates:
            ds = d.isoformat()
            if ds in unavail:
                continue

            day_has_var = False
            for p in active_profiles:
                if allowed and p.id not in allowed:
                    continue
                # BL profiles: only WBL employees, unless isFullTimeBl
                if p.shiftType == "BL" and not is_wbl and not emp.isFullTimeBl:
                    continue
                var = model.NewBoolVar(f"s_{emp.id}_{ds}_{p.id}")
                shift[(emp.id, ds, p.id)] = var
                day_has_var = True

            if day_has_var:
                works_day[(emp.id, ds)] = model.NewBoolVar(f"wd_{emp.id}_{ds}")

    return shift, works_day


def solve(request: SolveRequest) -> SolveResponse:
    """Build model, add all constraints and objectives, solve, return results."""
    wall_start = time.perf_counter()

    model = cp_model.CpModel()
    shift, works_day = _build_variables(model, request)

    log.info("Model: %d shift vars, %d works_day vars, %d employees, %d profiles, %d dates",
             len(shift), len(works_day), len(request.employees), len(request.shiftProfiles),
             len(dates_in_range(request.periodStart, request.periodEnd)))

    if not shift:
        return SolveResponse(
            status="INFEASIBLE",
            solveTimeMs=0,
            reason="Keine gültigen Zuweisungsmöglichkeiten (keine Variablen erstellt).",
        )

    # ── Hard constraints (physically impossible to violate) ─────────────
    add_one_shift_per_day(model, shift, works_day, request)
    add_unavailability(model, shift, request)
    add_staffing_maximum(model, shift, request)
    add_min_rest(model, shift, request)
    add_max_consecutive_nights(model, shift, request)
    add_max_consecutive_days(model, works_day, request)
    add_manual_placements(model, shift, request)
    add_mini_job_cap(model, shift, request)
    add_wbl_bl_max_one_per_week(model, shift, request)
    add_alternating_weekends(model, works_day, request)
    add_wbl_weekend_limit(model, works_day, request)

    # ── Soft objectives (penalized, but relaxable) ───────────────────
    objective_terms: list[tuple[cp_model.IntVar, int]] = []
    objective_terms.extend(add_staffing_minimum_soft(model, shift, request))
    objective_terms.extend(add_qualification_coverage_soft(model, shift, request))
    objective_terms.extend(add_wbl_bl_soft(model, shift, request))
    objective_terms.extend(add_min_utilization_soft(model, shift, request))
    objective_terms.extend(add_soll_deviation(model, shift, request))
    objective_terms.extend(add_overtime_penalty(model, shift, request))
    objective_terms.extend(add_undercut_penalty(model, shift, request))
    objective_terms.extend(add_wish_fulfillment(model, shift, request))
    objective_terms.extend(add_fairness(model, shift, request))
    objective_terms.extend(add_preference_bonus(model, shift, request))
    objective_terms.extend(add_shift_distribution_soft(model, shift, request))

    if objective_terms:
        model.Minimize(sum(var * weight for var, weight in objective_terms))

    # ── Solve ───────────────────────────────────────────────────────────
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = request.maxSolveTimeSeconds
    solver.parameters.num_workers = 4

    log.info("Solving with %d objective terms, max_time=%ds...",
             len(objective_terms), request.maxSolveTimeSeconds)
    status_code = solver.Solve(model)
    wall_ms = (time.perf_counter() - wall_start) * 1000
    log.info("Solve done: status=%s, wall=%.1fms, objective=%.0f, bound=%.0f, gap=%.3f",
             status_code, wall_ms,
             solver.ObjectiveValue() if status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0,
             solver.BestObjectiveBound() if status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0,
             solver.BestObjectiveBound() / max(solver.ObjectiveValue(), 1e-9)
             if status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE) and solver.ObjectiveValue() > 0 else 0)

    status_map = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "INFEASIBLE",
    }
    status_str = status_map.get(status_code, "UNKNOWN")

    if status_str in ("INFEASIBLE", "UNKNOWN"):
        return SolveResponse(
            status=status_str,
            solveTimeMs=round(wall_ms, 1),
            reason="Keine zulässige Lösung gefunden. Prüfen Sie Personalbesetzung und Regeln.",
        )

    # ── Extract assignments ─────────────────────────────────────────────
    assignments: list[AssignmentOutput] = []
    for (emp_id, ds, pid), var in shift.items():
        if solver.Value(var) == 1:
            assignments.append(AssignmentOutput(
                employeeId=emp_id, date=ds, shiftProfileId=pid,
            ))

    log.info("Extracted %d assignments for %d employees",
             len(assignments), len({a.employeeId for a in assignments}))

    # ── Diagnostics ─────────────────────────────────────────────────────
    profile_hours = {p.id: p.paidHours for p in request.shiftProfiles}
    soll_map = request.monthlySollHoursByEmployee or {}
    wd = request.monthlyWorkingDays or 22

    emp_actual: dict[str, float] = {}
    for a in assignments:
        emp_actual[a.employeeId] = emp_actual.get(a.employeeId, 0) + profile_hours.get(a.shiftProfileId, 0)

    soll_deviation: dict[str, SollDelta] = {}
    for emp in request.employees:
        soll = soll_map.get(emp.id)
        if soll is None:
            pct = emp.targetHoursPercent
            if pct is None:
                continue
            soll = wd * 8.0 * (pct / 100.0)
        actual = emp_actual.get(emp.id, 0)
        soll_deviation[emp.id] = SollDelta(
            soll=round(soll, 1),
            actual=round(actual, 1),
            delta=round(actual - soll, 1),
        )

    wish_ids = {w.id for w in request.wishes}
    fulfilled_wishes: set[str] = set()
    for w in request.wishes:
        for a in assignments:
            if a.employeeId != w.employeeId or a.date != w.date:
                continue
            if w.shiftProfileId and a.shiftProfileId != w.shiftProfileId:
                continue
            if w.shiftType:
                p = profile_hours  # just need shiftType
                prof = next((pr for pr in request.shiftProfiles if pr.id == a.shiftProfileId), None)
                if prof and prof.shiftType != w.shiftType:
                    continue
            fulfilled_wishes.add(w.id)
            break
    unfulfilled = [wid for wid in wish_ids if wid not in fulfilled_wishes]
    rate = len(fulfilled_wishes) / len(wish_ids) if wish_ids else None

    deltas = [abs(sd.delta) for sd in soll_deviation.values()]
    fairness = max(deltas) - min(deltas) if len(deltas) >= 2 else 0.0

    return SolveResponse(
        status=status_str,
        solveTimeMs=round(wall_ms, 1),
        objectiveValue=solver.ObjectiveValue() if objective_terms else 0,
        gap=solver.BestObjectiveBound() / max(solver.ObjectiveValue(), 1e-9) if objective_terms and solver.ObjectiveValue() > 0 else 0.0,
        modelStats=ModelStats(
            variables=model.Proto().variables.__len__(),
            constraints=model.Proto().constraints.__len__(),
            booleans=len(shift),
        ),
        assignments=assignments,
        unfulfilledWishes=unfulfilled,
        diagnostics=Diagnostics(
            sollDeviation=soll_deviation,
            fairnessSpread=round(fairness, 1),
            wishFulfillmentRate=round(rate, 2) if rate is not None else None,
        ),
    )
