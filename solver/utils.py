"""Date, time, and ISO-week utilities for the solver.

Mirrors logic from the TypeScript codebase:
- src/lib/planning/time.ts (shiftIntervalMs, assignmentPaidHours)
- src/lib/schedule/generateDraftSchedule.ts (isoWeekKey, toIsoDateOnly)
"""

from __future__ import annotations

from datetime import date, datetime, timedelta


def parse_date(iso: str) -> date:
    return date.fromisoformat(iso)


def dates_in_range(start: str, end: str) -> list[date]:
    s = parse_date(start)
    e = parse_date(end)
    out: list[date] = []
    d = s
    while d <= e:
        out.append(d)
        d += timedelta(days=1)
    return out


def iso_week_key(d: date) -> str:
    iso_year, iso_week, _ = d.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def paid_hours(start_time: str, end_time: str, break_minutes: int) -> float:
    """Compute paid hours for a shift profile (gross minus break).

    If end <= start, the shift crosses midnight (e.g. night shift 21:00-06:30).
    """
    sh, sm = map(int, start_time.split(":"))
    eh, em = map(int, end_time.split(":"))
    start_min = sh * 60 + sm
    end_min = eh * 60 + em
    if end_min <= start_min:
        end_min += 24 * 60
    gross_min = end_min - start_min
    return max(0.0, gross_min - break_minutes) / 60.0


def shift_end_minutes(start_time: str, end_time: str) -> tuple[int, int]:
    """Return (start_minutes_from_midnight, end_minutes_from_midnight).

    end may be > 1440 for overnight shifts.
    """
    sh, sm = map(int, start_time.split(":"))
    eh, em = map(int, end_time.split(":"))
    start_min = sh * 60 + sm
    end_min = eh * 60 + em
    if end_min <= start_min:
        end_min += 24 * 60
    return start_min, end_min


def rest_violated(
    end_time_1: str, start_time_1: str,
    end_time_2: str, start_time_2: str,
    min_rest_hours: float,
) -> bool:
    """Check if two profiles on consecutive days violate the rest constraint.

    Profile 1 is on day D, profile 2 is on day D+1.
    Returns True if rest between end of profile 1 and start of profile 2 < min_rest_hours.
    """
    _, end1 = shift_end_minutes(start_time_1, end_time_1)
    start2, _ = shift_end_minutes(start_time_2, end_time_2)
    minutes_until_midnight = 24 * 60 - end1
    gap_minutes = minutes_until_midnight + start2
    return gap_minutes < min_rest_hours * 60
