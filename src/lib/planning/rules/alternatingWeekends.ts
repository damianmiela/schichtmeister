import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { datesInPeriodUtc, utcDayKey } from "@/lib/planning/time";

const DAY_MS = 24 * 60 * 60 * 1000;

type Weekend = { sat: Date | null; sun: Date | null };

/**
 * 4-Fenster-Wochenend-Regel: in jedem Fenster aus 4 aufeinanderfolgenden
 * Wochenenden dürfen maximal 2 gearbeitet werden.
 *
 * This is the new sliding-window form of the alternating-weekends rule.
 * Allows BOTH 1-on/1-off alternation (W-F-W-F) AND 2-on/2-off chunks (W-W-F-F
 * or F-F-W-W). Forbids 3-in-a-row AND W-W-F-W-W ("2+2 with only 1 free
 * between") — the latter has 3 worked weekends inside a 4-window.
 *
 * Cross-month: up to 3 prior weekends are read from `ctx.boundaryAssignments`
 * and counted in every 4-window that spans the period start. This replaces
 * the older pair-based logic which over-penalized the legal W-W-F-F pattern
 * and under-detected W-W-F-W / W-F-W-W problems.
 *
 * NOTE: must stay in sync with `solver/constraints/hard.py:add_alternating_weekends`
 * and `solver/scorer.py:_run` / `compute_violations`. Same rule, three places.
 */
export function alternatingWeekendsRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];

  const dates = datesInPeriodUtc(ctx.periodStart, ctx.periodEnd);
  if (dates.length === 0) return { errors, warnings: [] };

  // Build set of worked days per employee (current + boundary)
  const allAssignments = [...(ctx.boundaryAssignments ?? []), ...ctx.assignments];
  const workedByEmp = new Map<string, Set<string>>();
  for (const a of allAssignments) {
    if (ctx.targetFilter && a.employeeId !== ctx.targetFilter.employeeId) continue;
    const set = workedByEmp.get(a.employeeId) ?? new Set();
    set.add(utcDayKey(a.date));
    workedByEmp.set(a.employeeId, set);
  }

  // Extract weekends within the period
  const curWeekends: Weekend[] = [];
  let i = 0;
  while (i < dates.length) {
    const d = dates[i]!;
    const dow = d.getUTCDay(); // 0=Sun, 6=Sat
    if (dow === 6) {
      const sat = d;
      const nextDay = i + 1 < dates.length ? dates[i + 1]! : null;
      const sun = nextDay && nextDay.getUTCDay() === 0 ? nextDay : null;
      curWeekends.push({ sat, sun });
      i += sun ? 2 : 1;
    } else if (dow === 0) {
      curWeekends.push({ sat: null, sun: d });
      i += 1;
    } else {
      i += 1;
    }
  }

  if (curWeekends.length === 0) return { errors, warnings: [] };

  // Up to 3 prior weekends (walking backwards from period start)
  const firstDate = dates[0]!;
  const priorWeekends: Weekend[] = [];
  let cursor = new Date(firstDate.getTime() - DAY_MS);
  let safety = 0;
  while (priorWeekends.length < 3 && safety < 30) {
    if (cursor.getUTCDay() === 0) {
      // cursor is Sunday → previous day was Saturday
      const sat = new Date(cursor.getTime() - DAY_MS);
      priorWeekends.push({ sat, sun: cursor });
      cursor = new Date(sat.getTime() - DAY_MS);
    } else {
      cursor = new Date(cursor.getTime() - DAY_MS);
    }
    safety++;
  }
  priorWeekends.reverse(); // oldest first

  const nPrior = priorWeekends.length;
  const timeline: Weekend[] = [...priorWeekends, ...curWeekends];
  const nTotal = timeline.length;
  if (nTotal < 4) return { errors, warnings: [] };

  function workedAt(empId: string, wk: Weekend): boolean {
    const worked = workedByEmp.get(empId);
    if (!worked) return false;
    if (wk.sat && worked.has(utcDayKey(wk.sat))) return true;
    if (wk.sun && worked.has(utcDayKey(wk.sun))) return true;
    return false;
  }

  // Per-weekend day-pattern helper: returns "Sa", "So", "Sa+So", or null if free.
  function dayPattern(empId: string, wk: Weekend): "Sa" | "So" | "Sa+So" | null {
    const worked = workedByEmp.get(empId);
    if (!worked) return null;
    const sat = !!(wk.sat && worked.has(utcDayKey(wk.sat)));
    const sun = !!(wk.sun && worked.has(utcDayKey(wk.sun)));
    if (sat && sun) return "Sa+So";
    if (sat) return "Sa";
    if (sun) return "So";
    return null;
  }

  // Anchor date for a weekend (the Saturday if present, else the Sunday).
  function anchor(wk: Weekend): string {
    return wk.sat ? utcDayKey(wk.sat) : utcDayKey(wk.sun!);
  }

  // Check each employee, emitting ONE summary per affected employee.
  const employeeIds = ctx.targetFilter
    ? [ctx.targetFilter.employeeId]
    : [...ctx.employeesById.keys()];

  const totalWeekends = curWeekends.length;

  for (const empId of employeeIds) {
    const emp = ctx.employeesById.get(empId);
    if (!emp) continue;

    // Build per-weekend "worked" boolean across the full timeline
    const workedTimeline: boolean[] = timeline.map((wk) => workedAt(empId, wk));

    // Scan every 4-window; mark all worked weekends in any window with >2 worked.
    const violatingIndices = new Set<number>();
    let windowViolations = 0;
    let boundaryInvolved = false;
    for (let wStart = 0; wStart <= nTotal - 4; wStart++) {
      let count = 0;
      for (let k = 0; k < 4; k++) {
        if (workedTimeline[wStart + k]) count++;
      }
      if (count > 2) {
        windowViolations++;
        for (let k = 0; k < 4; k++) {
          if (workedTimeline[wStart + k]) {
            violatingIndices.add(wStart + k);
            if (wStart + k < nPrior) boundaryInvolved = true;
          }
        }
      }
    }

    if (windowViolations === 0) continue;

    // Build the per-current-weekend pattern list for the message.
    type WeekendInfo = {
      iso: string;
      pattern: "Sa" | "So" | "Sa+So";
      inViolation: boolean;
    };
    const workedInCur: WeekendInfo[] = [];
    for (let ti = nPrior; ti < nTotal; ti++) {
      const wk = timeline[ti]!;
      const pat = dayPattern(empId, wk);
      if (pat) {
        workedInCur.push({
          iso: anchor(wk),
          pattern: pat,
          inViolation: violatingIndices.has(ti),
        });
      }
    }
    if (workedInCur.length === 0) continue;

    const name = emp.displayName ?? empId;
    const patternStr = workedInCur
      .map((w) => `${w.iso}:${w.pattern}${w.inViolation ? "!" : ""}`)
      .join(",");
    const bFlag = boundaryInvolved ? "B" : "-";
    errors.push({
      ruleId: "alternatingWeekends",
      code: "ALTERNATING_WEEKEND_VIOLATION",
      message: ctx.targetFilter
        ? `${name}: ${workedInCur.length} von ${totalWeekends} Wochenenden gearbeitet, ${windowViolations} Verstöße [${bFlag}|${patternStr}].`
        : `${name}: weekends worked ${workedInCur.length}/${totalWeekends}, ${windowViolations} violations [${bFlag}|${patternStr}].`,
      employeeIds: [empId],
    });
  }

  return { errors, warnings: [] };
}
