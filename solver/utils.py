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


# ── Rheinland-Pfalz holidays ──────────────────────────────────────────────


def _easter_sunday(year: int) -> date:
    """Easter Sunday via the Anonymous Gregorian algorithm (Meeus/Jones/Butcher)."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31  # 3=Mar, 4=Apr
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def rheinland_pfalz_holidays(year: int) -> set[date]:
    """All Rheinland-Pfalz public holidays for a given year."""
    easter = _easter_sunday(year)
    return {
        date(year, 1, 1),                          # Neujahr
        easter + timedelta(days=-2),                # Karfreitag
        easter + timedelta(days=1),                 # Ostermontag
        date(year, 5, 1),                           # Tag der Arbeit
        easter + timedelta(days=39),                # Christi Himmelfahrt
        easter + timedelta(days=50),                # Pfingstmontag
        easter + timedelta(days=60),                # Fronleichnam
        date(year, 10, 3),                          # Tag der Deutschen Einheit
        date(year, 11, 1),                          # Allerheiligen
        date(year, 12, 25),                         # 1. Weihnachtstag
        date(year, 12, 26),                         # 2. Weihnachtstag
    }


_holiday_cache: dict[int, set[date]] = {}


def is_weekend_or_holiday(d: date) -> bool:
    """True if the date is a Saturday, Sunday, or Rheinland-Pfalz public holiday."""
    if d.weekday() >= 5:  # 5=Sat, 6=Sun
        return True
    year = d.year
    if year not in _holiday_cache:
        _holiday_cache[year] = rheinland_pfalz_holidays(year)
    return d in _holiday_cache[year]


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
