import { describe, it, expect } from "vitest";
import { formatRuleViolations } from "@/lib/schedule/formatRuleViolations";
import type { RuleMessage } from "@/lib/planning/types";

const empNames = new Map([
  ["e1", "Max Müller"],
  ["e2", "Anna Schmidt"],
]);

describe("formatRuleViolations", () => {
  it("returns empty array for no messages", () => {
    expect(formatRuleViolations([], empNames)).toEqual([]);
  });

  // ── OVERLAP ──

  it("formats single OVERLAP per employee", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "noOverlap", code: "OVERLAP", message: "Employee has overlapping shift assignments.", employeeIds: ["e1"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Schichtüberlappung: Max Müller hat eine überlappende Schichtzuweisung.");
  });

  it("aggregates multiple OVERLAPs for same employee", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "noOverlap", code: "OVERLAP", message: "overlap", employeeIds: ["e1"] },
      { ruleId: "noOverlap", code: "OVERLAP", message: "overlap", employeeIds: ["e1"] },
      { ruleId: "noOverlap", code: "OVERLAP", message: "overlap", employeeIds: ["e1"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Schichtüberlappung: Max Müller hat 3 überlappende Schichtzuweisungen.");
  });

  it("formats OVERLAP with fallback when no employeeIds", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "noOverlap", code: "OVERLAP", message: "overlap" },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result[0]).toContain("Mitarbeiter");
  });

  // ── MISSING_PROFILE ──

  it("aggregates MISSING_PROFILE into a single count", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "noOverlap", code: "MISSING_PROFILE", message: "not found 1" },
      { ruleId: "noOverlap", code: "MISSING_PROFILE", message: "not found 2" },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Fehlende Schichtprofile: 2 Zuweisung(en) ohne gültiges Schichtprofil.");
  });

  // ── INSUFFICIENT_REST ──

  it("falls back to short message when rule emits the legacy format (no gap+dates)", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "minRestBetweenShifts", code: "INSUFFICIENT_REST", message: "Less than 11h rest between shifts.", employeeIds: ["e2"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Ruhezeit: Anna Schmidt hat einen Verstoß gegen die Mindestruhezeit von 11h zwischen Schichten.");
  });

  it("includes actual gap + dates when the rule provides them (single violation)", () => {
    const msgs: RuleMessage[] = [
      {
        ruleId: "minRestBetweenShifts",
        code: "INSUFFICIENT_REST",
        message: "Less than 11h rest between shifts: 8.5h from 2026-05-14 to 2026-05-15.",
        employeeIds: ["e2"],
      },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(
      "Ruhezeit: Anna Schmidt hat nur 8.5h Ruhezeit zwischen 14.05. und 15.05. (mind. 11h).",
    );
  });

  it("aggregates multiple INSUFFICIENT_REST for same employee with per-violation bullets", () => {
    const msgs: RuleMessage[] = [
      {
        ruleId: "minRestBetweenShifts",
        code: "INSUFFICIENT_REST",
        message: "Less than 11h rest between shifts: 8.5h from 2026-05-14 to 2026-05-15.",
        employeeIds: ["e2"],
      },
      {
        ruleId: "minRestBetweenShifts",
        code: "INSUFFICIENT_REST",
        message: "Less than 11h rest between shifts: 9h from 2026-05-28 to 2026-05-29.",
        employeeIds: ["e2"],
      },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    const text = result[0]!;
    expect(text).toContain("Ruhezeit: Anna Schmidt hat 2 Verstöße (mind. 11h):");
    // Each violation shows up as a bullet line, sorted chronologically.
    expect(text).toContain("• 8.5h zwischen 14.05. und 15.05.");
    expect(text).toContain("• 9h zwischen 28.05. und 29.05.");
  });

  // ── MINI_JOB_CAP ──

  it("formats MINI_JOB_CAP in German with hours", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "miniJobMonthlyHours", code: "MINI_JOB_CAP", message: "Mini-job hours in month exceed limit (55.00h > 52h).", employeeIds: ["e1"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Minijob-Stundengrenze");
    expect(result[0]).toContain("Max Müller");
    expect(result[0]).toContain("55h");
    expect(result[0]).toContain("52h");
  });

  // ── UNDERSTAFFED ──

  it("aggregates UNDERSTAFFED by shift type and station with date list", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "staffingMinimum", code: "UNDERSTAFFED", message: "Need at least 2 for EARLY station 1 on 2026-03-08 (got 1)." },
      { ruleId: "staffingMinimum", code: "UNDERSTAFFED", message: "Need at least 2 for EARLY station 1 on 2026-03-10 (got 0)." },
      { ruleId: "staffingMinimum", code: "UNDERSTAFFED", message: "Need at least 2 for EARLY station 1 on 2026-03-15 (got 1)." },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Unterbesetzung Frühdienst Station 1");
    expect(result[0]).toContain("3 Tag(e) unterbesetzt");
    expect(result[0]).toContain("08.03.");
    expect(result[0]).toContain("10.03.");
    expect(result[0]).toContain("15.03.");
  });

  it("aggregates UNDERSTAFFED across shift/station buckets into ONE multi-line warning", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "staffingMinimum", code: "UNDERSTAFFED", message: "Need at least 2 for EARLY station 1 on 2026-03-08 (got 1)." },
      { ruleId: "staffingMinimum", code: "UNDERSTAFFED", message: "Need at least 3 for NIGHT station 2 on 2026-03-09 (got 1)." },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    const lines = result[0]!.split("\n");
    expect(lines[0]).toBe("Unterbesetzung: 2 Schichten, 2 Tag(e) gesamt:");
    expect(lines[1]).toContain("Frühdienst Station 1");
    expect(lines[2]).toContain("Nachtdienst Station 2");
  });

  // ── MISSING_QUALIFICATION ──

  it("aggregates MISSING_QUALIFICATION by tag/shift/station", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "qualificationCoverage", code: "MISSING_QUALIFICATION", message: 'Need at least 1 employee(s) with tag "Fachkraft" for EARLY station 1 on 2026-03-10 (got 0).' },
      { ruleId: "qualificationCoverage", code: "MISSING_QUALIFICATION", message: 'Need at least 1 employee(s) with tag "Fachkraft" for EARLY station 1 on 2026-03-11 (got 0).' },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Qualifikation "Fachkraft" fehlt');
    expect(result[0]).toContain("Frühdienst Station 1");
    expect(result[0]).toContain("2 Tag(e) betroffen");
    expect(result[0]).toContain("10.03.");
    expect(result[0]).toContain("11.03.");
  });

  it("displays multi-tag MISSING_QUALIFICATION with slash-separated tags", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "qualificationCoverage", code: "MISSING_QUALIFICATION", message: 'Need at least 2 employee(s) with tag "APH,KPH,PH" for EARLY station 1 on 2026-03-10 (got 0).' },
      { ruleId: "qualificationCoverage", code: "MISSING_QUALIFICATION", message: 'Need at least 2 employee(s) with tag "APH,KPH,PH" for EARLY station 1 on 2026-03-11 (got 1).' },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Qualifikation "APH/KPH/PH" fehlt');
    expect(result[0]).toContain("Frühdienst Station 1");
    expect(result[0]).toContain("2 Tag(e) betroffen");
  });

  // ── MAX_CONSECUTIVE_NIGHTS ──

  it("aggregates MAX_CONSECUTIVE_NIGHTS to max streak per employee", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "maxConsecutiveNights", code: "MAX_CONSECUTIVE_NIGHTS", message: "Employee has 4 consecutive night shifts (max 3).", employeeIds: ["e1"] },
      { ruleId: "maxConsecutiveNights", code: "MAX_CONSECUTIVE_NIGHTS", message: "Employee has 5 consecutive night shifts (max 3).", employeeIds: ["e1"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Max. Nachtschichten: Max Müller hat 5 aufeinanderfolgende Nachtschichten (max. 3 erlaubt).");
  });

  // ── MAX_CONSECUTIVE_DAYS ──

  it("falls back to the no-range form for legacy MAX_CONSECUTIVE_DAYS messages", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "maxConsecutiveDays", code: "MAX_CONSECUTIVE_DAYS", message: "Employee has 8 consecutive working days (max 7).", employeeIds: ["e2"] },
      { ruleId: "maxConsecutiveDays", code: "MAX_CONSECUTIVE_DAYS", message: "Employee has 12 consecutive working days (max 7).", employeeIds: ["e2"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    // Picks the longest streak; no range info available in legacy form.
    expect(result[0]).toBe("Max. Arbeitstage: Anna Schmidt hat 12 aufeinanderfolgende Arbeitstage (max. 7 erlaubt).");
  });

  it("includes the streak date range when the rule provides it", () => {
    const msgs: RuleMessage[] = [
      {
        ruleId: "maxConsecutiveDays",
        code: "MAX_CONSECUTIVE_DAYS",
        message: "Employee has 8 consecutive working days from 2026-05-02 to 2026-05-09 (max 7).",
        employeeIds: ["e1"],
      },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(
      "Max. Arbeitstage: Max Müller hat 8 aufeinanderfolgende Arbeitstage vom 02.05. bis 09.05. (max. 7 erlaubt).",
    );
  });

  it("aggregates MAX_CONSECUTIVE_DAYS across employees into ONE multi-line warning", () => {
    const msgs: RuleMessage[] = [
      {
        ruleId: "maxConsecutiveDays",
        code: "MAX_CONSECUTIVE_DAYS",
        message: "Employee has 9 consecutive working days from 2026-05-01 to 2026-05-09 (max 7).",
        employeeIds: ["e1"],
      },
      {
        ruleId: "maxConsecutiveDays",
        code: "MAX_CONSECUTIVE_DAYS",
        message: "Employee has 10 consecutive working days from 2026-05-10 to 2026-05-19 (max 7).",
        employeeIds: ["e2"],
      },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    const lines = result[0]!.split("\n");
    expect(lines[0]).toBe("Max. Arbeitstage: 2 Mitarbeiter über dem Limit:");
    // Names sorted alphabetically (Anna before Max in de locale).
    expect(lines[1]).toBe("• Anna Schmidt: 10/7 Tage — 10.05. → 19.05.");
    expect(lines[2]).toBe("• Max Müller: 9/7 Tage — 01.05. → 09.05.");
  });

  // ── INSUFFICIENT_REST_AFTER_MAX_DAYS ──

  it("aggregates INSUFFICIENT_REST_AFTER_MAX_DAYS dates per employee", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "maxConsecutiveDays", code: "INSUFFICIENT_REST_AFTER_MAX_DAYS", message: "Employee works on 2026-03-15 but needs 2 rest day(s) after 7 consecutive working days.", employeeIds: ["e1"] },
      { ruleId: "maxConsecutiveDays", code: "INSUFFICIENT_REST_AFTER_MAX_DAYS", message: "Employee works on 2026-03-16 but needs 2 rest day(s) after 7 consecutive working days.", employeeIds: ["e1"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Fehlende Ruhetage");
    expect(result[0]).toContain("Max Müller");
    expect(result[0]).toContain("15.03.");
    expect(result[0]).toContain("16.03.");
    expect(result[0]).toContain("2 Ruhetage");
    expect(result[0]).toContain("7 aufeinanderfolgenden");
  });

  // ── PROFILE_NOT_ALLOWED ──

  it("formats PROFILE_NOT_ALLOWED in German", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "allowedShiftProfiles", code: "PROFILE_NOT_ALLOWED", message: "Employee e1 assigned to profile p1 which is not in their allowed list.", employeeIds: ["e1"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Nicht erlaubtes Schichtprofil");
    expect(result[0]).toContain("Max Müller");
  });

  // ── OVERSTAFFED ──

  it("formats OVERSTAFFED in German", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "maxStaffing", code: "OVERSTAFFED", message: "EARLY station 1 on 2026-03-10 has 6 employees (max 5)." },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Überbesetzung");
    expect(result[0]).toContain("Frühdienst Station 1");
    expect(result[0]).toContain("10.03.");
    expect(result[0]).toContain("6/5");
  });

  // ── OVERTIME_EXCESS ──

  it("formats OVERTIME_EXCESS in German", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "overtimeExcess", code: "OVERTIME_EXCESS", message: "Employee e2 has 190.5h planned (Soll: 176.0h, max +8h overtime).", employeeIds: ["e2"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Überstunden: Anna Schmidt hat 190.5h geplant (Soll: 176h, max. +8h Überstunden erlaubt).");
  });

  // ── Unknown codes ──

  it("passes through unknown codes as-is", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "someNewRule", code: "SOME_CODE", message: "Something happened." },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result[0]).toBe("Something happened.");
  });

  // ── ALTERNATING_WEEKEND_VIOLATION (Wochenendregelung) ──

  it("renders single-employee summary with ratio + per-weekend pattern; '!' marks violation pills", () => {
    const msgs: RuleMessage[] = [
      {
        ruleId: "alternatingWeekends",
        code: "ALTERNATING_WEEKEND_VIOLATION",
        // New format: "[<B|->|iso:pattern[!],…]". "!" = this weekend is in a violation pair.
        // Here: all 4 are "!", boundary not worked.
        message: "Anna Schmidt: weekends worked 4/4, 3 violations [-|2026-05-02:Sa+So!,2026-05-09:Sa+So!,2026-05-16:Sa!,2026-05-23:Sa!].",
        employeeIds: ["e2"],
      },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(
      "Wochenendregelung: Anna Schmidt: 4 von 4 WE — 02.05. (Sa+So)!, 09.05. (Sa+So)!, 16.05. (Sa)!, 23.05. (Sa)!.",
    );
  });

  it("prepends '(vorher) →' boundary pill when previous month last weekend was worked", () => {
    const msgs: RuleMessage[] = [
      {
        ruleId: "alternatingWeekends",
        code: "ALTERNATING_WEEKEND_VIOLATION",
        message: "Anna Schmidt: weekends worked 1/4, 1 violations [B|2026-05-02:Sa!].",
        employeeIds: ["e2"],
      },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(
      "Wochenendregelung: Anna Schmidt: 1 von 4 WE — (vorher) →!, 02.05. (Sa)!.",
    );
  });

  it("aggregates multiple employees into ONE multi-line warning with violation-marked pills", () => {
    const msgs: RuleMessage[] = [
      {
        // Max worked 2 weekends in a row — both marked as violation pair (!).
        ruleId: "alternatingWeekends",
        code: "ALTERNATING_WEEKEND_VIOLATION",
        message: "Max Müller: weekends worked 2/4, 1 violations [-|2026-05-09:Sa!,2026-05-16:Sa+So!].",
        employeeIds: ["e1"],
      },
      {
        // Anna worked only one weekend, but boundary was also worked — boundary marker (B) flags violation.
        ruleId: "alternatingWeekends",
        code: "ALTERNATING_WEEKEND_VIOLATION",
        message: "Anna Schmidt: weekends worked 1/4, 1 violations [B|2026-05-02:Sa!].",
        employeeIds: ["e2"],
      },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    const text = result[0]!;
    const lines = text.split("\n");
    expect(lines[0]).toContain("Wochenendregelung: 2 Mitarbeiter arbeiten an aufeinanderfolgenden Wochenenden:");
    expect(lines[1]).toBe("• Anna Schmidt: 1 von 4 WE — (vorher) →!, 02.05. (Sa)!");
    expect(lines[2]).toBe("• Max Müller: 2 von 4 WE — 09.05. (Sa)!, 16.05. (Sa+So)!");
  });

  it("falls back gracefully on legacy short message", () => {
    // Legacy rule output (pre-summary): just an isolated date in the message.
    const msgs: RuleMessage[] = [
      {
        ruleId: "alternatingWeekends",
        code: "ALTERNATING_WEEKEND_VIOLATION",
        message: "Anna Schmidt works consecutive weekends around 2026-05-09.",
        employeeIds: ["e2"],
      },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Anna Schmidt");
    expect(result[0]).toContain("09.05.");
  });

  // ── STATION_COVERAGE_GAP (Abdeckungslücke) ──

  it("emits a single line when only one station has a gap", () => {
    const msgs: RuleMessage[] = [
      {
        ruleId: "stationCoverageGap",
        code: "STATION_COVERAGE_GAP",
        message: "Station 1 coverage gap on 2026-05-15.",
      },
      {
        ruleId: "stationCoverageGap",
        code: "STATION_COVERAGE_GAP",
        message: "Station 1 coverage gap on 2026-05-20.",
      },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(
      "Abdeckungslücke Station 1: 2 Tag(e) mit Lücke zwischen frühschicht und spätschicht — 15.05., 20.05.",
    );
  });

  it("aggregates Abdeckungslücke across multiple stations into ONE multi-line warning", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "stationCoverageGap", code: "STATION_COVERAGE_GAP", message: "Station 1 gap on 2026-05-15." },
      { ruleId: "stationCoverageGap", code: "STATION_COVERAGE_GAP", message: "Station 2 gap on 2026-05-15." },
      { ruleId: "stationCoverageGap", code: "STATION_COVERAGE_GAP", message: "Station 2 gap on 2026-05-20." },
      { ruleId: "stationCoverageGap", code: "STATION_COVERAGE_GAP", message: "Station 3 gap on 2026-05-15." },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    const text = result[0]!;
    const lines = text.split("\n");
    expect(lines[0]).toBe("Abdeckungslücke 3 Stationen, 4 Tag(e) gesamt:");
    expect(lines[1]).toBe("• Station 1: 1 Tag(e) — 15.05.");
    expect(lines[2]).toBe("• Station 2: 2 Tag(e) — 15.05., 20.05.");
    expect(lines[3]).toBe("• Station 3: 1 Tag(e) — 15.05.");
  });

  // ── SOLL_UNDER / SOLL_OVER aggregation ──

  it("emits a single line when only one employee has a Soll-Stunden violation", () => {
    const msgs: RuleMessage[] = [
      {
        ruleId: "sollDelta",
        code: "SOLL_OVER",
        message: "Anna Schmidt: 168h geplant, Soll 144h (max. 152h erlaubt).",
        employeeIds: ["e2"],
      },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(
      "Soll-Stunden: Anna Schmidt hat 168h geplant, über dem Höchstbereich (Soll: 144h).",
    );
  });

  it("aggregates Soll-Stunden across employees with signed delta + value pills", () => {
    const msgs: RuleMessage[] = [
      {
        ruleId: "sollDelta",
        code: "SOLL_OVER",
        message: "Anna Schmidt: 168h geplant, Soll 144h (max. 152h erlaubt).",
        employeeIds: ["e2"],
      },
      {
        ruleId: "sollDelta",
        code: "SOLL_UNDER",
        message: "Max Müller: 0h geplant, Soll 24.48h (min. 20.48h erlaubt).",
        employeeIds: ["e1"],
      },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    const lines = result[0]!.split("\n");
    expect(lines[0]).toBe("Soll-Stunden: 2 Mitarbeiter außerhalb des Sollbereichs:");
    // Names sorted alphabetically (de): Anna before Max.
    expect(lines[1]).toBe("• Anna Schmidt: über (+24h) — 168h geplant, Soll 144h");
    expect(lines[2]).toBe("• Max Müller: unter (-24.48h) — 0h geplant, Soll 24.48h");
  });

  // ── Ruhezeit aggregation across employees ──

  it("aggregates Ruhezeit across employees into ONE multi-row card", () => {
    const msgs: RuleMessage[] = [
      {
        ruleId: "minRestBetweenShifts",
        code: "INSUFFICIENT_REST",
        message: "Less than 10h rest between shifts: 8.5h from 2026-05-14 to 2026-05-15.",
        employeeIds: ["e2"],
      },
      {
        ruleId: "minRestBetweenShifts",
        code: "INSUFFICIENT_REST",
        message: "Less than 10h rest between shifts: 9h from 2026-05-28 to 2026-05-29.",
        employeeIds: ["e1"],
      },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    const lines = result[0]!.split("\n");
    expect(lines[0]).toBe("Ruhezeit: 2 Mitarbeiter unter Mindestruhezeit (mind. 10h):");
    expect(lines[1]).toBe("• Anna Schmidt: 8.5h — 14.05. → 15.05.");
    expect(lines[2]).toBe("• Max Müller: 9h — 28.05. → 29.05.");
  });

  // ── Mixed messages ──

  it("handles a mixed set of messages across rules", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "noOverlap", code: "OVERLAP", message: "overlap", employeeIds: ["e1"] },
      { ruleId: "staffingMinimum", code: "UNDERSTAFFED", message: "Need at least 2 for EARLY station 1 on 2026-03-10 (got 1)." },
      { ruleId: "maxConsecutiveNights", code: "MAX_CONSECUTIVE_NIGHTS", message: "Employee has 4 consecutive night shifts (max 3).", employeeIds: ["e2"] },
      { ruleId: "maxConsecutiveDays", code: "MAX_CONSECUTIVE_DAYS", message: "Employee has 8 consecutive working days (max 7).", employeeIds: ["e1"] },
      { ruleId: "maxConsecutiveDays", code: "MAX_CONSECUTIVE_DAYS", message: "Employee has 9 consecutive working days (max 7).", employeeIds: ["e1"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(4);
    expect(result[0]).toContain("Schichtüberlappung");
    expect(result[1]).toContain("Unterbesetzung");
    expect(result[2]).toContain("Max. Nachtschichten");
    expect(result[3]).toContain("Max. Arbeitstage");
    expect(result[3]).toContain("9 aufeinanderfolgende");
  });
});
