"""FastAPI entry point for the SchichtMeister CP-SAT solver."""

from __future__ import annotations

import logging
import threading

from fastapi import FastAPI, Request
from fastapi.responses import PlainTextResponse, StreamingResponse, JSONResponse
from models import SolveRequest, SolveResponse
from engine import solve, solve_streaming
from scorer import score

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(
    title="SchichtMeister Solver",
    version="0.1.0",
    docs_url="/docs",
    redoc_url=None,
)


# ── Cooperative cancellation ─────────────────────────────────────────────
# Each in-flight /solve-stream call may carry an opaque `cancelKey`. A
# concurrent POST to /cancel/{key} flips a flag in this module-level set;
# the running CP-SAT callback polls it and, if set, calls StopSearch() to
# return the best feasible solution found so far. After the call exits,
# the key is removed.
_CANCEL_KEYS: set[str] = set()
_CANCEL_LOCK = threading.Lock()


def _is_cancelled(key: str) -> bool:
    if not key:
        return False
    with _CANCEL_LOCK:
        return key in _CANCEL_KEYS


def _mark_cancelled(key: str) -> None:
    if not key:
        return
    with _CANCEL_LOCK:
        _CANCEL_KEYS.add(key)


def _clear_cancelled(key: str) -> None:
    if not key:
        return
    with _CANCEL_LOCK:
        _CANCEL_KEYS.discard(key)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/solve", response_model=SolveResponse)
async def solve_schedule(request: SolveRequest):
    return solve(request)


@app.post("/solve-stream")
async def solve_schedule_stream(request: SolveRequest):
    """Stream solver progress as NDJSON lines, final line is the result.

    Supports cooperative cancellation via the optional ``cancelKey`` in
    the request body. While this call is running, a concurrent
    ``POST /cancel/{cancelKey}`` will signal CP-SAT to stop and return
    the best feasible solution it has at that moment.
    """
    key = request.cancelKey or ""

    def cancel_check() -> bool:
        return _is_cancelled(key)

    # Wrap the generator so we always clean up the cancel-key flag,
    # even if the client disconnects mid-stream.
    def gen():
        try:
            yield from solve_streaming(request, cancel_check=cancel_check)
        finally:
            _clear_cancelled(key)

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@app.post("/cancel/{key}")
async def cancel_solve(key: str):
    """Signal a running /solve-stream call (matched by `cancelKey` in its
    request body) to stop searching and return its best-so-far feasible
    solution. No-op if no such key is currently active."""
    _mark_cancelled(key)
    log.info("Cancel requested for key=%s", key)
    return JSONResponse({"ok": True, "key": key})


@app.post("/score")
async def score_schedule(request: Request):
    """Accept a debug-export JSON and return a plain-text quality report."""
    data = await request.json()
    report = score(data)
    return PlainTextResponse(report)
