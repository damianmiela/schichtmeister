"""FastAPI entry point for the SchichtMeister CP-SAT solver."""

from __future__ import annotations

from fastapi import FastAPI
from models import SolveRequest, SolveResponse
from engine import solve

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
