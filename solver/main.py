"""FastAPI entry point for the SchichtMeister CP-SAT solver."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import PlainTextResponse
from models import SolveRequest, SolveResponse
from engine import solve
from scorer import score

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = FastAPI(
    title="SchichtMeister Solver",
    version="0.1.0",
    docs_url="/docs",
    redoc_url=None,
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/solve", response_model=SolveResponse)
async def solve_schedule(request: SolveRequest):
    return solve(request)


@app.post("/score")
async def score_schedule(request: Request):
    """Accept a debug-export JSON and return a plain-text quality report."""
    data = await request.json()
    report = score(data)
    return PlainTextResponse(report)
