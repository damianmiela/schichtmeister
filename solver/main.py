"""FastAPI entry point for the SchichtMeister CP-SAT solver."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from models import SolveRequest, SolveResponse
from engine import solve

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
