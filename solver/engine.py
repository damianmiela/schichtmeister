"""CP-SAT solver engine — builds the model, adds constraints, solves, returns results."""

from __future__ import annotations

import json
import logging
import time
from datetime import date
from typing import Generator

from ortools.sat.python import cp_model

log = logging.getLogger(__name__)

from models import (
    SolveRequest, SolveResponse, AssignmentOutput,
    ModelStats, Diagnostics, SollDelta, QualityMetrics,
)
from config import weights_from_overrides
from scorer import extract_quality_metrics
from utils import dates_in_range, paid_hours, is_weekend_or_holiday
import collections
from constraints.hard import (
    add_one_shift_per_day,
    add_unavailability,
    add_staffing_maximum,
    add_qualification_coverage,
    add_min_rest,
    add_max_consecutive_nights,
    add_max_consecutive_days,
    add_manual_placements,
    add_mini_job_cap,
    add_wbl_bl_max_one_per_week,
    add_wbl_bl_weekly,
    add_alternating_weekends,
    add_wbl_weekend_limit,
    add_station_assignment,
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
    add_alternating_weekends_boundary_soft,
    add_consecutive_days_boundary_soft,
    add_rest_after_streak_boundary_soft,
)


class ProgressCallback(cp_model.CpSolverSolutionCallback):
    """Tracks solver progress and yields NDJSON events via a shared list."""

    def __init__(
        self,
        events: list[str],
        wall_start: float,
        cancel_check=None,  # callable returning bool, or None
    ):
        super().__init__()
        self._events = events
        self._wall_start = wall_start
        self._solutions = 0
        self._cancel_check = cancel_check
        # Plateau tracking — wall-time of last STRICTLY better objective.
        # The watchdog in solve_streaming polls this externally to decide
        # when the search has plateaued and call StopSearch().
        self._best_obj_seen = float("inf")
        self._last_improvement_at = wall_start

    def on_solution_callback(self):
        self._solutions += 1
        elapsed = time.perf_counter() - self._wall_start
        obj = self.ObjectiveValue()
        bound = self.BestObjectiveBound()
        # Relative optimality gap as a percentage:
        #   gap_pct = (objective - bound) / max(|objective|, 1) * 100
        # Approaches 0% as the search closes; 0% means proven optimal.
        # Clamped to [0, infinity) - bound > obj shouldn\'t happen for a valid
        # minimization relaxation but guard anyway.
        denom = max(abs(obj), 1.0)
        gap_pct = max(0.0, (obj - bound) / denom * 100.0)
        # Plateau tracking: bump the timestamp only on a STRICTLY better
        # objective. Same-objective callbacks (e.g. solver exploring
        # equivalent solutions) leave the timer alone — those don't count
        # as progress for the plateau heuristic.
        if obj < self._best_obj_seen:
            self._best_obj_seen = obj
            self._last_improvement_at = time.perf_counter()
        # Wall-clock seconds (since this race's wall_start) at which the
        # most recent strictly-better objective was found. Frontend uses
        # this with its own race-start timer to display "Letzte
        # Verbesserung vor Xs" live.
        last_improvement_elapsed = self._last_improvement_at - self._wall_start
        event = {
            "type": "progress",
            "stage": "solving",
            "label": f"Suche beste Lösung\u2026 Aktueller Wert: {obj:.0f}",
            "pct": min(30 + self._solutions * 5, 85),
            "solutions": self._solutions,
            "objective": round(obj, 1),
            "bound": round(bound, 1),
            "gap": round(gap_pct, 2),  # percentage, e.g. 12.43
            "elapsed": round(elapsed, 1),
            "lastImprovementElapsed": round(last_improvement_elapsed, 1),
        }
        self._events.append(json.dumps(event))
        # Graceful cancellation: when set, CP-SAT returns the best
        # feasible solution it has at this moment (status=FEASIBLE).
        if self._cancel_check and self._cancel_check():
            self.StopSearch()


def _build_variables(
    model: cp_model.CpModel,
    req: SolveRequest,
) -> tuple[
    dict[tuple[str, str, str], cp_model.IntVar],
    dict[tuple[str, str], cp_model.IntVar],
    dict[tuple[str, str, int], cp_model.IntVar],
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

    # Manual placements MUST have variables — bypass allowedShiftProfileIds filter
    mp_forced: set[tuple[str, str, str]] = set()
    for mp in req.manualPlacements:
        mp_forced.add((mp.employeeId, mp.date, mp.shiftProfileId))

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
                # Still create vars for manual placements even on "unavailable" days
                forced_on_day = [p for p in active_profiles if (emp.id, ds, p.id) in mp_forced]
                if not forced_on_day:
                    continue
                for p in forced_on_day:
                    var = model.NewBoolVar(f"s_{emp.id}_{ds}_{p.id}")
                    shift[(emp.id, ds, p.id)] = var
                if (emp.id, ds) not in works_day:
                    works_day[(emp.id, ds)] = model.NewBoolVar(f"wd_{emp.id}_{ds}")
                continue

            day_has_var = False
            for p in active_profiles:
                is_forced = (emp.id, ds, p.id) in mp_forced
                # Auto-plan-disabled (MJ/Ausbildung): solver MUST NOT create
                # variables for these employees except where the planner has
                # forced a manualPlacement. This is the mechanism that keeps
                # them out of the auto-assignment pool. Note: empty
                # `allowed` was historically interpreted as "no restrictions",
                # so we can't rely on the `allowed` check below for this.
                if not is_forced and emp.autoPlanDisabled:
                    continue
                if not is_forced and allowed and p.id not in allowed:
                    continue
                # BL profiles: only WBL employees, unless isFullTimeBl (but always allow if forced)
                if not is_forced and p.shiftType == "BL" and not is_wbl and not emp.isFullTimeBl:
                    continue
                # BL shifts not allowed on weekends or public holidays
                if not is_forced and p.shiftType == "BL" and is_weekend_or_holiday(d):
                    continue
                var = model.NewBoolVar(f"s_{emp.id}_{ds}_{p.id}")
                shift[(emp.id, ds, p.id)] = var
                day_has_var = True

            if day_has_var:
                works_day[(emp.id, ds)] = model.NewBoolVar(f"wd_{emp.id}_{ds}")

    # ── Station-assignment variables ──────────────────────────────────
    # For multi-station employees: choose among their assigned stations.
    # For floaters (no assigned stations): choose among all demand stations.
    # Single-station employees don't need assignment vars (always at their station).
    all_demand_stations: set[int] = set()
    for sr in req.staffingRequirements:
        if sr.stationNumber is not None and not sr.isFacilityWide:
            all_demand_stations.add(sr.stationNumber)

    station_assign: dict[tuple[str, str, int], cp_model.IntVar] = {}
    for emp in req.employees:
        stations = emp_stations[emp.id]
        if len(stations) == 1:
            continue  # single-station: always at their one station

        # Multi-station: their assigned stations; Floater: all demand stations
        assign_stations = stations if stations else all_demand_stations
        if not assign_stations:
            continue

        for d in dates:
            ds = d.isoformat()
            if (emp.id, ds) not in works_day:
                continue
            for st in assign_stations:
                station_assign[(emp.id, ds, st)] = model.NewBoolVar(
                    f"sa_{emp.id}_{ds}_{st}"
                )

    return shift, works_day, station_assign


def _resolve_stations(
    assignments: list[AssignmentOutput],
    request: SolveRequest,
) -> list[AssignmentOutput]:
    """Assign a stationNumber to assignments that don't already have one.

    Assignments with a stationNumber set by the solver (multi-station employees)
    are kept as-is.  Remaining assignments (single-station employees, floaters)
    are placed via:
    1. Group assignments by (date, shiftType).
    2. Build per-station demand from non-facility-wide staffing requirements.
    3. Subtract already-placed (solver-assigned) counts from demand.
    4. Place single-station employees (they can only go to one station).
    5. Place floaters greedily to the station with the largest remaining gap.
    """
    prof_map = {p.id: p for p in request.shiftProfiles}
    emp_map = {e.id: e for e in request.employees}

    # Build station demands and caps per shift type
    station_demand: dict[str, dict[int, int]] = collections.defaultdict(dict)
    station_max: dict[str, dict[int, int]] = collections.defaultdict(dict)
    for sr in request.staffingRequirements:
        if sr.isFacilityWide or sr.stationNumber is None:
            continue
        station_demand[sr.shiftType][sr.stationNumber] = sr.minTotalCount
        if sr.maxTotalCount is not None:
            station_max[sr.shiftType][sr.stationNumber] = sr.maxTotalCount

    # Group assignments by (date, shiftType)
    groups: dict[tuple[str, str], list[int]] = collections.defaultdict(list)
    for idx, a in enumerate(assignments):
        prof = prof_map.get(a.shiftProfileId)
        st = prof.shiftType if prof else "?"
        groups[(a.date, st)].append(idx)

    # Build lookup of manual placement station overrides: (employeeId, date) -> station
    mp_station: dict[tuple[str, str], int] = {}
    for mp in request.manualPlacements:
        if mp.stationNumber is not None:
            mp_station[(mp.employeeId, mp.date)] = mp.stationNumber

    result = list(assignments)  # shallow copy to mutate stationNumber

    # ── Pre-pass: apply manual placement station overrides unconditionally ──
    # This runs BEFORE the group loop so it works even for shift types
    # that have no station-specific staffing requirements.
    mp_applied: set[int] = set()
    for idx, a in enumerate(assignments):
        mp_st = mp_station.get((a.employeeId, a.date))
        if mp_st is not None:
            log.info("_resolve_stations: MANUAL OVERRIDE emp=%s date=%s profile=%s → station %d (was %s)",
                     a.employeeId[:8], a.date, a.shiftProfileId[:8], mp_st, a.stationNumber)
            result[idx] = AssignmentOutput(
                employeeId=a.employeeId,
                date=a.date,
                shiftProfileId=a.shiftProfileId,
                stationNumber=mp_st,
            )
            mp_applied.add(idx)

    for (ds, shift_type), indices in groups.items():
        demands = station_demand.get(shift_type)
        if not demands:
            # No station-specific requirements for this shift type (e.g., BL, NIGHT fw-only)
            continue

        # Track how many still needed per station AND current counts vs max
        remaining = dict(demands)  # {station: remaining_needed}
        caps = station_max.get(shift_type, {})
        current_count: dict[int, int] = {s: 0 for s in demands}
        placed: dict[int, int | None] = {}  # assignment index -> station

        single_station_indices: list[int] = []
        floater_indices: list[int] = []

        for idx in indices:
            a = result[idx]  # use result (may have manual override applied)

            # Skip manual placements — already handled in pre-pass
            if idx in mp_applied:
                sn = a.stationNumber
                if sn is not None:
                    remaining[sn] = remaining.get(sn, 0) - 1
                    current_count[sn] = current_count.get(sn, 0) + 1
                continue

            if a.stationNumber is not None:
                # Already assigned by solver — subtract from remaining, add to count
                remaining[a.stationNumber] = remaining.get(a.stationNumber, 0) - 1
                current_count[a.stationNumber] = current_count.get(a.stationNumber, 0) + 1
                continue

            emp = emp_map.get(a.employeeId)
            if not emp:
                continue
            emp_stations = set(emp.assignedStations)
            eligible = emp_stations & set(demands.keys())

            if len(eligible) == 1:
                single_station_indices.append(idx)
            elif len(emp_stations) == 0:
                floater_indices.append(idx)

        # Pass 1: place single-station employees
        for idx in single_station_indices:
            a = assignments[idx]
            emp = emp_map.get(a.employeeId)
            if not emp:
                continue
            eligible = set(emp.assignedStations) & set(demands.keys())
            if len(eligible) == 1:
                station = next(iter(eligible))
                placed[idx] = station
                remaining[station] = remaining.get(station, 0) - 1
                current_count[station] = current_count.get(station, 0) + 1

        # Pass 2: place floaters to station with biggest gap, respecting max
        for idx in floater_indices:
            a = assignments[idx]
            emp = emp_map.get(a.employeeId)
            if not emp:
                continue
            # Floaters can go to any station that has demand
            eligible = set(demands.keys())

            # Filter out stations already at max capacity
            eligible = {s for s in eligible
                        if s not in caps or current_count.get(s, 0) < caps[s]}

            if not eligible:
                continue

            # Pick station with the highest remaining need
            best_station = max(eligible, key=lambda s: remaining.get(s, 0))
            placed[idx] = best_station
            remaining[best_station] = remaining.get(best_station, 0) - 1
            current_count[best_station] = current_count.get(best_station, 0) + 1

        # Write station numbers back
        for idx, station in placed.items():
            if station is not None:
                result[idx] = result[idx].model_copy(update={"stationNumber": station})

    return result


STATUS_MAP = {
    cp_model.OPTIMAL: "OPTIMAL",
    cp_model.FEASIBLE: "FEASIBLE",
    cp_model.INFEASIBLE: "INFEASIBLE",
    cp_model.MODEL_INVALID: "INFEASIBLE",
}


def _build_and_add_all_constraints(
    model: cp_model.CpModel,
    shift: dict,
    works_day: dict,
    station_assign: dict,
    request: SolveRequest,
    relaxed: bool,
) -> list[tuple[cp_model.IntVar, int]]:
    """Add every constraint to the given model and return the objective terms.

    When ``relaxed=False`` (Phase 1) behaves exactly as before: strict hard
    constraints for rest, consecutive days/nights, staffing max, mini-job cap,
    alternating weekends, WBL rules.

    When ``relaxed=True`` (Phase 2 fallback, only used if Phase 1 is INFEASIBLE)
    those same constraints are converted to soft penalties with very large
    weights so the solver can still produce a plan. Manual placements,
    absences, one-shift-per-day, and station assignment remain HARD.
    """
    # Build the per-solve Weights instance once. Constraint builders read
    # ``w.W_FOO`` and runtime overrides from ``request.weights`` are
    # already merged on top of factory defaults here.
    w = weights_from_overrides(request.weights)

    objective_terms: list[tuple[cp_model.IntVar, int]] = []

    # ── Hard (always) ───────────────────────────────────────────────
    add_one_shift_per_day(model, shift, works_day, request)
    add_unavailability(model, shift, request)
    add_manual_placements(model, shift, request, station_assign)
    add_station_assignment(model, shift, works_day, station_assign, request)

    # ── Hard in strict mode, soft in relaxed mode (legal / physical) ──
    # These three are physical or legal constraints that should almost
    # never break. Stay hard in Phase 1; only Phase 2 turns them soft.
    objective_terms.extend(add_staffing_maximum(model, shift, request, station_assign, relaxed=relaxed, w=w))
    objective_terms.extend(add_min_rest(model, shift, request, relaxed=relaxed, w=w))
    objective_terms.extend(add_mini_job_cap(model, shift, request, relaxed=relaxed, w=w))

    # ── ALWAYS soft (policy / fairness rules) ───────────────────────
    # User policy: prefer breaking these to spread shifts more evenly
    # across employees rather than concentrating heavy overtime on a
    # single person. Their W_RELAX_* weights are calibrated below the
    # over-Soll T3/T4 cost so the solver picks a rule break before it
    # piles +20h+ onto one employee.
    objective_terms.extend(add_max_consecutive_nights(model, shift, request, relaxed=True, w=w))
    objective_terms.extend(add_max_consecutive_days(model, works_day, request, relaxed=True, w=w))
    objective_terms.extend(add_wbl_bl_max_one_per_week(model, shift, request, relaxed=True, w=w))
    objective_terms.extend(add_alternating_weekends(model, works_day, request, relaxed=True, w=w))
    objective_terms.extend(add_wbl_weekend_limit(model, works_day, request, relaxed=True, w=w))
    objective_terms.extend(add_wbl_bl_weekly(model, shift, request, relaxed=True, w=w))

    # ── Always soft ─────────────────────────────────────────────────
    objective_terms.extend(add_staffing_minimum_soft(model, shift, request, station_assign, w=w))
    objective_terms.extend(add_qualification_coverage_soft(model, shift, request, station_assign, w=w))
    objective_terms.extend(add_wbl_bl_soft(model, shift, request, w=w))
    objective_terms.extend(add_min_utilization_soft(model, shift, request, w=w))
    objective_terms.extend(add_soll_deviation(model, shift, request, w=w))
    objective_terms.extend(add_overtime_penalty(model, shift, request, w=w))
    objective_terms.extend(add_undercut_penalty(model, shift, request, w=w))
    objective_terms.extend(add_wish_fulfillment(model, shift, request, w=w))
    objective_terms.extend(add_fairness(model, shift, request, w=w))
    objective_terms.extend(add_preference_bonus(model, shift, request, w=w))
    objective_terms.extend(add_shift_distribution_soft(model, shift, request, w=w))
    objective_terms.extend(add_alternating_weekends_boundary_soft(model, works_day, request, w=w))
    objective_terms.extend(add_consecutive_days_boundary_soft(model, works_day, request, w=w))
    objective_terms.extend(add_rest_after_streak_boundary_soft(model, works_day, request, w=w))

    if objective_terms:
        model.Minimize(sum(var * weight for var, weight in objective_terms))

    return objective_terms


def solve(request: SolveRequest) -> SolveResponse:
    """Build model, add all constraints and objectives, solve, return results.

    Uses a two-phase approach: Phase 1 with strict hard constraints (unchanged
    behavior). If Phase 1 returns INFEASIBLE, Phase 2 rebuilds the model with
    most rules converted to soft penalties so a plan is still produced. Rule
    violations in the Phase-2 result are detected by the post-solve TypeScript
    validator and surfaced in the warnings panel.
    """
    wall_start = time.perf_counter()

    prof_map = {p.id: p for p in request.shiftProfiles}
    if request.manualPlacements:
        for mp in request.manualPlacements:
            pn = prof_map[mp.shiftProfileId].name if mp.shiftProfileId in prof_map else "UNKNOWN"
            log.info("ManualPlacement received: emp=%s date=%s profileId=%s (%s) station=%s",
                     mp.employeeId[:8], mp.date, mp.shiftProfileId[:8], pn, mp.stationNumber)

    def attempt(relaxed: bool):
        model = cp_model.CpModel()
        shift, works_day, station_assign = _build_variables(model, request)
        log.info("Model (%s): %d shift vars, %d works_day vars, %d station_assign vars, %d employees, %d profiles, %d dates",
                 "RELAXED" if relaxed else "STRICT",
                 len(shift), len(works_day), len(station_assign),
                 len(request.employees), len(request.shiftProfiles),
                 len(dates_in_range(request.periodStart, request.periodEnd)))
        if not shift:
            return None, model, shift, works_day, station_assign, [], None, "NO_VARS"

        objective_terms = _build_and_add_all_constraints(
            model, shift, works_day, station_assign, request, relaxed=relaxed,
        )

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = request.maxSolveTimeSeconds
        solver.parameters.num_workers = request.numWorkers
        if request.randomSeed is not None:
            solver.parameters.random_seed = request.randomSeed
        log.info("Solving (%s) with %d objective terms, max_time=%ds, num_workers=%d, random_seed=%s...",
                 "RELAXED" if relaxed else "STRICT",
                 len(objective_terms), request.maxSolveTimeSeconds,
                 request.numWorkers,
                 request.randomSeed if request.randomSeed is not None else "default")
        status_code = solver.Solve(model)
        status_str = STATUS_MAP.get(status_code, "UNKNOWN")
        log.info("Solve (%s) done: status=%s, objective=%.0f",
                 "RELAXED" if relaxed else "STRICT",
                 status_str,
                 solver.ObjectiveValue() if status_code in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0)
        return solver, model, shift, works_day, station_assign, objective_terms, status_code, status_str

    # Phase 1 — strict
    solver, model, shift, works_day, station_assign, objective_terms, status_code, status_str = attempt(False)

    if status_str == "NO_VARS":
        return SolveResponse(
            status="INFEASIBLE",
            solveTimeMs=round((time.perf_counter() - wall_start) * 1000, 1),
            reason="Keine gültigen Zuweisungsmöglichkeiten (keine Variablen erstellt).",
        )

    # Phase 2 — relaxed fallback
    if status_str in ("INFEASIBLE", "UNKNOWN"):
        log.info("Phase 1 returned %s — retrying with relaxed constraints", status_str)
        solver, model, shift, works_day, station_assign, objective_terms, status_code, status_str = attempt(True)

    wall_ms = (time.perf_counter() - wall_start) * 1000

    if status_str in ("INFEASIBLE", "UNKNOWN", "NO_VARS"):
        return SolveResponse(
            status="INFEASIBLE",
            solveTimeMs=round(wall_ms, 1),
            reason=(
                "Auch mit gelockerten Regeln konnte kein Plan erstellt werden. "
                "Bitte prüfen Sie, ob sich manuelle Vorgaben oder Abwesenheiten widersprechen."
            ),
        )

    # ── Extract assignments ─────────────────────────────────────────────
    # First, extract station assignments from the solver for multi-station employees
    solved_stations: dict[tuple[str, str], int] = {}  # (emp_id, date) -> station
    for (emp_id, ds, station), var in station_assign.items():
        if solver.Value(var) == 1:
            solved_stations[(emp_id, ds)] = station

    assignments: list[AssignmentOutput] = []
    for (emp_id, ds, pid), var in shift.items():
        if solver.Value(var) == 1:
            sn = solved_stations.get((emp_id, ds))
            assignments.append(AssignmentOutput(
                employeeId=emp_id, date=ds, shiftProfileId=pid,
                stationNumber=sn,
            ))

    log.info("Extracted %d assignments (%d with solver-assigned station) for %d employees",
             len(assignments),
             sum(1 for a in assignments if a.stationNumber is not None),
             len({a.employeeId for a in assignments}))

    # ── Post-solve: resolve station numbers for single-station & floaters ─
    assignments = _resolve_stations(assignments, request)

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

    quality_metrics = QualityMetrics(
        **extract_quality_metrics(request, assignments, soll_deviation)
    )

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
        qualityMetrics=quality_metrics,
    )


def solve_streaming(
    request: SolveRequest,
    cancel_check=None,  # callable returning bool, or None
) -> Generator[str, None, None]:
    """Like solve(), but yields NDJSON progress events during solving.

    If ``cancel_check`` is provided and returns True at any point during
    a feasible-solution callback, CP-SAT's StopSearch() is called and
    the solver returns the best feasible solution found so far. The
    yielded "result" event contains those assignments and status
    "FEASIBLE" (or "INFEASIBLE" if the search was cancelled before any
    feasible solution was found)."""
    wall_start = time.perf_counter()

    yield json.dumps({
        "type": "progress", "stage": "building_model",
        "label": "Erstelle Modell & Variablen...", "pct": 5,
    }) + "\n"

    model = cp_model.CpModel()
    shift, works_day, station_assign = _build_variables(model, request)

    prof_map = {p.id: p for p in request.shiftProfiles}
    log.info("Model: %d shift vars, %d works_day vars, %d station_assign vars",
             len(shift), len(works_day), len(station_assign))

    if not shift:
        yield json.dumps({
            "type": "result",
            "data": SolveResponse(
                status="INFEASIBLE", solveTimeMs=0,
                reason="Keine gültigen Zuweisungsmöglichkeiten (keine Variablen erstellt).",
            ).model_dump(),
        }) + "\n"
        return

    yield json.dumps({
        "type": "progress", "stage": "adding_constraints",
        "label": "Füge Constraints hinzu...", "pct": 12,
    }) + "\n"

    objective_terms = _build_and_add_all_constraints(
        model, shift, works_day, station_assign, request, relaxed=False,
    )

    yield json.dumps({
        "type": "progress", "stage": "solving_started",
        "label": "CP-SAT Solver gestartet...", "pct": 22,
    }) + "\n"

    import threading

    # Plateau-stop config: when set, the search stops after this many
    # seconds without a strictly-better objective. None = no plateau check.
    plateau_seconds = request.plateauSeconds

    def _stream_solve(current_model, current_solver, callback, progress_events, result_holder):
        """Generator — runs solver in thread and yields progress events live.

        Status code is stored in ``result_holder[0]`` once the solver finishes.
        Caller uses ``yield from _stream_solve(...)`` so every event reaches the
        SSE stream as soon as the CP-SAT callback pushes it to the shared list.

        Also acts as the watchdog for plateau-stop: between event drains, if
        ``plateau_seconds`` is configured AND at least one feasible solution
        has been found AND the time since the last STRICTLY-better objective
        exceeds the threshold, calls ``solver.StopSearch()`` externally. The
        solver winds down within ~0.5s; we keep draining events while it does.
        """
        def _run_solver():
            result_holder.append(current_solver.Solve(current_model, callback))

        solver_thread = threading.Thread(target=_run_solver)
        solver_thread.start()
        plateau_stopped = False
        while solver_thread.is_alive():
            solver_thread.join(timeout=0.5)
            while progress_events:
                yield progress_events.pop(0) + "\n"
            if (
                plateau_seconds is not None
                and not plateau_stopped
                and callback._best_obj_seen != float("inf")
            ):
                idle = time.perf_counter() - callback._last_improvement_at
                if idle > plateau_seconds:
                    log.info(
                        "Plateau-stop: no improvement for %.1fs (>= %ds), calling StopSearch()",
                        idle, plateau_seconds,
                    )
                    progress_events.append(json.dumps({
                        "type": "progress", "stage": "plateau_stop",
                        "label": (
                            f"Plateau erkannt: {idle:.0f}s ohne Verbesserung — "
                            f"Suche wird beendet."
                        ),
                    }))
                    current_solver.StopSearch()
                    plateau_stopped = True
        # Drain any events added between the last check and thread exit
        while progress_events:
            yield progress_events.pop(0) + "\n"

    # When plateau-stop is active, the time budget is effectively the
    # plateau threshold (the watchdog calls StopSearch once it triggers).
    # CP-SAT still requires SOME max — set a generous safety cap of 30
    # minutes so a truly stuck solver eventually gives up.
    PLATEAU_HARD_CAP_S = 1800
    effective_max_time = (
        PLATEAU_HARD_CAP_S if plateau_seconds is not None else request.maxSolveTimeSeconds
    )

    # ── Phase 1: strict solve ──
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = effective_max_time
    solver.parameters.num_workers = request.numWorkers
    if request.randomSeed is not None:
        solver.parameters.random_seed = request.randomSeed
    log.info(
        "Stream-solving (STRICT) max_time=%ds, plateau=%s, num_workers=%d, random_seed=%s",
        effective_max_time,
        f"{plateau_seconds}s" if plateau_seconds is not None else "off",
        request.numWorkers,
        request.randomSeed if request.randomSeed is not None else "default",
    )
    progress_events: list[str] = []
    callback = ProgressCallback(progress_events, wall_start, cancel_check=cancel_check)
    result_holder: list[int] = []
    yield from _stream_solve(model, solver, callback, progress_events, result_holder)
    status_code = result_holder[0] if result_holder else cp_model.UNKNOWN

    status_str = STATUS_MAP.get(status_code, "UNKNOWN")

    # ── Phase 2: relaxed fallback ──
    # Silent retry — we intentionally do NOT yield a new progress label here,
    # so the UI keeps showing the original "Suche beste Lösung… Aktueller Wert"
    # updates from the solver callback without a distracting banner.
    if status_str in ("INFEASIBLE", "UNKNOWN"):
        log.info("Streaming Phase 1 returned %s — retrying with relaxed constraints", status_str)

        model = cp_model.CpModel()
        shift, works_day, station_assign = _build_variables(model, request)
        if not shift:
            yield json.dumps({
                "type": "result",
                "data": SolveResponse(
                    status="INFEASIBLE", solveTimeMs=round((time.perf_counter() - wall_start) * 1000, 1),
                    reason="Keine gültigen Zuweisungsmöglichkeiten (keine Variablen erstellt).",
                ).model_dump(),
            }) + "\n"
            return

        objective_terms = _build_and_add_all_constraints(
            model, shift, works_day, station_assign, request, relaxed=True,
        )

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = effective_max_time
        solver.parameters.num_workers = request.numWorkers
        if request.randomSeed is not None:
            solver.parameters.random_seed = request.randomSeed
        progress_events = []
        # Fresh callback for Phase 2 — plateau timer resets naturally because
        # _last_improvement_at is initialized to wall_start in __init__.
        callback = ProgressCallback(progress_events, wall_start, cancel_check=cancel_check)
        result_holder = []
        yield from _stream_solve(model, solver, callback, progress_events, result_holder)
        status_code = result_holder[0] if result_holder else cp_model.UNKNOWN
        status_str = STATUS_MAP.get(status_code, "UNKNOWN")

    wall_ms = (time.perf_counter() - wall_start) * 1000

    yield json.dumps({
        "type": "progress", "stage": "extracting",
        "label": "Ergebnisse werden extrahiert...", "pct": 88,
    }) + "\n"

    if status_str in ("INFEASIBLE", "UNKNOWN"):
        yield json.dumps({
            "type": "result",
            "data": SolveResponse(
                status=status_str, solveTimeMs=round(wall_ms, 1),
                reason=(
                    "Auch mit gelockerten Regeln konnte kein Plan erstellt werden. "
                    "Bitte prüfen Sie, ob sich manuelle Vorgaben oder Abwesenheiten widersprechen."
                ),
            ).model_dump(),
        }) + "\n"
        return

    # ── Extract assignments ──
    solved_stations: dict[tuple[str, str], int] = {}
    for (emp_id, ds, station), var in station_assign.items():
        if solver.Value(var) == 1:
            solved_stations[(emp_id, ds)] = station

    assignments: list[AssignmentOutput] = []
    for (emp_id, ds, pid), var in shift.items():
        if solver.Value(var) == 1:
            sn = solved_stations.get((emp_id, ds))
            assignments.append(AssignmentOutput(
                employeeId=emp_id, date=ds, shiftProfileId=pid,
                stationNumber=sn,
            ))

    assignments = _resolve_stations(assignments, request)

    yield json.dumps({
        "type": "progress", "stage": "diagnostics",
        "label": "Diagnostik wird erstellt...", "pct": 93,
    }) + "\n"

    # ── Diagnostics ──
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
            soll=round(soll, 1), actual=round(actual, 1), delta=round(actual - soll, 1),
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
                prof = next((pr for pr in request.shiftProfiles if pr.id == a.shiftProfileId), None)
                if prof and prof.shiftType != w.shiftType:
                    continue
            fulfilled_wishes.add(w.id)
            break
    unfulfilled = [wid for wid in wish_ids if wid not in fulfilled_wishes]
    rate = len(fulfilled_wishes) / len(wish_ids) if wish_ids else None

    deltas = [abs(sd.delta) for sd in soll_deviation.values()]
    fairness = max(deltas) - min(deltas) if len(deltas) >= 2 else 0.0

    quality_metrics = QualityMetrics(
        **extract_quality_metrics(request, assignments, soll_deviation)
    )

    response = SolveResponse(
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
        qualityMetrics=quality_metrics,
    )

    yield json.dumps({"type": "result", "data": response.model_dump()}) + "\n"
