import { describe, it, expect } from "vitest";
import {
  classifyWarning,
  countBySeverity,
  groupWarningsBySeverity,
  highestSeverity,
  severityForCode,
} from "@/lib/schedule/warningSeverity";

describe("classifyWarning", () => {
  it("classifies empty-slot rules as red", () => {
    expect(classifyWarning("Unterbesetzung Spätdienst Station 1: 1 Tag(e) unterbesetzt — 07.05.").severity).toBe("red");
    expect(classifyWarning('Qualifikation "PFK" fehlt — Spätdienst Station 1: 1 Tag(e) betroffen — 07.05.').severity).toBe("red");
    expect(classifyWarning("Schichtüberlappung: Anna Schmidt hat eine überlappende Schichtzuweisung.").severity).toBe("red");
    expect(classifyWarning('Abwesenheitskonflikt: Max Müller ist als "K" eingetragen, hat aber Schichtzuweisungen am 07.05.').severity).toBe("red");
    expect(classifyWarning("Fehlende Schichtprofile: 2 Zuweisung(en) ohne gültiges Schichtprofil.").severity).toBe("red");
    expect(classifyWarning("Nicht erlaubtes Schichtprofil: Anna Schmidt ist einem Profil zugewiesen…").severity).toBe("red");
  });

  it("classifies legal/contractual rules as yellow", () => {
    expect(classifyWarning("Ruhezeit: Ella Weber hat einen Verstoß gegen die Mindestruhezeit von 10h zwischen Schichten.").severity).toBe("yellow");
    expect(classifyWarning("Max. Arbeitstage: Arne Maria Keller hat 8 aufeinanderfolgende Arbeitstage (max. 7 erlaubt).").severity).toBe("yellow");
    expect(classifyWarning("Max. Nachtschichten: Anna hat 5 aufeinanderfolgende Nachtschichten (max. 3 erlaubt).").severity).toBe("yellow");
    expect(classifyWarning("Wochenendregelung: Anna arbeitet an aufeinanderfolgenden Wochenenden (07.05., 14.05.).").severity).toBe("yellow");
    expect(classifyWarning("Soll-Stunden: Stefanie Kuhn hat 168h geplant, über dem Höchstbereich (Soll: 144h).").severity).toBe("yellow");
    expect(classifyWarning("Minijob-Stundengrenze: Max überschreitet das monatliche Limit (55h geplant, max. 52h erlaubt).").severity).toBe("yellow");
    expect(classifyWarning("Überstunden: Anna Schmidt hat 190.5h geplant (Soll: 176h, max. +8h Überstunden erlaubt).").severity).toBe("yellow");
    expect(classifyWarning("BL am Wochenende/Feiertag: Anna").severity).toBe("yellow");
    expect(classifyWarning("Fehlende Ruhetage: Anna arbeitet am 07.05. ohne die benötigten 2 Ruhetage…").severity).toBe("yellow");
  });

  it("classifies acceptable / informational rules as green", () => {
    expect(classifyWarning("Abdeckungslücke Station 1: 1 Tag(e) mit Lücke zwischen frühschicht und spätschicht — 07.05.").severity).toBe("green");
    expect(classifyWarning("Überbesetzung: Spätdienst Station 1 am 07.05. — 5/4 (max. 4 erlaubt).").severity).toBe("green");
  });

  it("falls back to yellow / 'Sonstiges' for unknown prefixes", () => {
    const c = classifyWarning("Etwas ganz Unbekanntes passiert hier.");
    expect(c.severity).toBe("yellow");
    expect(c.category).toBe("Sonstiges");
    expect(c.groupKey).toBe("OTHER");
  });
});

describe("highestSeverity", () => {
  it("returns red if any red present", () => {
    expect(highestSeverity([
      "Abdeckungslücke Station 1",
      "Ruhezeit: Anna…",
      "Unterbesetzung Spätdienst Station 1",
    ])).toBe("red");
  });

  it("returns yellow if no red but yellow present", () => {
    expect(highestSeverity([
      "Abdeckungslücke Station 1",
      "Ruhezeit: Anna…",
    ])).toBe("yellow");
  });

  it("returns green if only green present", () => {
    expect(highestSeverity(["Abdeckungslücke Station 1"])).toBe("green");
  });

  it("returns undefined for empty input", () => {
    expect(highestSeverity([])).toBeUndefined();
  });
});

describe("countBySeverity", () => {
  it("returns counts per tier", () => {
    const counts = countBySeverity([
      "Unterbesetzung Spätdienst Station 1",
      "Ruhezeit: Anna…",
      "Ruhezeit: Jan…",
      "Abdeckungslücke Station 1",
    ]);
    expect(counts).toEqual({ red: 1, yellow: 2, green: 1 });
  });
});

describe("groupWarningsBySeverity", () => {
  it("groups by severity and rule type", () => {
    const grouped = groupWarningsBySeverity([
      "Soll-Stunden: A hat 100h geplant…",
      "Soll-Stunden: B hat 200h geplant…",
      "Ruhezeit: C…",
    ]);
    expect(grouped.red.size).toBe(0);
    expect(grouped.yellow.get("SOLL_DELTA")?.length).toBe(2);
    expect(grouped.yellow.get("INSUFFICIENT_REST")?.length).toBe(1);
    expect(grouped.green.size).toBe(0);
  });
});

describe("severityForCode", () => {
  it("returns the correct tier for known codes", () => {
    expect(severityForCode("UNDERSTAFFED")).toBe("red");
    expect(severityForCode("MISSING_QUALIFICATION")).toBe("red");
    expect(severityForCode("INSUFFICIENT_REST")).toBe("yellow");
    expect(severityForCode("SOLL_UNDER")).toBe("yellow");
    expect(severityForCode("STATION_COVERAGE_GAP")).toBe("green");
    expect(severityForCode("OVERSTAFFED")).toBe("green");
  });

  it("falls back to yellow for unknown codes", () => {
    expect(severityForCode("UNKNOWN_RULE_NEW")).toBe("yellow");
  });
});


describe("classifier covers every aggregated card header", () => {
  // If formatRuleViolations.ts changes an aggregated header, this test catches
  // the regression where the new header no longer matches the classifier.
  const cases: Array<{ message: string; severity: "red" | "yellow" | "green" }> = [
    // Kritisch — empty slot / data conflict
    { message: "Unterbesetzung: 2 Schichten, 4 Tag(e) gesamt:",                              severity: "red" },
    { message: "Unterbesetzung Frühdienst Station 1: 1 Tag(e) unterbesetzt — 07.05.",        severity: "red" },
    { message: 'Fehlende Qualifikation: 2 Stellen, 2 Tag(e) gesamt:',                        severity: "red" },
    { message: 'Qualifikation "PFK" fehlt — Spätdienst Station 1: 1 Tag(e) betroffen — 07.05.', severity: "red" },
    { message: "Schichtüberlappung: 3 Mitarbeiter mit überlappenden Schichten:",             severity: "red" },
    { message: "Abwesenheitskonflikt: 2 Mitarbeiter mit Schichten trotz Abwesenheit:",       severity: "red" },
    { message: "Fehlende Schichtprofile: 1 Zuweisung(en) ohne gültiges Schichtprofil.",      severity: "red" },

    // Regelverstoss — legal/contractual
    { message: "Soll-Stunden: 6 Mitarbeiter außerhalb des Sollbereichs:",                    severity: "yellow" },
    { message: "Max. Arbeitstage: 3 Mitarbeiter über dem Limit:",                            severity: "yellow" },
    { message: "Ruhezeit: 2 Mitarbeiter unter Mindestruhezeit (mind. 10h):",                 severity: "yellow" },
    { message: "Wochenendregelung: 21 Mitarbeiter arbeiten an aufeinanderfolgenden Wochenenden:", severity: "yellow" },

    // Hinweise — informational
    { message: "Abdeckungslücke 3 Stationen, 19 Tag(e) gesamt:",                             severity: "green" },
  ];
  for (const { message, severity } of cases) {
    it(`classifies '${message.slice(0, 48)}…' as ${severity}`, () => {
      expect(classifyWarning(message).severity).toBe(severity);
    });
  }
});
