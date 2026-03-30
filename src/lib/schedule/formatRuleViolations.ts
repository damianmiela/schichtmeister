import type { RuleMessage } from "@/lib/planning/types";

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

  // ── OVERLAP: group by employee, count occurrences ──
  const overlapByEmp = new Map<string, number>();
  let missingProfileCount = 0;

  // ── INSUFFICIENT_REST: group by employee, count ──
  const restByEmp = new Map<string, { count: number; hours: number }>();

  // ── MINI_JOB_CAP: group by employee ──
  const miniJobByEmp = new Map<string, { total: number; limit: number }>();

  // ── UNDERSTAFFED: group by shiftType|station ──
  const staffingBuckets = new Map<string, StaffingBucket>();

  // ── MISSING_QUALIFICATION: group by tag|shiftType|station ──
  const qualBuckets = new Map<string, QualBucket>();

  // ── MAX_CONSECUTIVE_NIGHTS: group by employee, keep max streak ──
  const nightsByEmp = new Map<string, { maxStreak: number; limit: number }>();

  // ── MAX_CONSECUTIVE_DAYS: group by employee, keep max streak ──
  const daysByEmp = new Map<string, { maxStreak: number; limit: number }>();

  // ── INSUFFICIENT_REST_AFTER_MAX_DAYS: group by employee, collect dates ──
  const restAfterMaxByEmp = new Map<string, { dates: string[]; restDays: number; maxDays: number }>();

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
        const hrs = parseNumber(msg.message, /Less than (\d+)h/) ?? 11;
        const prev = restByEmp.get(empKey);
        restByEmp.set(empKey, { count: (prev?.count ?? 0) + 1, hours: hrs });
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
        const prev = daysByEmp.get(empKey);
        if (!prev || streak > prev.maxStreak) {
          daysByEmp.set(empKey, { maxStreak: streak, limit });
        }
        break;
      }
      case "PROFILE_NOT_ALLOWED": {
        const name = eName(msg.employeeIds, employeeNames);
        out.push(`Nicht erlaubtes Schichtprofil: ${name} ist einem Profil zugewiesen, das nicht in der erlaubten Liste steht.`);
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
        out.push(`Überstunden: ${name} hat ${hrs.toFixed(1)}h geplant (Soll: ${soll.toFixed(1)}h, max. +8h Überstunden erlaubt).`);
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

  for (const [empId, count] of overlapByEmp) {
    const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
    out.push(
      count === 1
        ? `Schichtüberlappung: ${name} hat eine überlappende Schichtzuweisung.`
        : `Schichtüberlappung: ${name} hat ${count} überlappende Schichtzuweisungen.`,
    );
  }

  for (const [empId, { count, hours }] of restByEmp) {
    const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
    out.push(
      count === 1
        ? `Ruhezeit: ${name} hat einen Verstoß gegen die Mindestruhezeit von ${hours}h zwischen Schichten.`
        : `Ruhezeit: ${name} hat ${count} Verstöße gegen die Mindestruhezeit von ${hours}h zwischen Schichten.`,
    );
  }

  for (const [empId, { total, limit }] of miniJobByEmp) {
    const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
    out.push(
      `Minijob-Stundengrenze: ${name} überschreitet das monatliche Limit (${total.toFixed(1)}h geplant, max. ${limit}h erlaubt).`,
    );
  }

  for (const bucket of staffingBuckets.values()) {
    const sortedDates = [...bucket.dates.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const dateList = sortedDates.map(([d]) => fmtDate(d)).join(", ");
    out.push(
      `Unterbesetzung ${shiftDe(bucket.shiftType)} Station ${bucket.station}: ` +
        `${sortedDates.length} Tag(e) unterbesetzt (min. ${bucket.min} Mitarbeiter benötigt) — ${dateList}`,
    );
  }

  for (const bucket of qualBuckets.values()) {
    const sortedDates = [...bucket.dates.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const dateList = sortedDates.map(([d]) => fmtDate(d)).join(", ");
    const tagDisplay = bucket.tag.split(",").map((t) => t.trim()).join("/");
    out.push(
      `Qualifikation "${tagDisplay}" fehlt — ${shiftDe(bucket.shiftType)} Station ${bucket.station}: ` +
        `${sortedDates.length} Tag(e) betroffen — ${dateList}`,
    );
  }

  for (const [empId, { maxStreak, limit }] of nightsByEmp) {
    const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
    out.push(
      `Max. Nachtschichten: ${name} hat ${maxStreak} aufeinanderfolgende Nachtschichten (max. ${limit} erlaubt).`,
    );
  }

  for (const [empId, { maxStreak, limit }] of daysByEmp) {
    const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
    out.push(
      `Max. Arbeitstage: ${name} hat ${maxStreak} aufeinanderfolgende Arbeitstage (max. ${limit} erlaubt).`,
    );
  }

  for (const [empId, { dates, restDays, maxDays }] of restAfterMaxByEmp) {
    const name = eName(empId === "__none__" ? undefined : [empId], employeeNames);
    const sortedDates = [...dates].sort();
    const dateList = sortedDates.map(fmtDate).join(", ");
    out.push(
      `Fehlende Ruhetage: ${name} arbeitet am ${dateList} ohne die benötigten ${restDays} Ruhetage nach ${maxDays} aufeinanderfolgenden Arbeitstagen.`,
    );
  }

  return out;
}
