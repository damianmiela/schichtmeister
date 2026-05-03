import type { RuleMessage } from "@/lib/planning/types";

import { formatHours as fmtH } from "@/lib/schedule/viewUtils";

type EmployeeLookup = Map<string, string>;

const SHIFT_TYPE_DE: Record<string, string> = {
  EARLY: "Frühdienst",
  LATE: "Spätdienst",
  NIGHT: "Nachtdienst",
  BL: "Bereichsleitung",
};

function eName(ids: string[] | undefined, lookup: EmployeeLookup): string {
  if (!ids || ids.length === 0) return "Mitarbeiter";
  return ids.map((id) => lookup.get(id) ?? id).join(", ");
}

function fmtDate(iso: string): string {
  const parts = iso.split("-");
  if (parts.length < 3) return iso;
  return `${parts[2]}.${parts[1]}.`;
}

function shiftDe(raw: string): string {
  return SHIFT_TYPE_DE[raw] ?? raw;
}

function parseNumber(s: string, re: RegExp, group = 1): number | undefined {
  const m = re.exec(s);
  return m ? Number(m[group]) : undefined;
}

function parseString(s: string, re: RegExp, group = 1): string | undefined {
  const m = re.exec(s);
  return m?.[group];
}

// ── Aggregation helpers ─────────────────────────────────────────────

type StaffingBucket = {
  shiftType: string;
  station: number;
  min: number;
  dates: Map<string, number>; // date → got
};

type QualBucket = {
  tag: string;
  shiftType: string;
  station: number;
  min: number;
  dates: Map<string, number>;
};

export function formatRuleViolations(
  messages: RuleMessage[],
  employeeNames: EmployeeLookup,
): string[] {
  const out: string[] = [];

  // ── STATION_COVERAGE_GAP: group by station, collect dates ──
  const gapByStation = new Map<number, string[]>(); // station → list of date strings

  // ── OVERLAP: group by employee, count occurrences ──
  const overlapByEmp = new Map<string, number>();
  let missingProfileCount = 0;

  // ── INSUFFICIENT_REST: per employee, list each violation with its gap + dates ──
  type RestViolation = { gapH: number; fromIso: string; toIso: string };
  const restByEmp = new Map<string, { minHours: number; violations: RestViolation[] }>();

  // ── MINI_JOB_CAP: group by employee ──
  const miniJobByEmp = new Map<string, { total: number; limit: number }>();

  // ── UNDERSTAFFED: group by shiftType|station ──
  const staffingBuckets = new Map<string, StaffingBucket>();

  // ── MISSING_QUALIFICATION: group by tag|shiftType|station ──
  const qualBuckets = new Map<string, QualBucket>();

  // ── MAX_CONSECUTIVE_NIGHTS: group by employee, keep max streak ──
  const nightsByEmp = new Map<string, { maxStreak: number; limit: number }>();

  // ── MAX_CONSECUTIVE_DAYS: group by employee, keep longest streak + its date range ──
  const daysByEmp = new Map<string, { maxStreak: number; limit: number; fromIso?: string; toIso?: string }>();

  // ── INSUFFICIENT_REST_AFTER_MAX_DAYS: group by employee, collect dates ──
  const restAfterMaxByEmp = new Map<string, { dates: string[]; restDays: number; maxDays: number }>();

  // ── ALTERNATING_WEEKEND_VIOLATION: per-employee summary ──
  type WeekendEntry = { iso: string; pattern: string; inViolation: boolean };
  type WeekendSummary = {
    workedCount: number;
    totalWeekends: number;
    violations: number;
    /** True if last weekend of previous month was also worked. */
    boundaryWorked: boolean;
    pattern: WeekendEntry[];
  };
  const weekendByEmp = new Map<string, WeekendSummary>();

  // ── ABSENCE_CONFLICT: group by employee, collect dates ──
  const absenceByEmp = new Map<string, { dates: string[]; type: string }>();

  // ── SOLL_UNDER / SOLL_OVER: per employee ──
  const sollByEmp = new Map<string, { hours: number; soll: number; min: number; max: number; direction: "under" | "over" }>();

  for (const msg of messages) {
    const empKey = msg.employeeIds?.[0] ?? "__none__";

    switch (msg.code) {
      case "OVERLAP": {
        overlapByEmp.set(empKey, (overlapByEmp.get(empKey) ?? 0) + 1);
        break;
      }
      case "MISSING_PROFILE": {
        missingProfileCount++;
        break;
      }
      case "INSUFFICIENT_REST": {
        const minHours = parseNumber(msg.message, /Less than (\d+)h/) ?? 11;
        const gapH     = parseNumber(msg.message, /:\s*(\d+\.?\d*)h from/) ?? 0;
        const fromIso  = parseString(msg.message, /from (\d{4}-\d{2}-\d{2})/) ?? "";
        const toIso    = parseString(msg.message, /to (\d{4}-\d{2}-\d{2})/) ?? "";
        const entry = restByEmp.get(empKey) ?? { minHours, violations: [] };
        entry.minHours = minHours;
        entry.violations.push({ gapH, fromIso, toIso });
        restByEmp.set(empKey, entry);
        break;
      }
      case "MINI_JOB_CAP": {
        const total = parseNumber(msg.message, /\((\d+\.?\d*)h\s*>/) ?? 0;
        const limit = parseNumber(msg.message, />\s*(\d+\.?\d*)h\)/) ?? 0;
        miniJobByEmp.set(empKey, { total, limit });
        break;
      }
      case "UNDERSTAFFED": {
        const min = parseNumber(msg.message, /at least (\d+)/) ?? 0;
        const st = parseString(msg.message, /for (\w+) station/) ?? "";
        const stn = parseNumber(msg.message, /station (\d+)/) ?? 0;
        const date = parseString(msg.message, /on (\d{4}-\d{2}-\d{2})/) ?? "";
        const got = parseNumber(msg.message, /got (\d+)/) ?? 0;
        const bKey = `${st}|${stn}`;
        let bucket = staffingBuckets.get(bKey);
        if (!bucket) {
          bucket = { shiftType: st, station: stn, min, dates: new Map() };
          staffingBuckets.set(bKey, bucket);
        }
        bucket.dates.set(date, got);
        break;
      }
      case "MISSING_QUALIFICATION": {
        const min = parseNumber(msg.message, /at least (\d+)/) ?? 0;
        const tag = parseString(msg.message, /tag "([^"]+)"/) ?? "";
        const st = parseString(msg.message, /for (\w+) station/) ?? "";
        const stn = parseNumber(msg.message, /station (\d+)/) ?? 0;
        const date = parseString(msg.message, /on (\d{4}-\d{2}-\d{2})/) ?? "";
        const got = parseNumber(msg.message, /got (\d+)/) ?? 0;
        const bKey = `${tag}|${st}|${stn}`;
        let bucket = qualBuckets.get(bKey);
        if (!bucket) {
          bucket = { tag, shiftType: st, station: stn, min, dates: new Map() };
          qualBuckets.set(bKey, bucket);
        }
        bucket.dates.set(date, got);
        break;
      }
      case "MAX_CONSECUTIVE_NIGHTS": {
        const streak = parseNumber(msg.message, /has (\d+) consecutive/) ?? 0;
        const limit = parseNumber(msg.message, /max (\d+)/) ?? 3;
        const prev = nightsByEmp.get(empKey);
        if (!prev || streak > prev.maxStreak) {
          nightsByEmp.set(empKey, { maxStreak: streak, limit });
        }
        break;
      }
      case "MAX_CONSECUTIVE_DAYS": {
        const streak = parseNumber(msg.message, /has (\d+) consecutive/) ?? 0;
        const limit = parseNumber(msg.message, /max (\d+)/) ?? 7;
        const fromIso = parseString(msg.message, /from (\d{4}-\d{2}-\d{2})/);
        const toIso = parseString(msg.message, /to (\d{4}-\d{2}-\d{2})/);
        const prev = daysByEmp.get(empKey);
        if (!prev || streak > prev.maxStreak) {
          daysByEmp.set(empKey, { maxStreak: streak, limit, fromIso, toIso });
        }
        break;
      }
      case "PROFILE_NOT_ALLOWED": {
        const name = eName(msg.employeeIds, employeeNames);
        out.push(`Nicht erlaubtes Schichtprofil: ${name} ist einem Profil zugewiesen, das nicht in der erlaubten Liste steht.`);
        break;
      }
      case "ABSENCE_CONFLICT": {
        const date = parseString(msg.message, /am (\d{4}-\d{2}-\d{2})/) ?? "";
        const type = parseString(msg.message, /als "([^"]+)"/) ?? "Abwesend";
        const prev = absenceByEmp.get(empKey);
        if (prev) {
          if (!prev.dates.includes(date)) prev.dates.push(date);
        } else {
          absenceByEmp.set(empKey, { dates: [date], type });
        }
        break;
      }
      case "SOLL_UNDER":
      case "SOLL_OVER": {
        const hours = parseNumber(msg.message, /(\d+\.?\d*)h geplant/) ?? 0;
        const soll = parseNumber(msg.message, /Soll (\d+\.?\d*)h/) ?? 0;
        const min = parseNumber(msg.message, /min\. (\d+\.?\d*)h/) ?? 0;
        const max = parseNumber(msg.message, /max\. (\d+\.?\d*)h/) ?? 0;
        sollByEmp.set(empKey, { hours, soll, min, max, direction: msg.code === "SOLL_UNDER" ? "under" : "over" });
        break;
      }
      case "OVERSTAFFED": {
        const st = parseString(msg.message, /(\w+) station/) ?? "";
        const stn = parseNumber(msg.message, /station (\d+)/) ?? 0;
        const date = parseString(msg.message, /on (\d{4}-\d{2}-\d{2})/) ?? "";
        const got = parseNumber(msg.message, /has (\d+) employees/) ?? 0;
        const max = parseNumber(msg.message, /max (\d+)/) ?? 0;
        out.push(`Überbesetzung: ${shiftDe(st)} Station ${stn} am ${fmtDate(date)} — ${got}/${max} (max. ${max} erlaubt).`);
        break;
      }
      case "OVERTIME_EXCESS": {
        const name = eName(msg.employeeIds, employeeNames);
        const hrs = parseNumber(msg.message, /has (\d+\.?\d*)h/) ?? 0;
        const soll = parseNumber(msg.message, /Soll: (\d+\.?\d*)h/) ?? 0;
        out.push(`Überstunden: ${name} hat ${fmtH(hrs)}h geplant (Soll: ${fmtH(soll)}h, max. +8h Überstunden erlaubt).`);
        break;
      }
      case "ALTERNATING_WEEKEND_VIOLATION": {
        // New format (preferred):
        //   "<Name>: weekends worked W/T, V violations [<B|->|iso:pattern,iso:pattern!,…]."
        //   "B" = boundary weekend was also worked, "-" otherwise.
        //   "!" suffix on a pattern entry = this weekend is part of a violation pair.
        // Legacy format still tolerated: "<Name> works consecutive weekends around <iso>."
        const workedCount = parseNumber(msg.message, /worked\s+(\d+)\//) ?? 0;
        const totalWeekends = parseNumber(msg.message, /\/(\d+),/) ?? 0;
        const violations = parseNumber(msg.message, /,\s*(\d+)\s+violations?/) ?? 0;

        const bracketMatch = msg.message.match(/\[([^\]]+)\]/);
        const pattern: WeekendEntry[] = [];
        let boundaryWorked = false;
        if (bracketMatch) {
          let body = bracketMatch[1]!;
          // Optional "B|" or "-|" prefix carries the boundary flag.
          const pipeIdx = body.indexOf("|");
          if (pipeIdx >= 0 && pipeIdx <= 2) {
            boundaryWorked = body.slice(0, pipeIdx).trim() === "B";
            body = body.slice(pipeIdx + 1);
          }
          for (const entry of body.split(",")) {
            const trimmed = entry.trim();
            const idx = trimmed.indexOf(":");
            if (idx > 0) {
              let pat = trimmed.slice(idx + 1);
              const inViolation = pat.endsWith("!");
              if (inViolation) pat = pat.slice(0, -1);
              pattern.push({
                iso: trimmed.slice(0, idx),
                pattern: pat,
                inViolation,
              });
            }
          }
        }

        if (workedCount > 0 || pattern.length > 0) {
          weekendByEmp.set(empKey, {
            workedCount: workedCount || pattern.length,
            totalWeekends,
            violations,
            boundaryWorked,
            pattern,
          });
        } else {
          // Legacy: just an isolated date — fall back to a minimal summary.
          const date = parseString(msg.message, /(\d{4}-\d{2}-\d{2})/) ?? "";
          const prev = weekendByEmp.get(empKey);
          if (prev) {
            if (!prev.pattern.some((p) => p.iso === date)) {
              prev.pattern.push({ iso: date, pattern: "?", inViolation: true });
              prev.workedCount = prev.pattern.length;
            }
          } else if (date) {
            weekendByEmp.set(empKey, {
              workedCount: 1,
              totalWeekends: 0,
              violations: 1,
              boundaryWorked: false,
              pattern: [{ iso: date, pattern: "?", inViolation: true }],
            });
          }
        }
        break;
      }
      case "STATION_COVERAGE_GAP": {
        const stn = parseNumber(msg.message, /Station (\d+)/) ?? 0;
        const date = parseString(msg.message, /(\d{4}-\d{2}-\d{2})/) ?? "";
        const prev = gapByStation.get(stn);
        if (prev) {
          if (!prev.includes(date)) prev.push(date);
        } else {
          gapByStation.set(stn, [date]);
        }
        break;
      }
      case "INSUFFICIENT_REST_AFTER_MAX_DAYS": {
        const date = parseString(msg.message, /works on (\S+)/) ?? "";
        const restDays = parseNumber(msg.message, /needs (\d+) rest/) ?? 2;
        const maxDays = parseNumber(msg.message, /after (\d+) consecutive/) ?? 7;
        const prev = restAfterMaxByEmp.get(empKey);
        if (prev) {
          if (!prev.dates.includes(date)) prev.dates.push(date);
        } else {
          restAfterMaxByEmp.set(empKey, { dates: [date], restDays, maxDays });
        }
        break;
      }
      default: {
        out.push(msg.message);
      }
    }
  }

  // ── Render aggregated German warnings ──

  if (missingProfileCount > 0) {
    out.push(`Fehlende Schichtprofile: ${missingProfileCount} Zuweisung(en) ohne gültiges Schichtprofil.`);
  }

  if (overlapByEmp.size > 0) {
    const sortedEmps = [...overlapByEmp.entries()].sort(([aId], [bId]) => {
      const aName = aId === "__none__" ? "" : (employeeNames.get(aId) ?? aId);
      const bName = bId === "__none__" ? "" : (employeeNames.get(bId) ?? bId);
      return aName.localeCompare(bName, "de");
    });
    if (sortedEmps.length === 1) {
      const [empId, count] = sortedEmps[0]!;
      const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
      out.push(
        count === 1
          ? `Schichtüberlappung: ${name} hat eine überlappende Schichtzuweisung.`
          : `Schichtüberlappung: ${name} hat ${count} überlappende Schichtzuweisungen.`,
      );
    } else {
      const lines = sortedEmps.map(([empId, count]) => {
        const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
        return `• ${name}: ${count} ${count === 1 ? "Überlappung" : "Überlappungen"}`;
      });
      out.push(
        `Schichtüberlappung: ${sortedEmps.length} Mitarbeiter mit überlappenden Schichten:\n${lines.join("\n")}`,
      );
    }
  }

  // Ruhezeit: aggregate across employees when 2+ are affected. Single employee
  // renders as one line (single violation) or as a "1 employee multi-violation"
  // bullet list (existing behaviour) so the card stays compact.
  if (restByEmp.size > 0) {
    const empMinHours = (() => {
      // All entries share the same minHours in practice; pick the first.
      for (const v of restByEmp.values()) return v.minHours;
      return 11;
    })();
    const sortedEmps = [...restByEmp.entries()].sort(([aId], [bId]) => {
      const aName = aId === "__none__" ? "" : (employeeNames.get(aId) ?? aId);
      const bName = bId === "__none__" ? "" : (employeeNames.get(bId) ?? bId);
      return aName.localeCompare(bName, "de");
    });

    if (sortedEmps.length === 1) {
      const [empId, { minHours, violations }] = sortedEmps[0]!;
      const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
      const sorted = [...violations].sort((a, b) => a.fromIso.localeCompare(b.fromIso));
      if (sorted.length === 1) {
        const v = sorted[0]!;
        out.push(
          v.fromIso && v.toIso
            ? `Ruhezeit: ${name} hat nur ${fmtH(v.gapH)}h Ruhezeit zwischen ${fmtDate(v.fromIso)} und ${fmtDate(v.toIso)} (mind. ${minHours}h).`
            : `Ruhezeit: ${name} hat einen Verstoß gegen die Mindestruhezeit von ${minHours}h zwischen Schichten.`,
        );
      } else {
        // One employee, multiple violations → one bullet per violation under a header.
        const lines = sorted.map((v) =>
          v.fromIso && v.toIso
            ? `• ${fmtH(v.gapH)}h zwischen ${fmtDate(v.fromIso)} und ${fmtDate(v.toIso)}`
            : "• (Datum unbekannt)",
        );
        out.push(
          `Ruhezeit: ${name} hat ${sorted.length} Verstöße (mind. ${minHours}h):\n${lines.join("\n")}`,
        );
      }
    } else {
      // Multiple employees → one structured aggregated card.
      const lines = sortedEmps.map(([empId, { violations }]) => {
        const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
        const sorted = [...violations].sort((a, b) => a.fromIso.localeCompare(b.fromIso));
        if (sorted.length === 1) {
          const v = sorted[0]!;
          if (v.fromIso && v.toIso) {
            return `• ${name}: ${fmtH(v.gapH)}h — ${fmtDate(v.fromIso)} → ${fmtDate(v.toIso)}`;
          }
          return `• ${name}: 1 Verstoß`;
        }
        // Multiple violations for one employee within the multi-emp aggregation.
        const dateChunks = sorted.map((v) =>
          v.fromIso && v.toIso
            ? `${fmtH(v.gapH)}h ${fmtDate(v.fromIso)}→${fmtDate(v.toIso)}`
            : "?",
        );
        return `• ${name}: ${sorted.length} Verstöße — ${dateChunks.join(", ")}`;
      });
      out.push(
        `Ruhezeit: ${sortedEmps.length} Mitarbeiter unter Mindestruhezeit (mind. ${empMinHours}h):\n${lines.join("\n")}`,
      );
    }
  }

  for (const [empId, { total, limit }] of miniJobByEmp) {
    const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
    out.push(
      `Minijob-Stundengrenze: ${name} überschreitet das monatliche Limit (${fmtH(total)}h geplant, max. ${limit}h erlaubt).`,
    );
  }

  if (staffingBuckets.size > 0) {
    const sortedBuckets = [...staffingBuckets.values()].sort((a, b) => {
      const t = a.shiftType.localeCompare(b.shiftType);
      return t !== 0 ? t : a.station - b.station;
    });
    if (sortedBuckets.length === 1) {
      const bucket = sortedBuckets[0]!;
      const sortedDates = [...bucket.dates.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const dateList = sortedDates.map(([d]) => fmtDate(d)).join(", ");
      out.push(
        `Unterbesetzung ${shiftDe(bucket.shiftType)} Station ${bucket.station}: ` +
          `${sortedDates.length} Tag(e) unterbesetzt (min. ${bucket.min} Mitarbeiter benötigt) — ${dateList}`,
      );
    } else {
      const totalDays = sortedBuckets.reduce((sum, b) => sum + b.dates.size, 0);
      const lines = sortedBuckets.map((bucket) => {
        const sortedDates = [...bucket.dates.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const dateList = sortedDates.map(([d]) => fmtDate(d)).join(", ");
        return `• ${shiftDe(bucket.shiftType)} Station ${bucket.station}: ${sortedDates.length} Tag(e) — ${dateList}`;
      });
      out.push(
        `Unterbesetzung: ${sortedBuckets.length} Schichten, ${totalDays} Tag(e) gesamt:\n${lines.join("\n")}`,
      );
    }
  }

  if (qualBuckets.size > 0) {
    const sortedBuckets = [...qualBuckets.values()].sort((a, b) => {
      const t = a.tag.localeCompare(b.tag);
      if (t !== 0) return t;
      const st = a.shiftType.localeCompare(b.shiftType);
      return st !== 0 ? st : a.station - b.station;
    });
    if (sortedBuckets.length === 1) {
      const bucket = sortedBuckets[0]!;
      const sortedDates = [...bucket.dates.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const dateList = sortedDates.map(([d]) => fmtDate(d)).join(", ");
      const tagDisplay = bucket.tag.split(",").map((t) => t.trim()).join("/");
      out.push(
        `Qualifikation "${tagDisplay}" fehlt — ${shiftDe(bucket.shiftType)} Station ${bucket.station}: ` +
          `${sortedDates.length} Tag(e) betroffen — ${dateList}`,
      );
    } else {
      const totalDays = sortedBuckets.reduce((sum, b) => sum + b.dates.size, 0);
      const lines = sortedBuckets.map((bucket) => {
        const sortedDates = [...bucket.dates.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const dateList = sortedDates.map(([d]) => fmtDate(d)).join(", ");
        const tagDisplay = bucket.tag.split(",").map((t) => t.trim()).join("/");
        return `• "${tagDisplay}" — ${shiftDe(bucket.shiftType)} Station ${bucket.station}: ${sortedDates.length} Tag(e) — ${dateList}`;
      });
      out.push(
        `Fehlende Qualifikation: ${sortedBuckets.length} Stellen, ${totalDays} Tag(e) gesamt:\n${lines.join("\n")}`,
      );
    }
  }

  for (const [empId, { maxStreak, limit }] of nightsByEmp) {
    const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
    out.push(
      `Max. Nachtschichten: ${name} hat ${maxStreak} aufeinanderfolgende Nachtschichten (max. ${limit} erlaubt).`,
    );
  }

  // Max. Arbeitstage: aggregate when 2+ employees, one structured row each.
  if (daysByEmp.size > 0) {
    const sortedEmps = [...daysByEmp.entries()].sort(([aId], [bId]) => {
      const aName = aId === "__none__" ? "" : (employeeNames.get(aId) ?? aId);
      const bName = bId === "__none__" ? "" : (employeeNames.get(bId) ?? bId);
      return aName.localeCompare(bName, "de");
    });

    if (sortedEmps.length === 1) {
      const [empId, { maxStreak, limit, fromIso, toIso }] = sortedEmps[0]!;
      const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
      const range = fromIso && toIso ? ` vom ${fmtDate(fromIso)} bis ${fmtDate(toIso)}` : "";
      out.push(
        `Max. Arbeitstage: ${name} hat ${maxStreak} aufeinanderfolgende Arbeitstage${range} (max. ${limit} erlaubt).`,
      );
    } else {
      const lines = sortedEmps.map(([empId, { maxStreak, limit, fromIso, toIso }]) => {
        const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
        const range = fromIso && toIso ? `${fmtDate(fromIso)} → ${fmtDate(toIso)}` : "";
        return range
          ? `• ${name}: ${maxStreak}/${limit} Tage — ${range}`
          : `• ${name}: ${maxStreak}/${limit} Tage`;
      });
      out.push(
        `Max. Arbeitstage: ${sortedEmps.length} Mitarbeiter über dem Limit:\n${lines.join("\n")}`,
      );
    }
  }

  for (const [empId, { dates, restDays, maxDays }] of restAfterMaxByEmp) {
    const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
    const sortedDates = [...dates].sort();
    const dateList = sortedDates.map(fmtDate).join(", ");
    out.push(
      `Fehlende Ruhetage: ${name} arbeitet am ${dateList} ohne die benötigten ${restDays} Ruhetage nach ${maxDays} aufeinanderfolgenden Arbeitstagen.`,
    );
  }

  if (absenceByEmp.size > 0) {
    const sortedEmps = [...absenceByEmp.entries()].sort(([aId], [bId]) => {
      const aName = aId === "__none__" ? "" : (employeeNames.get(aId) ?? aId);
      const bName = bId === "__none__" ? "" : (employeeNames.get(bId) ?? bId);
      return aName.localeCompare(bName, "de");
    });
    if (sortedEmps.length === 1) {
      const [empId, { dates, type }] = sortedEmps[0]!;
      const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
      const sortedDates = [...dates].sort();
      const dateList = sortedDates.map(fmtDate).join(", ");
      out.push(
        `Abwesenheitskonflikt: ${name} ist als "${type}" eingetragen, hat aber Schichtzuweisungen am ${dateList}.`,
      );
    } else {
      const lines = sortedEmps.map(([empId, { dates, type }]) => {
        const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
        const sortedDates = [...dates].sort();
        const dateList = sortedDates.map(fmtDate).join(", ");
        return `• ${name}: "${type}" — ${dateList}`;
      });
      out.push(
        `Abwesenheitskonflikt: ${sortedEmps.length} Mitarbeiter mit Schichten trotz Abwesenheit:\n${lines.join("\n")}`,
      );
    }
  }

  // Soll-Stunden: aggregate when 2+ employees, one structured row each
  // showing direction + signed delta as the stats badge.
  if (sollByEmp.size > 0) {
    const sortedEmps = [...sollByEmp.entries()].sort(([aId], [bId]) => {
      const aName = aId === "__none__" ? "" : (employeeNames.get(aId) ?? aId);
      const bName = bId === "__none__" ? "" : (employeeNames.get(bId) ?? bId);
      return aName.localeCompare(bName, "de");
    });

    if (sortedEmps.length === 1) {
      const [empId, { hours, soll, direction }] = sortedEmps[0]!;
      const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
      out.push(
        direction === "under"
          ? `Soll-Stunden: ${name} hat ${fmtH(hours)}h geplant, unter dem Mindestbereich (Soll: ${fmtH(soll)}h).`
          : `Soll-Stunden: ${name} hat ${fmtH(hours)}h geplant, über dem Höchstbereich (Soll: ${fmtH(soll)}h).`,
      );
    } else {
      const lines = sortedEmps.map(([empId, { hours, soll, direction }]) => {
        const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
        const delta = hours - soll;
        const sign = delta > 0 ? "+" : "";
        const dir = direction === "under" ? "unter" : "über";
        // Stats: "über (+24h)" or "unter (-24.48h)" — concise, the chip slot.
        // Dates pills (after em-dash, comma-separated): "168h geplant", "Soll 144h"
        return `• ${name}: ${dir} (${sign}${fmtH(delta)}h) — ${fmtH(hours)}h geplant, Soll ${fmtH(soll)}h`;
      });
      out.push(
        `Soll-Stunden: ${sortedEmps.length} Mitarbeiter außerhalb des Sollbereichs:\n${lines.join("\n")}`,
      );
    }
  }

  // Aggregate ALL Wochenendregelung violations into a single multi-line warning,
  // showing per employee: ratio of worked-to-total weekends, violation count,
  // and which day(s) each weekend was worked. The drawer renders "\n" as line
  // breaks (whiteSpace: "pre-line") so the bullets keep their indentation.
  if (weekendByEmp.size > 0) {
    const sortedEmps = [...weekendByEmp.entries()].sort(([aId], [bId]) => {
      const aName = aId === "__none__" ? "" : (employeeNames.get(aId) ?? aId);
      const bName = bId === "__none__" ? "" : (employeeNames.get(bId) ?? bId);
      return aName.localeCompare(bName, "de");
    });

    // Run-based output: instead of listing every worked weekend, show only the
    // *violation runs* — sequences of consecutive worked weekends. Each run is
    // rendered as a [length] chip + a "FROM → TO" date range. If the run starts
    // from the previous month (boundary worked + first weekend adjacent), the
    // FROM is rendered as "Vor.WE".
    type WkRun = { entries: WeekendEntry[]; startsFromBoundary: boolean };
    const isoAdjacent = (a: string, b: string): boolean => {
      const ms = Math.abs(
        Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`),
      );
      return ms / (24 * 60 * 60 * 1000) <= 8;
    };
    const buildRuns = (sortedPattern: WeekendEntry[], boundaryWorked: boolean): WkRun[] => {
      const grouped: WeekendEntry[][] = [];
      let cur: WeekendEntry[] = [];
      for (let i = 0; i < sortedPattern.length; i++) {
        const e = sortedPattern[i]!;
        if (i === 0) cur = [e];
        else if (isoAdjacent(sortedPattern[i - 1]!.iso, e.iso)) cur.push(e);
        else {
          grouped.push(cur);
          cur = [e];
        }
      }
      if (cur.length > 0) grouped.push(cur);

      const runs: WkRun[] = grouped.map((entries) => ({ entries, startsFromBoundary: false }));
      // The first run starts from boundary iff the boundary weekend was worked
      // AND the first entry is marked inViolation (= adjacent to boundary).
      if (boundaryWorked && runs.length > 0 && runs[0]!.entries[0]!.inViolation) {
        runs[0]!.startsFromBoundary = true;
      }
      // Only keep runs that actually represent a violation: length ≥ 2, or
      // length 1 anchored to the boundary (which makes the *logical* length 2).
      return runs.filter((r) => r.entries.length >= 2 || r.startsFromBoundary);
    };
    const runLength = (r: WkRun): number =>
      r.entries.length + (r.startsFromBoundary ? 1 : 0);
    const runRange = (r: WkRun): string => {
      const fromTxt = r.startsFromBoundary ? "Vor.WE" : fmtDate(r.entries[0]!.iso);
      const toTxt = fmtDate(r.entries[r.entries.length - 1]!.iso);
      return `${fromTxt} → ${toTxt}`;
    };

    const fmtSummaryFor = (empId: string, sum: WeekendSummary): string | null => {
      const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
      const sortedPattern = [...sum.pattern].sort((a, b) => a.iso.localeCompare(b.iso));
      const runs = buildRuns(sortedPattern, sum.boundaryWorked);
      if (runs.length === 0) return null; // defensive: no actual run to report

      // Stats chip: e.g. "4 in Folge" or "3+2 in Folge" for multi-run.
      const lengths = runs.map(runLength);
      const inFolge = lengths.length === 1
        ? `${lengths[0]} in Folge`
        : `${lengths.join("+")} in Folge`;

      // Each run becomes a date-range pill marked "!" so the drawer renders it
      // in red — every run is by definition a violation.
      const datePills = runs.map((r) => `${runRange(r)}!`);
      return `${name}: ${inFolge} — ${datePills.join(", ")}`;
    };

    const summaries = sortedEmps
      .map(([empId, sum]) => ({ empId, summary: fmtSummaryFor(empId, sum) }))
      .filter((x): x is { empId: string; summary: string } => x.summary !== null);

    if (summaries.length === 1) {
      out.push(`Wochenendregelung: ${summaries[0]!.summary}.`);
    } else if (summaries.length > 1) {
      const lines = summaries.map((s) => `• ${s.summary}`);
      out.push(
        `Wochenendregelung: ${summaries.length} Mitarbeiter arbeiten an aufeinanderfolgenden Wochenenden:\n${lines.join("\n")}`,
      );
    }
  }

  // Aggregate Abdeckungslücke across all stations into ONE multi-line warning.
  // Each station gets a bullet line.
  if (gapByStation.size > 0) {
    const sortedStations = [...gapByStation.entries()].sort(([a], [b]) => a - b);
    if (sortedStations.length === 1) {
      const [station, dates] = sortedStations[0]!;
      const sortedDates = [...dates].sort();
      const dateList = sortedDates.map(fmtDate).join(", ");
      out.push(
        `Abdeckungslücke Station ${station}: ${sortedDates.length} Tag(e) mit Lücke zwischen frühschicht und spätschicht — ${dateList}`,
      );
    } else {
      const totalDays = sortedStations.reduce((sum, [, d]) => sum + d.length, 0);
      const lines = sortedStations.map(([station, dates]) => {
        const sortedDates = [...dates].sort();
        const dateList = sortedDates.map(fmtDate).join(", ");
        return `• Station ${station}: ${sortedDates.length} Tag(e) — ${dateList}`;
      });
      out.push(
        `Abdeckungslücke ${sortedStations.length} Stationen, ${totalDays} Tag(e) gesamt:\n${lines.join("\n")}`,
      );
    }
  }

  return out;
}
