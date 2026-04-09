"""Schedule quality scoring – importable module.

Accepts a debug-export dict (same shape as the Debug JSON export) and returns
a plain-text quality report.  Used both by the ``/score`` API endpoint and by
the standalone ``debug/score_schedule.py`` CLI tool.
"""

from __future__ import annotations

import collections
import io
import contextlib
from datetime import date, timedelta


BOUNDARY_DAYS = 7

# ── helpers ──────────────────────────────────────────────────────────────────

def _dates_in_range(start: str, end: str) -> list[date]:
    s = date.fromisoformat(start)
    e = date.fromisoformat(end)
    out: list[date] = []
    while s <= e:
        out.append(s)
        s += timedelta(days=1)
    return out


def _iso_week(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def _shift_type_of(a: dict, prof_type: dict[str, str]) -> str:
    return a.get("shiftType") or prof_type.get(a["shiftProfileId"], "?")


def _physical_station(a: dict, eid: str, emp_stations: dict[str, set[int]]) -> int | None:
    raw = a.get("stationNumber")
    if raw is not None:
        try:
            return int(raw)
        except (TypeError, ValueError):
            pass
    es = emp_stations.get(eid, set())
    if len(es) == 1:
        return next(iter(es))
    return None


# ── main scoring function ────────────────────────────────────────────────────

def score(data: dict) -> str:
    """Return a plain-text quality report for the given debug-export data."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        _run(data)
    return buf.getvalue()


def _run(data: dict) -> None:
    period_start = data["schedule"]["periodStart"]
    period_end = data["schedule"]["periodEnd"]
    dates = _dates_in_range(period_start, period_end)
    emp_names: dict[str, str] = data["employeeNames"]
    prof_names: dict[str, str] = data["profileNames"]
    staffing = data["staffingRequirements"]
    assignments: list[dict] = data["currentAssignments"]
    solver = data.get("solverPayload") or {}
    soll_map: dict[str, float] = solver.get("monthlySollHoursByEmployee") or {}
    employees: list[dict] = solver.get("employees") or []
    profiles: list[dict] = solver.get("shiftProfiles") or []
    previous_assignments: list[dict] = data.get("previousAssignments") or solver.get("previousAssignments") or []
    employee_absences: list[dict] = data.get("employeeAbsences") or []
    rules: dict = solver.get("rules") or data.get("planningRules") or {}

    prof_type = {p["id"]: p["shiftType"] for p in profiles}
    prof_hours = {p["id"]: p["paidHours"] for p in profiles}
    emp_stations = {e["id"]: set(e.get("assignedStations", [])) for e in employees}
    emp_is_wbl = {e["id"]: e.get("isWbl", False) for e in employees}
    emp_quals = {e["id"]: set(e.get("qualificationTags", [])) for e in employees}

    # Build absence date sets per employee
    absent_dates: dict[str, set[date]] = collections.defaultdict(set)
    for ab in employee_absences:
        eid = ab["employeeId"]
        for d in _dates_in_range(ab["startDate"], ab["endDate"]):
            absent_dates[eid].add(d)

    # Build previous assignments index
    prev_by_emp: dict[str, list[dict]] = collections.defaultdict(list)
    for pa in previous_assignments:
        prev_by_emp[pa["employeeId"]].append(pa)

    # -- index -----------------------------------------------------------------
    by_date_type: dict[tuple[str, str], list[dict]] = collections.defaultdict(list)
    by_emp: dict[str, list[dict]] = collections.defaultdict(list)
    for a in assignments:
        st = a.get("shiftType") or prof_type.get(a["shiftProfileId"], "?")
        by_date_type[(a["date"], st)].append(a)
        by_emp[a["employeeId"]].append(a)

    print("=" * 80)
    print(f"SCHEDULE QUALITY REPORT  {period_start} -> {period_end}")
    print(f"  {len(dates)} days, {len(emp_names)} employees, {len(assignments)} assignments")
    if previous_assignments:
        print(f"  Cross-month boundary: {len(previous_assignments)} previous assignments loaded")
    if employee_absences:
        absent_emp_count = len(set(ab["employeeId"] for ab in employee_absences))
        print(f"  Absences: {len(employee_absences)} entries affecting {absent_emp_count} employees")
    print("=" * 80)

    # -- 1. Staffing coverage --------------------------------------------------
    print("\n-- 1. STAFFING COVERAGE --")
    total_slots = 0
    filled_slots = 0
    understaffed: list[tuple[str, str, int, int]] = []
    for sr in staffing:
        key = sr["key"]
        parts = key.split(":")
        shift_type = parts[0]
        is_fw = sr["isFacilityWide"]
        station = None if is_fw else int(parts[1]) if len(parts) > 1 else None
        min_count = sr["minTotalCount"]

        for d in dates:
            ds = d.isoformat()
            assigned = by_date_type.get((ds, shift_type), [])
            if is_fw:
                count = len(assigned)
            else:
                count = 0
                for a in assigned:
                    eid = a["employeeId"]
                    es = emp_stations.get(eid, set())
                    if not es or (station is not None and station in es):
                        count += 1

            total_slots += min_count
            filled_slots += min(count, min_count)
            if count < min_count:
                understaffed.append((ds, key, min_count, count))

    pct = filled_slots / total_slots * 100 if total_slots else 0
    print(f"  Total required slots: {total_slots}")
    print(f"  Filled: {filled_slots} ({pct:.1f}%)")
    print(f"  Understaffed day/shift combos: {len(understaffed)}")
    if understaffed:
        by_type = collections.Counter(k for _, k, _, _ in understaffed)
        for k, c in by_type.most_common():
            print(f"    {k}: {c} days understaffed")
        worst = sorted(understaffed, key=lambda x: x[2] - x[3], reverse=True)[:5]
        print("  Worst gaps:")
        for ds, key, needed, got in worst:
            print(f"    {ds} {key}: needed {needed}, got {got} (gap={needed - got})")

    # -- 1b. Station coverage --------------------------------------------------
    print("\n-- 1b. STATION COVERAGE (assigned vs min/max per station) --")

    station_reqs: dict[tuple[str, int], dict] = {}
    all_stations: set[int] = set()
    for sr in staffing:
        if sr.get("isFacilityWide"):
            continue
        parts = sr["key"].split(":")
        if len(parts) < 2 or not parts[1].isdigit():
            continue
        stype, snum = parts[0], int(parts[1])
        all_stations.add(snum)
        station_reqs[(stype, snum)] = {
            "min": sr["minTotalCount"],
            "max": sr.get("maxTotalCount"),
            "quals": sr.get("qualificationRequirements", []),
        }

    stations_list = sorted(all_stations) if all_stations else [1, 2, 3]
    total_days = len(dates)

    has_station_data = any(a.get("stationNumber") is not None for a in assignments)
    if not has_station_data:
        print("  !! WARNING: No stationNumber on assignments — using employee profile fallback.")

    print("\n  Requirements:")
    for (stype, snum), req in sorted(station_reqs.items()):
        max_str = str(req["max"]) if req["max"] is not None else "∞"
        qual_strs = []
        for qr in req["quals"]:
            max_s = f'≤{qr["maxCount"]}' if qr.get("maxCount") is not None else ""
            qual_strs.append(f'{qr["qualificationTag"]}≥{qr["minCount"]}{max_s}')
        qual_info = f"  quals: {', '.join(qual_strs)}" if qual_strs else ""
        print(f"    {stype} St{snum}: min={req['min']}, max={max_str}{qual_info}")

    station_violations_under: list[tuple] = []
    station_violations_over: list[tuple] = []
    qual_violations: list[tuple] = []
    unplaced_days: dict[str, int] = collections.defaultdict(int)

    shift_types_with_stations = sorted(set(st for st, _ in station_reqs.keys()))

    st_cols = []
    for stype in shift_types_with_stations:
        for s in stations_list:
            st_cols.append(f"{stype[:1]}S{s}")
    hdr = f"  {'Date':<12}  " + "  ".join(f"{c:>4}" for c in st_cols) + f"  {'?':>3}"
    print(f"\n{hdr}")
    print("  " + "-" * (len(hdr) - 2))

    for d in dates:
        ds = d.isoformat()
        row_vals = []
        day_unplaced = 0

        for stype in shift_types_with_stations:
            assigned_list = by_date_type.get((ds, stype), [])
            counts: dict[int, int] = {s: 0 for s in stations_list}
            unplaced = 0
            qual_counts: dict[tuple[int, str], dict[str, int]] = collections.defaultdict(
                lambda: collections.defaultdict(int)
            )

            for a in assigned_list:
                eid = a["employeeId"]
                sn = a.get("stationNumber")
                if sn is not None:
                    try:
                        sn = int(sn)
                    except (TypeError, ValueError):
                        sn = None
                if sn is None:
                    es = emp_stations.get(eid, set())
                    if len(es) == 1:
                        sn = next(iter(es))

                if sn in counts:
                    counts[sn] += 1
                    for tag in emp_quals.get(eid, set()):
                        qual_counts[(sn, tag)][eid] = 1
                else:
                    unplaced += 1

            day_unplaced += unplaced

            for s in stations_list:
                row_vals.append(counts[s])
                req = station_reqs.get((stype, s))
                if req:
                    if counts[s] < req["min"]:
                        station_violations_under.append((ds, stype, s, req["min"], counts[s]))
                    if req["max"] is not None and counts[s] > req["max"]:
                        station_violations_over.append((ds, stype, s, req["max"], counts[s]))
                    for qr in req.get("quals", []):
                        tags = qr["qualificationTag"].split(",")
                        qualified: set[str] = set()
                        for tag in tags:
                            tag = tag.strip()
                            for q_eid in qual_counts.get((s, tag), {}):
                                qualified.add(q_eid)
                        if len(qualified) < qr["minCount"]:
                            qual_violations.append(
                                (ds, stype, s, qr["qualificationTag"], qr["minCount"], len(qualified))
                            )
                        qr_max = qr.get("maxCount")
                        if qr_max is not None and len(qualified) > qr_max:
                            qual_violations.append(
                                (ds, stype, s, qr["qualificationTag"], f"max {qr_max}", len(qualified))
                            )

        print(f"  {ds}  " + "  ".join(f"{v:>4}" for v in row_vals) + f"  {day_unplaced:>3}")
        if day_unplaced:
            unplaced_days[ds] += day_unplaced

    # Monthly averages
    print("\n  --- Monthly averages (assignments per day, by station) ---")
    for stype in shift_types_with_stations:
        for s in stations_list:
            total = sum(
                1
                for a in assignments
                if (
                    _shift_type_of(a, prof_type) == stype
                    and _physical_station(a, a["employeeId"], emp_stations) == s
                )
            )
            req = station_reqs.get((stype, s))
            min_str = f" (min={req['min']})" if req else ""
            print(f"    {stype:<5} St{s}: {total / total_days:.2f}/day  (total {total} shifts){min_str}")

    if station_violations_under:
        by_key = collections.Counter((st, s) for _, st, s, _, _ in station_violations_under)
        print(f"\n  !! UNDERSTAFFED: {len(station_violations_under)} station/day violations:")
        for (st, s), cnt in by_key.most_common():
            req = station_reqs.get((st, s), {})
            print(f"    {st} St{s} (min={req.get('min', '?')}): {cnt}/{total_days} days below minimum")
        worst = sorted(station_violations_under, key=lambda x: x[3] - x[4], reverse=True)[:5]
        print("  Worst gaps:")
        for ds, stype, s, needed, got in worst:
            print(f"    {ds} {stype} St{s}: needed {needed}, got {got} (gap={needed - got})")
    else:
        print(f"\n  OK All station minimums met every day")

    if station_violations_over:
        by_key = collections.Counter((st, s) for _, st, s, _, _ in station_violations_over)
        print(f"\n  !! OVERSTAFFED: {len(station_violations_over)} station/day violations:")
        for (st, s), cnt in by_key.most_common():
            req = station_reqs.get((st, s), {})
            print(f"    {st} St{s} (max={req.get('max', '?')}): {cnt}/{total_days} days above maximum")
    else:
        print(f"  OK No station maximums exceeded")

    if qual_violations:
        by_key = collections.Counter((st, s, tag) for _, st, s, tag, _, _ in qual_violations)
        print(f"\n  !! QUALIFICATION GAPS: {len(qual_violations)} station/day violations:")
        for (st, s, tag), cnt in by_key.most_common():
            print(f"    {st} St{s} [{tag}]: {cnt}/{total_days} days below required")
    else:
        print(f"  OK All qualification requirements met per station")

    if unplaced_days:
        print(f"\n  Days with unresolved station assignments: {len(unplaced_days)}/{total_days}")
    else:
        print(f"  OK All assignments have a resolved station")

    # -- 2. Night shifts -------------------------------------------------------
    print("\n-- 2. NIGHT SHIFTS --")
    night_fw = [sr for sr in staffing if sr["key"].endswith(":fw") and sr["key"].startswith("NIGHT")]
    night_station = [sr for sr in staffing if sr["key"].startswith("NIGHT:") and not sr["isFacilityWide"]]
    print(f"  FW requirements: {len(night_fw)} (min={sum(s['minTotalCount'] for s in night_fw)})")
    print(f"  Station-specific requirements: {len(night_station)} (min={sum(s['minTotalCount'] for s in night_station)})")
    total_night_demand = sum(s["minTotalCount"] for s in night_fw) + sum(
        s["minTotalCount"] for s in night_station
    )
    print(f"  TOTAL NIGHT DEMAND per day: {total_night_demand}")
    night_counts = []
    for d in dates:
        ds = d.isoformat()
        n = len(by_date_type.get((ds, "NIGHT"), []))
        night_counts.append(n)
    if night_counts:
        print(
            f"  Actual nightly staffing: min={min(night_counts)}, "
            f"max={max(night_counts)}, avg={sum(night_counts) / len(night_counts):.1f}"
        )
    if night_station and night_fw:
        print("  !! WARNING: Both station-specific AND facility-wide NIGHT requirements exist!")

    # -- 3. BL analysis --------------------------------------------------------
    print("\n-- 3. BL (WBL) SHIFTS --")
    wbl_ids = [eid for eid, v in emp_is_wbl.items() if v]
    non_wbl_bl: list[dict] = []
    wbl_bl_counts: dict[str, int] = collections.Counter()
    wbl_bl_weekly: dict[str, dict[str, int]] = collections.defaultdict(
        lambda: collections.defaultdict(int)
    )
    for a in assignments:
        st = a.get("shiftType") or prof_type.get(a["shiftProfileId"], "?")
        if st != "BL":
            continue
        eid = a["employeeId"]
        if eid not in wbl_ids:
            non_wbl_bl.append(a)
        wbl_bl_counts[eid] += 1
        d = date.fromisoformat(a["date"])
        wbl_bl_weekly[eid][_iso_week(d)] += 1

    print(f"  WBL employees: {len(wbl_ids)}")
    print(f"  Total BL assignments: {sum(wbl_bl_counts.values())}")
    if non_wbl_bl:
        print(f"  !! BL assigned to non-WBL: {len(non_wbl_bl)}")
        for a in non_wbl_bl[:3]:
            print(f"    {emp_names.get(a['employeeId'], '?')} on {a['date']}")
    for eid in wbl_ids:
        name = emp_names.get(eid, eid[:8])
        total = wbl_bl_counts.get(eid, 0)
        weeks_with_bl = sum(1 for w, c in wbl_bl_weekly[eid].items() if c >= 1)
        weeks_total = len(set(_iso_week(d) for d in dates))
        multi_bl_weeks = [(w, c) for w, c in wbl_bl_weekly[eid].items() if c > 1]
        status = "OK" if weeks_with_bl == weeks_total and not multi_bl_weeks else "!!"
        print(f"  {status} {name}: {total} BL total, {weeks_with_bl}/{weeks_total} weeks covered", end="")
        if multi_bl_weeks:
            print(f" — MULTI-BL weeks: {multi_bl_weeks}", end="")
        print()

    # -- 4. Soll/Ist hours -----------------------------------------------------
    print("\n-- 4. SOLL vs IST HOURS --")
    emp_actual: dict[str, float] = collections.defaultdict(float)
    emp_shift_counts: dict[str, int] = collections.defaultdict(int)
    for a in assignments:
        pid = a["shiftProfileId"]
        h = prof_hours.get(pid, 0)
        emp_actual[a["employeeId"]] += h
        emp_shift_counts[a["employeeId"]] += 1

    deviations: list[tuple[str, str, float, float, float, int]] = []
    unassigned: list[str] = []
    on_leave: list[str] = []
    for eid, name in sorted(emp_names.items(), key=lambda x: x[1]):
        soll = soll_map.get(eid)
        actual = emp_actual.get(eid, 0)
        shifts = emp_shift_counts.get(eid, 0)
        if soll is None:
            continue
        delta = actual - soll
        deviations.append((eid, name, soll, actual, delta, shifts))
        if shifts == 0:
            # Check if fully absent for the entire period
            emp_absent = absent_dates.get(eid, set())
            all_absent = all(d in emp_absent for d in dates)
            if all_absent:
                on_leave.append(name)
            else:
                unassigned.append(name)

    if on_leave:
        print(f"  On leave (full period, {len(on_leave)}): {', '.join(on_leave)}")
    if unassigned:
        print(f"  !! UNASSIGNED employees ({len(unassigned)}): {', '.join(unassigned)}")

    deltas: list[float] = []
    if deviations:
        deltas = [abs(d[4]) for d in deviations]
        print(f"  Avg |deviation|: {sum(deltas) / len(deltas):.1f}h")
        print(f"  Max |deviation|: {max(deltas):.1f}h")
        over = [(n, d) for _, n, s, a, d, _ in deviations if d > 4]
        under = [(n, d) for _, n, s, a, d, _ in deviations if d < -4]
        if over:
            print(f"  Over Soll (>4h): {len(over)}")
            for n, d in sorted(over, key=lambda x: -x[1])[:5]:
                print(f"    {n}: +{d:.1f}h")
        if under:
            print(f"  Under Soll (<-4h): {len(under)}")
            for n, d in sorted(under, key=lambda x: x[1])[:5]:
                print(f"    {n}: {d:.1f}h")

    # -- 5. Daily staffing heatmap ---------------------------------------------
    print("\n-- 5. DAILY STAFFING COUNTS --")
    shift_types = ["EARLY", "LATE", "NIGHT", "BL"]
    print(f"  {'Date':<12}", end="")
    for st in shift_types:
        print(f" {st:>6}", end="")
    print(f" {'TOTAL':>6}")
    for d in dates:
        ds = d.isoformat()
        print(f"  {ds}", end="")
        day_total = 0
        for st in shift_types:
            c = len(by_date_type.get((ds, st), []))
            day_total += c
            print(f" {c:>6}", end="")
        print(f" {day_total:>6}")

    # -- 6. Employee shift distribution ----------------------------------------
    print("\n-- 6. EMPLOYEE SHIFT DISTRIBUTION --")
    print(f"  {'Name':<35} {'Shifts':>6} {'Soll':>6} {'Ist':>6} {'Delta':>7}  Types")
    for eid, name, soll, actual, delta, shifts in sorted(deviations, key=lambda x: x[4]):
        type_counts: dict[str, int] = collections.Counter()
        for a in by_emp.get(eid, []):
            st = a.get("shiftType") or "?"
            type_counts[st] += 1
        types_str = " ".join(f"{t}={c}" for t, c in sorted(type_counts.items()))
        sign = "+" if delta >= 0 else ""
        print(f"  {name:<35} {shifts:>6} {soll:>6.0f} {actual:>6.1f} {sign}{delta:>6.1f}  {types_str}")

    # -- 7. Consecutive days (with cross-month boundary) -------------------------
    print("\n-- 7. MAX CONSECUTIVE WORKING DAYS --")
    max_consec_limit = int(rules.get("maxConsecutiveDays", 7))
    violations: list[tuple[str, int, str]] = []
    rest_after_6_violations: list[tuple[str, int, str, int]] = []

    # Build extended date range including previous boundary days
    prev_work_dates_by_emp: dict[str, set[date]] = collections.defaultdict(set)
    for pa in previous_assignments:
        prev_work_dates_by_emp[pa["employeeId"]].add(date.fromisoformat(pa["date"]))

    # Extended dates: up to 7 days before period start + period dates
    boundary_start = dates[0] - timedelta(days=BOUNDARY_DAYS) if dates else date.today()
    extended_dates = _dates_in_range(boundary_start.isoformat(), period_end) if dates else []

    for eid, name in emp_names.items():
        work_dates: set[date] = set()
        for a in by_emp.get(eid, []):
            work_dates.add(date.fromisoformat(a["date"]))
        prev_dates = prev_work_dates_by_emp.get(eid, set())
        all_work = work_dates | prev_dates
        if not all_work:
            continue

        consec = 0
        max_consec = 0
        max_consec_end = ""
        for i, d in enumerate(extended_dates):
            if d in all_work:
                consec += 1
                if consec > max_consec:
                    max_consec = consec
                    max_consec_end = d.isoformat()
            else:
                # Check rest-after-6 only for days within the actual period
                if consec >= 6 and d >= dates[0]:
                    rest_count = 0
                    for j in range(0, 2):
                        check_d = d + timedelta(days=j)
                        if check_d not in all_work and check_d <= dates[-1]:
                            rest_count += 1
                        else:
                            break
                    if rest_count < 2:
                        rest_after_6_violations.append((name, consec, d.isoformat(), rest_count))
                consec = 0
        if max_consec > max_consec_limit:
            boundary_note = " (cross-month)" if any(d < dates[0] for d in prev_dates) else ""
            violations.append((name, max_consec, f"ending {max_consec_end}{boundary_note}"))

    if violations:
        print(f"  !! {len(violations)} employees exceed {max_consec_limit} consecutive days:")
        for name, c, note in sorted(violations, key=lambda x: -x[1]):
            print(f"    {name}: {c} consecutive days ({note})")
    else:
        print(f"  OK No employee exceeds {max_consec_limit} consecutive days")

    if rest_after_6_violations:
        print(f"  !! {len(rest_after_6_violations)} violations of '2 rest days after 6+ work days':")
        for name, streak, after_date, rest in rest_after_6_violations[:10]:
            print(f"    {name}: {streak} consecutive days, only {rest} rest day(s) after {after_date}")
    else:
        print(f"  OK '2 rest days after 6+ consecutive work days' respected")

    # -- 8. Alternating weekends (with cross-month boundary) ---------------------
    print("\n-- 8. ALTERNATING WEEKENDS --")

    # Find previous weekend (last Sat-Sun before period start) from boundary data
    prev_weekend: tuple[date | None, date | None] | None = None
    if previous_assignments:
        first_date = dates[0]
        prev_sat = None
        for offset in range(1, 8):
            d = first_date - timedelta(days=offset)
            if d.isoweekday() == 6:
                prev_sat = d
                break
        if prev_sat:
            prev_sun = prev_sat + timedelta(days=1)
            prev_weekend = (prev_sat, prev_sun)

    weekends: list[tuple[date | None, date | None]] = []
    if prev_weekend:
        weekends.append(prev_weekend)

    i = 0
    while i < len(dates):
        d = dates[i]
        if d.isoweekday() == 6:
            sat = d
            sun = dates[i + 1] if i + 1 < len(dates) and dates[i + 1].isoweekday() == 7 else None
            weekends.append((sat, sun))
            i += 2 if sun else 1
        elif d.isoweekday() == 7:
            weekends.append((None, d))
            i += 1
        else:
            i += 1

    alt_wknd_violations: list[tuple] = []
    for eid, name in emp_names.items():
        # Current period work dates
        work_dates: set[date] = set()
        for a in by_emp.get(eid, []):
            work_dates.add(date.fromisoformat(a["date"]))
        # Previous month work dates
        prev_dates = prev_work_dates_by_emp.get(eid, set())
        all_work = work_dates | prev_dates

        for wi in range(len(weekends) - 1):
            sat_k, sun_k = weekends[wi]
            sat_next, sun_next = weekends[wi + 1]
            worked_this = (sat_k and sat_k in all_work) or (sun_k and sun_k in all_work)
            worked_next = (sat_next and sat_next in all_work) or (sun_next and sun_next in all_work)
            if worked_this and worked_next:
                is_boundary = prev_weekend and weekends[wi] == prev_weekend
                alt_wknd_violations.append((name, weekends[wi], weekends[wi + 1], is_boundary))

    if alt_wknd_violations:
        boundary_count = sum(1 for _, _, _, b in alt_wknd_violations if b)
        within_count = len(alt_wknd_violations) - boundary_count
        print(f"  !! {len(alt_wknd_violations)} violations (worked consecutive weekends):")
        if boundary_count:
            print(f"     ({boundary_count} cross-month boundary, {within_count} within-month)")
        shown: dict[str, list[str]] = {}
        for name, wk1, wk2, is_boundary in alt_wknd_violations:
            marker = " [boundary]" if is_boundary else ""
            shown.setdefault(name, []).append(f"{wk1[0] or wk1[1]}{marker}")
        for name, wks in sorted(shown.items()):
            print(f"    {name}: weekends starting {', '.join(wks[:5])}")
    else:
        print(f"  OK All employees have alternating weekends free")

    # -- 9. WBL weekend limit --------------------------------------------------
    print("\n-- 9. WBL WEEKEND-DAY LIMIT (max 3) --")
    wbl_wknd_violations: list[tuple[str, int]] = []
    weekend_dates_list = [d for d in dates if d.isoweekday() in (6, 7)]
    for eid in wbl_ids:
        name = emp_names.get(eid, eid[:8])
        work_dates_set: set[date] = set()
        for a in by_emp.get(eid, []):
            work_dates_set.add(date.fromisoformat(a["date"]))
        wknd_worked = sum(1 for d in weekend_dates_list if d in work_dates_set)
        if wknd_worked > 3:
            wbl_wknd_violations.append((name, wknd_worked))
    if wbl_wknd_violations:
        print(f"  !! {len(wbl_wknd_violations)} WBL employees exceed 3 weekend-days:")
        for name, c in sorted(wbl_wknd_violations, key=lambda x: -x[1]):
            print(f"    {name}: {c} weekend-days")
    else:
        print(f"  OK All WBL employees have <=3 weekend-days")

    # -- 10. Max consecutive nights (with cross-month boundary) -----------------
    print("\n-- 10. MAX CONSECUTIVE NIGHTS --")
    max_consec_nights_limit = int(rules.get("maxConsecutiveNights", 3))
    night_violations: list[tuple[str, int, str]] = []
    for eid, name in emp_names.items():
        # Current period night dates
        night_dates: set[date] = set()
        for a in by_emp.get(eid, []):
            st = a.get("shiftType") or prof_type.get(a["shiftProfileId"], "?")
            if st == "NIGHT":
                night_dates.add(date.fromisoformat(a["date"]))
        # Previous month night dates
        prev_night_dates: set[date] = set()
        for pa in prev_by_emp.get(eid, []):
            pid = pa.get("shiftProfileId", "")
            st = prof_type.get(pid, "?")
            if st == "NIGHT":
                prev_night_dates.add(date.fromisoformat(pa["date"]))
        all_nights = night_dates | prev_night_dates
        if not all_nights:
            continue

        consec = 0
        max_n = 0
        max_n_end = ""
        for d in extended_dates:
            if d in all_nights:
                consec += 1
                if consec > max_n:
                    max_n = consec
                    max_n_end = d.isoformat()
            else:
                consec = 0
        if max_n > max_consec_nights_limit:
            boundary_note = " (cross-month)" if prev_night_dates else ""
            night_violations.append((name, max_n, f"ending {max_n_end}{boundary_note}"))

    if night_violations:
        print(f"  !! {len(night_violations)} employees exceed {max_consec_nights_limit} consecutive nights:")
        for name, c, note in sorted(night_violations, key=lambda x: -x[1]):
            print(f"    {name}: {c} consecutive nights ({note})")
    else:
        print(f"  OK No employee exceeds {max_consec_nights_limit} consecutive nights")

    # -- 11. Min rest hours between shifts --------------------------------------
    print("\n-- 11. MIN REST HOURS BETWEEN SHIFTS --")
    min_rest = float(rules.get("minRestHours", 11))
    prof_start_end: dict[str, tuple[str, str]] = {}
    for p in profiles:
        prof_start_end[p["id"]] = (p.get("startTime", "06:00"), p.get("endTime", "14:00"))

    def _time_to_minutes(t: str) -> int:
        parts = t.split(":")
        return int(parts[0]) * 60 + (int(parts[1]) if len(parts) > 1 else 0)

    rest_violations: list[tuple[str, str, str, str, float]] = []
    for eid, name in emp_names.items():
        # Combine current + previous assignments with shift times
        emp_shifts: list[tuple[date, str, str, str]] = []  # (date, profileId, start, end)
        for a in by_emp.get(eid, []):
            pid = a["shiftProfileId"]
            se = prof_start_end.get(pid, ("06:00", "14:00"))
            emp_shifts.append((date.fromisoformat(a["date"]), pid, se[0], se[1]))
        for pa in prev_by_emp.get(eid, []):
            pid = pa.get("shiftProfileId", "")
            se = prof_start_end.get(pid, ("06:00", "14:00"))
            emp_shifts.append((date.fromisoformat(pa["date"]), pid, se[0], se[1]))

        emp_shifts.sort(key=lambda x: (x[0], _time_to_minutes(x[2])))
        for i in range(len(emp_shifts) - 1):
            d1, pid1, _, end1 = emp_shifts[i]
            d2, pid2, start2, _ = emp_shifts[i + 1]
            end_min = _time_to_minutes(end1)
            start_min = _time_to_minutes(start2)
            # End time on day d1, start time on day d2
            day_diff = (d2 - d1).days
            if day_diff == 0:
                continue  # Same day, skip (shouldn't have two shifts same day normally)
            if day_diff > 1:
                continue  # More than 1 day gap, rest is fine
            # Consecutive days: rest = (24:00 - end1) + start2
            # If end time is after midnight (e.g., night shift ending at 06:00), account for it
            if end_min > start_min:
                # Night shift scenario: end1 is next morning, start2 is same day
                rest_hours = start_min / 60.0  # start2 is hours from midnight
            else:
                rest_hours = (start_min - end_min) / 60.0 + 24.0 * (day_diff - 1)
            if rest_hours < min_rest:
                rest_violations.append((
                    name,
                    d1.isoformat(),
                    prof_names.get(pid1, pid1[:8]),
                    prof_names.get(pid2, pid2[:8]),
                    rest_hours,
                ))

    if rest_violations:
        print(f"  !! {len(rest_violations)} violations (< {min_rest}h rest between shifts):")
        for name, d, p1, p2, rest_h in sorted(rest_violations, key=lambda x: x[4])[:15]:
            print(f"    {name}: {d} {p1} -> next day {p2} = {rest_h:.1f}h rest")
    else:
        print(f"  OK All shifts have >= {min_rest}h rest between them")

    # -- 12. Soll delta range --------------------------------------------------
    print("\n-- 12. SOLL DELTA RANGE (-4h to +8h) --")
    soll_range_ok = 0
    soll_range_warn: list[tuple[str, float]] = []
    for eid, name, soll, actual, delta, shifts in deviations:
        if -4 <= delta <= 8:
            soll_range_ok += 1
        else:
            soll_range_warn.append((name, delta))
    print(f"  Within range: {soll_range_ok}/{len(deviations)}")
    if soll_range_warn:
        print(f"  !! {len(soll_range_warn)} employees outside [-4h, +8h]:")
        for name, d in sorted(soll_range_warn, key=lambda x: abs(x[1]), reverse=True):
            sign = "+" if d >= 0 else ""
            print(f"    {name}: {sign}{d:.1f}h")
    else:
        print(f"  OK All employees within target range")

    # -- Summary ---------------------------------------------------------------
    print("\n" + "=" * 80)
    print("SUMMARY")
    print(f"  Staffing coverage (global): {pct:.1f}%")
    print(f"  Understaffed combos (global): {len(understaffed)}")
    print(f"  Station understaffed days: {len(station_violations_under)}")
    print(f"  Station overstaffed days: {len(station_violations_over)}")
    print(f"  Qualification gaps (station): {len(qual_violations)}")
    print(f"  Unresolved station days: {len(unplaced_days)}/{total_days}")
    print(f"  Unassigned employees: {len(unassigned)}")
    print(f"  On leave (full period): {len(on_leave)}")
    print(f"  Avg hours deviation: {sum(deltas) / len(deltas):.1f}h" if deltas else "  No soll data")
    print(f"  Soll delta in range: {soll_range_ok}/{len(deviations)}" if deviations else "")
    print(f"  BL violations: {len(non_wbl_bl)} non-WBL")
    print(f"  Consecutive day violations: {len(violations)}")
    print(f"  Consecutive night violations: {len(night_violations)}")
    print(f"  Rest-after-6 violations: {len(rest_after_6_violations)}")
    print(f"  Min rest violations: {len(rest_violations)}")
    print(f"  Alternating weekend violations: {len(alt_wknd_violations)}")
    if alt_wknd_violations:
        bnd = sum(1 for _, _, _, b in alt_wknd_violations if b)
        if bnd:
            print(f"    (of which {bnd} cross-month boundary)")
    print(f"  WBL weekend-day violations: {len(wbl_wknd_violations)}")
    print("=" * 80)
