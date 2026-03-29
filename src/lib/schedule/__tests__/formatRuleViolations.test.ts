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

  it("formats OVERLAP with employee name", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "noOverlap", code: "OVERLAP", message: "Employee has overlapping shift assignments.", employeeIds: ["e1"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Schichtüberlappung: Max Müller hat überlappende Schichten.");
  });

  it("formats OVERLAP with fallback when employee not in lookup", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "noOverlap", code: "OVERLAP", message: "Employee has overlapping shift assignments.", employeeIds: ["unknown-id"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result[0]).toContain("unknown-id");
  });

  it("formats OVERLAP with fallback when no employeeIds", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "noOverlap", code: "OVERLAP", message: "Employee has overlapping shift assignments." },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result[0]).toBe("Schichtüberlappung: Mitarbeiter hat überlappende Schichten.");
  });

  it("formats MISSING_PROFILE", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "noOverlap", code: "MISSING_PROFILE", message: "Shift profile not found for assignment a1." },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result[0]).toBe("Schichtüberlappung: Schichtprofil nicht gefunden.");
  });

  it("formats INSUFFICIENT_REST with employee name and message", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "minRestBetweenShifts", code: "INSUFFICIENT_REST", message: "Less than 11h rest between shifts.", employeeIds: ["e2"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result[0]).toBe("Ruhezeit unterschritten: Anna Schmidt — Less than 11h rest between shifts.");
  });

  it("formats MINI_JOB_CAP", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "miniJobMonthlyHours", code: "MINI_JOB_CAP", message: "Mini-job hours in month exceed limit (55.00h > 52h).", employeeIds: ["e1"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result[0]).toContain("Minijob-Stundengrenze");
    expect(result[0]).toContain("Max Müller");
  });

  it("formats UNDERSTAFFED without employee name", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "staffingMinimum", code: "UNDERSTAFFED", message: "Need at least 2 for EARLY station 1 on 2026-03-10 (got 1)." },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result[0]).toBe("Unterbesetzung: Need at least 2 for EARLY station 1 on 2026-03-10 (got 1).");
  });

  it("formats MISSING_QUALIFICATION without employee name", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "qualificationCoverage", code: "MISSING_QUALIFICATION", message: 'Need at least 1 employee(s) with tag "Fachkraft" for EARLY station 1 on 2026-03-10 (got 0).' },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result[0]).toContain("Qualifikation fehlt");
    expect(result[0]).toContain("Fachkraft");
  });

  it("formats MAX_CONSECUTIVE_NIGHTS", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "maxConsecutiveNights", code: "MAX_CONSECUTIVE_NIGHTS", message: "Employee has 4 consecutive night shifts (max 3).", employeeIds: ["e1"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result[0]).toBe("Max. Nachtschichten: Max Müller — Employee has 4 consecutive night shifts (max 3).");
  });

  it("formats MAX_CONSECUTIVE_DAYS", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "maxConsecutiveDays", code: "MAX_CONSECUTIVE_DAYS", message: "Employee has 8 consecutive working days (max 7).", employeeIds: ["e2"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result[0]).toContain("Max. aufeinanderfolgende Arbeitstage");
    expect(result[0]).toContain("Anna Schmidt");
  });

  it("formats INSUFFICIENT_REST_AFTER_MAX_DAYS", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "maxConsecutiveDays", code: "INSUFFICIENT_REST_AFTER_MAX_DAYS", message: "Employee works on 2026-03-15 but needs 2 rest day(s) after 7 consecutive working days.", employeeIds: ["e1"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result[0]).toContain("Max. aufeinanderfolgende Arbeitstage");
    expect(result[0]).toContain("Max Müller");
  });

  it("handles unknown rule code with default format", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "someNewRule", code: "SOME_CODE", message: "Something happened." },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result[0]).toBe("someNewRule: Something happened.");
  });

  it("handles multiple messages", () => {
    const msgs: RuleMessage[] = [
      { ruleId: "noOverlap", code: "OVERLAP", message: "overlap", employeeIds: ["e1"] },
      { ruleId: "staffingMinimum", code: "UNDERSTAFFED", message: "understaffed" },
      { ruleId: "maxConsecutiveNights", code: "MAX_CONSECUTIVE_NIGHTS", message: "too many nights", employeeIds: ["e2"] },
    ];
    const result = formatRuleViolations(msgs, empNames);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain("Schichtüberlappung");
    expect(result[1]).toContain("Unterbesetzung");
    expect(result[2]).toContain("Max. Nachtschichten");
  });
});
