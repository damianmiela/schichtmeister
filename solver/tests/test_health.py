"""Smoke tests for the solver API scaffold."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_solve_stub():
    payload = {
        "schemaVersion": 1,
        "scheduleId": "test-schedule-1",
        "periodStart": "2026-03-01",
        "periodEnd": "2026-03-31",
        "employees": [
            {
                "id": "emp1",
                "qualificationTags": ["PFK"],
                "allowedShiftProfileIds": ["f1"],
                "targetHoursPercent": 100,
            }
        ],
        "shiftProfiles": [
            {
                "id": "f1",
                "name": "F1",
                "shiftType": "EARLY",
                "startTime": "06:00",
                "endTime": "13:30",
                "paidHours": 7.0,
            }
        ],
    }
    resp = client.post("/solve", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "FEASIBLE"
    assert isinstance(data["assignments"], list)
    assert isinstance(data["solveTimeMs"], (int, float))
    assert "modelStats" in data


def test_solve_validation_error():
    resp = client.post("/solve", json={"bad": "data"})
    assert resp.status_code == 422
