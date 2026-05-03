/**
 * Warning severity classification — single source of truth.
 *
 * The schedule generator and the validator emit German-language warning
 * strings (see formatRuleViolations.ts). Storage stays as `string[]` for
 * backward compatibility; this module classifies each string at render
 * time so every UI surface (drawer, toolbar badge, table headers,
 * AssignEmployeeModal) shows the same severity color/label/icon.
 *
 * The classifier matches by the German prefix that formatRuleViolations
 * always emits, so changes to that file's prefixes must be reflected here.
 */

export type WarningSeverity = "red" | "yellow" | "green";

export type ClassifiedWarning = {
  severity: WarningSeverity;
  /** Short German label used as section/group header (e.g. "Soll-Stunden"). */
  category: string;
  /** Stable internal key for grouping (one per rule type). */
  groupKey: string;
  /** The original message text, untouched. */
  message: string;
};

/**
 * Ordered list — first match wins. Each entry says: if the message
 * starts with this prefix (case-sensitive), classify it as so.
 *
 * Order matters: longer/more specific prefixes go before shorter ones
 * (e.g. "Max. Nachtschichten" before "Max. Arbeitstage" since both
 * start the same way is not the case here, but kept as a defensive habit).
 */
type Rule = {
  prefix: string;
  severity: WarningSeverity;
  category: string;
  groupKey: string;
};

const RULES: Rule[] = [
  // ── RED: empty slot or data conflict ──────────────────────────────────
  { prefix: "Unterbesetzung",            severity: "red",    category: "Unterbesetzung",           groupKey: "UNDERSTAFFED"          },
  { prefix: "Qualifikation",             severity: "red",    category: "Fehlende Qualifikation",   groupKey: "MISSING_QUALIFICATION" },
  { prefix: "Schichtüberlappung",        severity: "red",    category: "Schichtüberlappung",       groupKey: "OVERLAP"               },
  { prefix: "Abwesenheitskonflikt",      severity: "red",    category: "Abwesenheitskonflikt",     groupKey: "ABSENCE_CONFLICT"      },
  { prefix: "Fehlende Schichtprofile",   severity: "red",    category: "Datenintegrität",          groupKey: "MISSING_PROFILE"       },
  { prefix: "Nicht erlaubtes Schichtprofil", severity: "red", category: "Profil nicht erlaubt",    groupKey: "PROFILE_NOT_ALLOWED"   },

  // ── YELLOW: legal / contractual rule violation ────────────────────────
  { prefix: "Ruhezeit",                  severity: "yellow", category: "Ruhezeit",                 groupKey: "INSUFFICIENT_REST"     },
  { prefix: "Fehlende Ruhetage",         severity: "yellow", category: "Fehlende Ruhetage",        groupKey: "REST_AFTER_MAX_DAYS"   },
  { prefix: "Max. Nachtschichten",       severity: "yellow", category: "Max. Nachtschichten",      groupKey: "MAX_CONSECUTIVE_NIGHTS"},
  { prefix: "Max. Arbeitstage",          severity: "yellow", category: "Max. Arbeitstage",         groupKey: "MAX_CONSECUTIVE_DAYS"  },
  { prefix: "Wochenendregelung",         severity: "yellow", category: "Wochenendregelung",        groupKey: "ALTERNATING_WEEKEND"   },
  { prefix: "BL am Wochenende",          severity: "yellow", category: "BL Wochenende/Feiertag",   groupKey: "BL_WEEKEND_HOLIDAY"    },
  { prefix: "WBL",                       severity: "yellow", category: "WBL-Wochenend-Limit",      groupKey: "WBL_WEEKEND_LIMIT"     },
  { prefix: "Minijob-Stundengrenze",     severity: "yellow", category: "Minijob-Stundengrenze",    groupKey: "MINI_JOB_CAP"          },
  { prefix: "Soll-Stunden",              severity: "yellow", category: "Soll-Stunden",             groupKey: "SOLL_DELTA"            },
  { prefix: "Überstunden",               severity: "yellow", category: "Überstunden",              groupKey: "OVERTIME_EXCESS"       },

  // ── GREEN: informational / acceptable ─────────────────────────────────
  { prefix: "Abdeckungslücke",           severity: "green",  category: "Abdeckungslücke",          groupKey: "STATION_COVERAGE_GAP"  },
  { prefix: "Überbesetzung",             severity: "green",  category: "Überbesetzung",            groupKey: "OVERSTAFFED"           },
  { prefix: "Wunsch",                    severity: "green",  category: "Dienstwünsche",            groupKey: "WISH_FULFILLMENT"      },
  { prefix: "Fairness",                  severity: "green",  category: "Fairness",                 groupKey: "FAIRNESS"              },
];

/**
 * Classify a single German warning string into a severity tier and
 * grouping category. Falls back to yellow / "Sonstiges" if the prefix
 * doesn't match any known rule (so unknown warnings still appear, just
 * conservatively coloured).
 */
export function classifyWarning(message: string): ClassifiedWarning {
  for (const r of RULES) {
    if (message.startsWith(r.prefix)) {
      return {
        severity: r.severity,
        category: r.category,
        groupKey: r.groupKey,
        message,
      };
    }
  }
  return {
    severity: "yellow",
    category: "Sonstiges",
    groupKey: "OTHER",
    message,
  };
}

/** Fixed render order: critical first, then rule violations, then notices. */
export const SEVERITY_ORDER: readonly WarningSeverity[] = ["red", "yellow", "green"] as const;

/** Returns the highest severity present in the input, or undefined if empty. */
export function highestSeverity(messages: readonly string[]): WarningSeverity | undefined {
  if (messages.length === 0) return undefined;
  let seenYellow = false;
  let seenGreen = false;
  for (const m of messages) {
    const s = classifyWarning(m).severity;
    if (s === "red") return "red";
    if (s === "yellow") seenYellow = true;
    else if (s === "green") seenGreen = true;
  }
  return seenYellow ? "yellow" : seenGreen ? "green" : undefined;
}

/** Section title shown in the drawer (German). */
export const SEVERITY_LABEL: Record<WarningSeverity, string> = {
  red:    "Kritisch",
  yellow: "Regelverstoss",
  green:  "Hinweise",
};

/**
 * Token bag used by every UI surface so colors stay consistent.
 *  - main:   strong color (icon, badge background, section header text)
 *  - bg:     subtle tinted background for cards/sections
 *  - border: section/card border color
 *  - muiAlertSeverity: the closest MUI Alert severity (used inside modal)
 */
export const SEVERITY_TOKENS: Record<WarningSeverity, {
  main: string;
  bg: string;
  border: string;
  muiAlertSeverity: "error" | "warning" | "success";
}> = {
  red: {
    main:    "#c62828",
    bg:      "#ffebee",
    border:  "#ef9a9a",
    muiAlertSeverity: "error",
  },
  yellow: {
    main:    "#e65100",
    bg:      "#fff8e1",
    border:  "#ffcc80",
    muiAlertSeverity: "warning",
  },
  green: {
    main:    "#2e7d32",
    bg:      "#e8f5e9",
    border:  "#a5d6a7",
    muiAlertSeverity: "success",
  },
};

/** Group classified warnings by severity → category → list. */
export function groupWarningsBySeverity(
  messages: readonly string[],
): Record<WarningSeverity, Map<string, ClassifiedWarning[]>> {
  const out: Record<WarningSeverity, Map<string, ClassifiedWarning[]>> = {
    red: new Map(),
    yellow: new Map(),
    green: new Map(),
  };
  for (const m of messages) {
    const c = classifyWarning(m);
    const map = out[c.severity];
    const arr = map.get(c.groupKey) ?? [];
    arr.push(c);
    map.set(c.groupKey, arr);
  }
  return out;
}

/** Total count of warnings per severity (for badges/chips). */
export function countBySeverity(
  messages: readonly string[],
): Record<WarningSeverity, number> {
  const out: Record<WarningSeverity, number> = { red: 0, yellow: 0, green: 0 };
  for (const m of messages) out[classifyWarning(m).severity]++;
  return out;
}


/* ───────────────────────── code-based classification ─────────────────────────
 * Used by RuleViolationsList (AssignEmployeeModal) where the source data is
 * raw RuleMessage objects with a `.code` field, not formatted German strings.
 */

/** Engine RuleMessage codes → severity tier. */
export const SEVERITY_BY_CODE: Record<string, WarningSeverity> = {
  // RED
  UNDERSTAFFED:                 "red",
  MISSING_QUALIFICATION:        "red",
  OVERLAP:                      "red",
  ABSENCE_CONFLICT:             "red",
  MISSING_PROFILE:              "red",
  PROFILE_NOT_ALLOWED:          "red",
  // YELLOW
  INSUFFICIENT_REST:                "yellow",
  INSUFFICIENT_REST_AFTER_MAX_DAYS: "yellow",
  MAX_CONSECUTIVE_NIGHTS:           "yellow",
  MAX_CONSECUTIVE_DAYS:             "yellow",
  ALTERNATING_WEEKEND_VIOLATION:    "yellow",
  WBL_WEEKEND_LIMIT:                "yellow",
  BL_WEEKEND_HOLIDAY:               "yellow",
  MINI_JOB_CAP:                     "yellow",
  SOLL_UNDER:                       "yellow",
  SOLL_OVER:                        "yellow",
  OVERTIME_EXCESS:                  "yellow",
  // GREEN
  STATION_COVERAGE_GAP: "green",
  OVERSTAFFED:          "green",
  WISH_FULFILLMENT:     "green",
  FAIRNESS_COUNTERS:    "green",
  TARGET_HOURS_BALANCE: "green",
};

/** Classify by RuleMessage.code (preferred over message-prefix matching). */
export function severityForCode(code: string): WarningSeverity {
  return SEVERITY_BY_CODE[code] ?? "yellow";
}
