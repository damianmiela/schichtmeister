"""Tests for hard constraints: each constraint verified in isolation or small combos."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from engine import solve
from models import SolveRequest


def _base_request(**overrides) -> dict:
    base = {
        "schemaVersion": 1,
        "scheduleId": "test",
        "periodStart": "2026-03-02",
        "periodEnd": "2026-03-08",
        "maxSolveTimeSeconds": 10,
        "employees": [
            {"id": "e1", "qualificationTags": ["PFK"], "targetHoursPercent": 100},
            {"id": "e2", "qualificationTags": ["APH"], "targetHoursPercent": 100},
            {"id": "e3", "qualificationTags": ["PFK"], "targetHoursPercent": 100},
        ],
        "shiftProfiles": [
            {"id": "f1", "name": "F1", "shiftType": "EARLY", "stationNumber": 1,
             "startTime": "06:00", "endTime": "13:30", "breakMinutes": 30, "paidHours": 7.0},
            {"id": "s1", "name": "S1", "shiftType": "LATE", "stationNumber": 1,
             "startTime": "13:00", "endTime": "21:30", "breakMinutes": 30, "paidHours": 8.0},
        ],
        "staffingRequirements": [],
        "wishes": [],
        "manualPlacements": [],
        "blockedDates": [],
        "rules": {
            "minRestHours": 11, "maxConsecutiveNights": 3,
            "maxConsecutiveDays": 7, "requiredRestDaysAfterStreak": 2,
            "maxOvertimeHours": 8, "maxUndercutHours": 4,
        },
    }
    base.update(overrides)
    return base


def test_one_shift_per_day():
    """Each employee should have at most 1 shift per day."""
    req = SolveRequest(**_base_request())
    resp = solve(req)
    assert resp.status in ("OPTIMAL", "FEASIBLE")
    by_emp_day: dict[tuple[str, str], int] = {}
    for a in resp.assignments:
        key = (a.employeeId, a.date)
        by_emp_day[key] = by_emp_day.get(key, 0) + 1
    for key, count in by_emp_day.items():
        assert count <= 1, f"{key} has {count} shifts"


def test_unavailability():
    """Employee with unavailable date should not be scheduled that day."""
    data = _base_request()
    data["employees"][0]["unavailableDates"] = ["2026-03-03", "2026-03-04"]
    data["staffingRequirements"] = [
        {"shiftType": "EARLY", "stationNumber": 1, "minTotalCount": 1, "maxTotalCount": 3},
    ]
    req = SolveRequest(**data)
    resp = solve(req)
    assert resp.status in ("OPTIMAL", "FEASIBLE")
    for a in resp.assignments:
        if a.employeeId == "e1":
            assert a.date not in ("2026-03-03", "2026-03-04")


def test_staffing_minimum():
    """Staffing minimum should be met when enough people exist."""
    data = _base_request()
    data["staffingRequirements"] = [
        {"shiftType": "EARLY", "stationNumber": 1, "minTotalCount": 2, "maxTotalCount": 3},
    ]
    req = SolveRequest(**data)
    resp = solve(req)
    assert resp.status in ("OPTIMAL", "FEASIBLE")
    for d_str in ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05",
                   "2026-03-06", "2026-03-07", "2026-03-08"]:
        count = sum(1 for a in resp.assignments
                    if a.date == d_str and a.shiftProfileId == "f1")
        assert count >= 2, f"Only {count} EARLY on {d_str}"


def test_staffing_maximum():
    """Staffing maximum should not be exceeded."""
    data = _base_request()
    data["staffingRequirements"] = [
        {"shiftType": "EARLY", "stationNumber": 1, "minTotalCount": 1, "maxTotalCount": 2},
    ]
    req = SolveRequest(**data)
    resp = solve(req)
    assert resp.status in ("OPTIMAL", "FEASIBLE")
    for d_str in ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05",
                   "2026-03-06", "2026-03-07", "2026-03-08"]:
        count = sum(1 for a in resp.assignments
                    if a.date == d_str and a.shiftProfileId == "f1")
        assert count <= 2, f"{count} EARLY on {d_str}, max is 2"


def test_qualification_coverage():
    """Qualification requirement should be met."""
    data = _base_request()
    data["staffingRequirements"] = [
        {
            "shiftType": "EARLY", "stationNumber": 1,
            "minTotalCount": 2, "maxTotalCount": 3,
            "qualificationRequirements": [
                {"tags": ["PFK"], "minCount": 1},
            ],
        },
    ]
    req = SolveRequest(**data)
    resp = solve(req)
    assert resp.status in ("OPTIMAL", "FEASIBLE")
    pfk_ids = {"e1", "e3"}
    for d_str in ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05",
                   "2026-03-06", "2026-03-07", "2026-03-08"]:
        pfk_count = sum(1 for a in resp.assignments
                        if a.date == d_str and a.shiftProfileId == "f1"
                        and a.employeeId in pfk_ids)
        assert pfk_count >= 1, f"No PFK on EARLY {d_str}"


def test_manual_placement_locked():
    """Manual placements should be honored exactly."""
    data = _base_request()
    data["manualPlacements"] = [
        {"employeeId": "e1", "date": "2026-03-05", "shiftProfileId": "s1"},
    ]
    req = SolveRequest(**data)
    resp = solve(req)
    assert resp.status in ("OPTIMAL", "FEASIBLE")
    found = any(
        a.employeeId == "e1" and a.date == "2026-03-05" and a.shiftProfileId == "s1"
        for a in resp.assignments
    )
    assert found, "Manual placement not in output"


def test_blocked_dates():
    """Blocked dates should prevent scheduling."""
    data = _base_request()
    data["blockedDates"] = [{"employeeId": "e2", "date": "2026-03-06"}]
    req = SolveRequest(**data)
    resp = solve(req)
    assert resp.status in ("OPTIMAL", "FEASIBLE")
    for a in resp.assignments:
        if a.employeeId == "e2":
            assert a.date != "2026-03-06"


def test_allowed_profiles():
    """Employees should only get profiles in their allowed list."""
    data = _base_request()
    data["employees"][0]["allowedShiftProfileIds"] = ["f1"]
    req = SolveRequest(**data)
    resp = solve(req)
    assert resp.status in ("OPTIMAL", "FEASIBLE")
    for a in resp.assignments:
        if a.employeeId == "e1":
            assert a.shiftProfileId == "f1", f"e1 got {a.shiftProfileId}"


def test_station_assignment():
    """An employee assigned to station 1 is only ever placed at station 1."""
    data = _base_request()
    data["employees"][0]["assignedStations"] = [1]
    data["employees"][0]["allowedShiftProfileIds"] = ["f1"]
    data["staffingRequirements"] = [
        {"shiftType": "EARLY", "stationNumber": 1, "minTotalCount": 1},
        {"shiftType": "EARLY", "stationNumber": 2, "minTotalCount": 1},
    ]
    req = SolveRequest(**data)
    resp = solve(req)
    assert resp.status in ("OPTIMAL", "FEASIBLE")
    e1_shifts = [a for a in resp.assignments if a.employeeId == "e1"]
    assert e1_shifts, "e1 got no shifts"
    assert {a.stationNumber for a in e1_shifts} == {1}


def test_impossible_staffing_still_returns_a_plan():
    """Minimum staffing is a soft rule (since 31 Mar): an impossible requirement
    leaves slots empty instead of making the whole month INFEASIBLE."""
    data = _base_request()
    data["employees"] = [
        {"id": "e1", "qualificationTags": ["PFK"], "targetHoursPercent": 100},
    ]
    data["staffingRequirements"] = [
        {"shiftType": "EARLY", "stationNumber": 1, "minTotalCount": 3},
    ]
    req = SolveRequest(**data)
    resp = solve(req)
    assert resp.status in ("OPTIMAL", "FEASIBLE")
    assert resp.assignments, "the one available employee should still be planned"


def test_max_consecutive_days():
    """No employee should work more than 7 consecutive days."""
    data = _base_request()
    data["periodStart"] = "2026-03-01"
    data["periodEnd"] = "2026-03-14"
    data["staffingRequirements"] = [
        {"shiftType": "EARLY", "stationNumber": 1, "minTotalCount": 1, "maxTotalCount": 3},
    ]
    req = SolveRequest(**data)
    resp = solve(req)
    assert resp.status in ("OPTIMAL", "FEASIBLE")
    from collections import defaultdict
    days_by_emp: dict[str, list[str]] = defaultdict(list)
    for a in resp.assignments:
        days_by_emp[a.employeeId].append(a.date)
    for emp_id, days in days_by_emp.items():
        sorted_days = sorted(days)
        streak = 1
        for i in range(1, len(sorted_days)):
            from datetime import date as dt
            d1 = dt.fromisoformat(sorted_days[i - 1])
            d2 = dt.fromisoformat(sorted_days[i])
            if (d2 - d1).days == 1:
                streak += 1
                assert streak <= 7, f"{emp_id} has {streak} consecutive days"
            else:
                streak = 1


def test_wbl_bl_weekly():
    """WBL employees should get at least 1 BL per week."""
    data = _base_request()
    data["periodStart"] = "2026-03-02"
    data["periodEnd"] = "2026-03-08"
    data["employees"] = [
        {"id": "w1", "qualificationTags": ["WBL", "PFK"], "isWbl": True,
         "targetHoursPercent": 100},
        {"id": "w2", "qualificationTags": ["WBL", "PFK"], "isWbl": True,
         "targetHoursPercent": 100},
        {"id": "e3", "qualificationTags": ["APH"], "targetHoursPercent": 100},
    ]
    data["shiftProfiles"].append(
        {"id": "bl", "name": "BL", "shiftType": "BL", "stationNumber": None,
         "startTime": "08:00", "endTime": "16:30", "breakMinutes": 30, "paidHours": 8.0}
    )
    req = SolveRequest(**data)
    resp = solve(req)
    assert resp.status in ("OPTIMAL", "FEASIBLE")
    for wbl_id in ["w1", "w2"]:
        bl_count = sum(1 for a in resp.assignments
                       if a.employeeId == wbl_id and a.shiftProfileId == "bl")
        assert bl_count >= 1, f"{wbl_id} has {bl_count} BL shifts"
