"""Integration test: realistic small scenario with all constraint types active."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


REALISTIC_PAYLOAD = {
    "schemaVersion": 1,
    "scheduleId": "integration-test",
    "periodStart": "2026-03-02",
    "periodEnd": "2026-03-15",
    "maxSolveTimeSeconds": 15,
    "monthlyWorkingDays": 22,
    "employees": [
        {"id": "pfk1", "qualificationTags": ["PFK", "WBL"], "isWbl": True,
         "targetHoursPercent": 100, "assignedStations": [1]},
        {"id": "pfk2", "qualificationTags": ["PFK"],
         "targetHoursPercent": 100, "assignedStations": [1]},
        {"id": "pfk3", "qualificationTags": ["PFK", "WBL"], "isWbl": True,
         "targetHoursPercent": 75, "assignedStations": [3]},
        {"id": "aph1", "qualificationTags": ["APH"],
         "targetHoursPercent": 100, "assignedStations": [1]},
        {"id": "aph2", "qualificationTags": ["APH"],
         "targetHoursPercent": 50, "assignedStations": [3]},
        {"id": "kph1", "qualificationTags": ["KPH"],
         "targetHoursPercent": 100, "assignedStations": []},
        {"id": "ph1", "qualificationTags": ["PH"],
         "targetHoursPercent": 100, "assignedStations": [1]},
    ],
    "shiftProfiles": [
        {"id": "f1", "name": "F1", "shiftType": "EARLY", "stationNumber": 1,
         "startTime": "06:00", "endTime": "13:30", "breakMinutes": 30, "paidHours": 7.0},
        {"id": "f3", "name": "F3", "shiftType": "EARLY", "stationNumber": 3,
         "startTime": "06:00", "endTime": "13:00", "breakMinutes": 30, "paidHours": 6.5},
        {"id": "s1", "name": "S1", "shiftType": "LATE", "stationNumber": 1,
         "startTime": "13:00", "endTime": "21:30", "breakMinutes": 30, "paidHours": 8.0},
        {"id": "s3", "name": "S3", "shiftType": "LATE", "stationNumber": 3,
         "startTime": "13:00", "endTime": "21:30", "breakMinutes": 30, "paidHours": 8.0},
        {"id": "bl", "name": "BL", "shiftType": "BL", "stationNumber": None,
         "startTime": "08:00", "endTime": "16:30", "breakMinutes": 30, "paidHours": 8.0},
    ],
    "staffingRequirements": [
        {
            "shiftType": "EARLY", "stationNumber": 1,
            "minTotalCount": 2, "maxTotalCount": 4,
            "qualificationRequirements": [{"tags": ["PFK"], "minCount": 1}],
        },
        {
            "shiftType": "EARLY", "stationNumber": 3,
            "minTotalCount": 1, "maxTotalCount": 3,
        },
        {
            "shiftType": "LATE", "stationNumber": 1,
            "minTotalCount": 1, "maxTotalCount": 2,
        },
        {
            "shiftType": "LATE", "stationNumber": 3,
            "minTotalCount": 1, "maxTotalCount": 2,
        },
    ],
    "wishes": [
        {"id": "w1", "employeeId": "pfk1", "date": "2026-03-05",
         "shiftType": "EARLY", "priority": "STRONG"},
    ],
    "manualPlacements": [
        {"employeeId": "aph1", "date": "2026-03-10", "shiftProfileId": "f1"},
    ],
    "blockedDates": [
        {"employeeId": "pfk2", "date": "2026-03-06"},
        {"employeeId": "pfk2", "date": "2026-03-07"},
    ],
    "rules": {
        "minRestHours": 11, "maxConsecutiveNights": 3,
        "maxConsecutiveDays": 7, "requiredRestDaysAfterStreak": 2,
        "maxOvertimeHours": 8, "maxUndercutHours": 4,
    },
}


def test_integration_via_api():
    resp = client.post("/solve", json=REALISTIC_PAYLOAD)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("OPTIMAL", "FEASIBLE"), f"Got {data['status']}: {data.get('reason')}"
    assert len(data["assignments"]) > 0

    by_emp_day: dict[tuple[str, str], int] = {}
    for a in data["assignments"]:
        k = (a["employeeId"], a["date"])
        by_emp_day[k] = by_emp_day.get(k, 0) + 1
    for k, count in by_emp_day.items():
        assert count <= 1, f"{k} has {count} shifts"

    assert any(
        a["employeeId"] == "aph1" and a["date"] == "2026-03-10" and a["shiftProfileId"] == "f1"
        for a in data["assignments"]
    ), "Manual placement missing"

    for a in data["assignments"]:
        if a["employeeId"] == "pfk2":
            assert a["date"] not in ("2026-03-06", "2026-03-07"), "Blocked date violated"

    assert "diagnostics" in data
    assert "modelStats" in data
    print(f"Status: {data['status']}, Time: {data['solveTimeMs']:.0f}ms, "
          f"Assignments: {len(data['assignments'])}, "
          f"Vars: {data['modelStats']['variables']}, "
          f"Constraints: {data['modelStats']['constraints']}")


def test_diagnostics_soll():
    resp = client.post("/solve", json=REALISTIC_PAYLOAD)
    data = resp.json()
    diag = data["diagnostics"]
    assert "sollDeviation" in diag
    for emp_id, delta in diag["sollDeviation"].items():
        assert "soll" in delta
        assert "actual" in delta
        assert "delta" in delta
