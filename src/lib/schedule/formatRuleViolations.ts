import type { RuleMessage } from "@/lib/planning/types";

type EmployeeLookup = Map<string, string>;

const RULE_LABEL_DE: Record<string, string> = {
  noOverlap: "Schichtüberlappung",
  minRestBetweenShifts: "Ruhezeit unterschritten",
  miniJobMonthlyHours: "Minijob-Stundengrenze",
  staffingMinimum: "Unterbesetzung",
  qualificationCoverage: "Qualifikation fehlt",
  maxConsecutiveNights: "Max. Nachtschichten",
  maxConsecutiveDays: "Max. aufeinanderfolgende Arbeitstage",
};

function empName(ids: string[] | undefined, lookup: EmployeeLookup): string {
  if (!ids || ids.length === 0) return "";
  return ids.map((id) => lookup.get(id) ?? id).join(", ");
}

export function formatRuleViolations(
  messages: RuleMessage[],
  employeeNames: EmployeeLookup,
): string[] {
  const out: string[] = [];

  for (const msg of messages) {
    const prefix = RULE_LABEL_DE[msg.ruleId] ?? msg.ruleId;
    const name = empName(msg.employeeIds, employeeNames);

    switch (msg.code) {
      case "OVERLAP":
        out.push(`${prefix}: ${name || "Mitarbeiter"} hat überlappende Schichten.`);
        break;
      case "MISSING_PROFILE":
        out.push(`${prefix}: Schichtprofil nicht gefunden.`);
        break;
      case "INSUFFICIENT_REST":
        out.push(`${prefix}: ${name || "Mitarbeiter"} — ${msg.message}`);
        break;
      case "MINI_JOB_CAP":
        out.push(`${prefix}: ${name || "Mitarbeiter"} — ${msg.message}`);
        break;
      case "UNDERSTAFFED":
        out.push(`${prefix}: ${msg.message}`);
        break;
      case "MISSING_QUALIFICATION":
        out.push(`${prefix}: ${msg.message}`);
        break;
      case "MAX_CONSECUTIVE_NIGHTS":
        out.push(`${prefix}: ${name || "Mitarbeiter"} — ${msg.message}`);
        break;
      case "MAX_CONSECUTIVE_DAYS":
      case "INSUFFICIENT_REST_AFTER_MAX_DAYS":
        out.push(`${prefix}: ${name || "Mitarbeiter"} — ${msg.message}`);
        break;
      default:
        out.push(`${prefix}: ${msg.message}`);
    }
  }

  return out;
}
