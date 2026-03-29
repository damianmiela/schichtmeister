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

  it("formats single INSUFFICIENT_REST per employee", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "minRestBetweenShifts", code: "INSUFFICIENT_REST", message: "Less than 11h rest between shifts.", employeeIds: ["e2"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Ruhezeit: Anna Schmidt hat einen Verstoß gegen die Mindestruhezeit von 11h zwischen Schichten.");
  });

  it("aggregates multiple INSUFFICIENT_REST for same employee", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "minRestBetweenShifts", code: "INSUFFICIENT_REST", message: "Less than 11h rest between shifts.", employeeIds: ["e2"] },
      { ruleId: "minRestBetweenShifts", code: "INSUFFICIENT_REST", message: "Less than 11h rest between shifts.", employeeIds: ["e2"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("2 Verstöße");
    expect(result[0]).toContain("Anna Schmidt");
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
    expect(result[0]).toContain("55.0h");
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

  it("separates UNDERSTAFFED for different shift types", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "staffingMinimum", code: "UNDERSTAFFED", message: "Need at least 2 for EARLY station 1 on 2026-03-08 (got 1)." },
      { ruleId: "staffingMinimum", code: "UNDERSTAFFED", message: "Need at least 3 for NIGHT station 2 on 2026-03-09 (got 1)." },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("Frühdienst Station 1");
    expect(result[1]).toContain("Nachtdienst Station 2");
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

  it("aggregates MAX_CONSECUTIVE_DAYS to max streak per employee", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "maxConsecutiveDays", code: "MAX_CONSECUTIVE_DAYS", message: "Employee has 8 consecutive working days (max 7).", employeeIds: ["e2"] },
      { ruleId: "maxConsecutiveDays", code: "MAX_CONSECUTIVE_DAYS", message: "Employee has 9 consecutive working days (max 7).", employeeIds: ["e2"] },
      { ruleId: "maxConsecutiveDays", code: "MAX_CONSECUTIVE_DAYS", message: "Employee has 10 consecutive working days (max 7).", employeeIds: ["e2"] },
      { ruleId: "maxConsecutiveDays", code: "MAX_CONSECUTIVE_DAYS", message: "Employee has 11 consecutive working days (max 7).", employeeIds: ["e2"] },
      { ruleId: "maxConsecutiveDays", code: "MAX_CONSECUTIVE_DAYS", message: "Employee has 12 consecutive working days (max 7).", employeeIds: ["e2"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Max. Arbeitstage: Anna Schmidt hat 12 aufeinanderfolgende Arbeitstage (max. 7 erlaubt).");
  });

  it("keeps separate MAX_CONSECUTIVE_DAYS for different employees", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "maxConsecutiveDays", code: "MAX_CONSECUTIVE_DAYS", message: "Employee has 9 consecutive working days (max 7).", employeeIds: ["e1"] },
      { ruleId: "maxConsecutiveDays", code: "MAX_CONSECUTIVE_DAYS", message: "Employee has 10 consecutive working days (max 7).", employeeIds: ["e2"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("Max Müller");
    expect(result[0]).toContain("9 aufeinanderfolgende");
    expect(result[1]).toContain("Anna Schmidt");
    expect(result[1]).toContain("10 aufeinanderfolgende");
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

  // ── Unknown codes ──

  it("passes through unknown codes as-is", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "someNewRule", code: "SOME_CODE", message: "Something happened." },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result[0]).toBe("Something happened.");
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
