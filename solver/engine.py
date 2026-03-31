"""CP-SAT solver engine — stub for Phase 1.

Phase 2+ will replace this with the real constraint model.
"""

from __future__ import annotations

import time

from ortools.sat.python import cp_model  # noqa: F401 — verify import works

from models import SolveRequest, SolveResponse, ModelStats


def solve(request: SolveRequest) -> SolveResponse:
    """Stub: return an empty feasible solution with zero assignments."""
    start = time.perf_counter()

    elapsed_ms = (time.perf_counter() - start) * 1000

    return SolveResponse(
        status="FEASIBLE",
        solveTimeMs=round(elapsed_ms, 1),
        objectiveValue=0,
        gap=0.0,
        modelStats=ModelStats(variables=0, constraints=0, booleans=0),
        assignments=[],
        unfulfilledWishes=[w.id for w in request.wishes],
        reason=None,
    )
