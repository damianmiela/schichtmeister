import { registerRule } from "@/lib/planning/registry";
import { absenceConflictRule } from "@/lib/planning/rules/absenceConflict";
import { allowedShiftProfilesRule } from "@/lib/planning/rules/allowedShiftProfiles";
import { maxConsecutiveDaysRule } from "@/lib/planning/rules/maxConsecutiveDays";
import { maxConsecutiveNightsRule } from "@/lib/planning/rules/maxConsecutiveNights";
import { maxStaffingRule } from "@/lib/planning/rules/maxStaffing";
import { minRestBetweenShiftsRule } from "@/lib/planning/rules/minRestBetweenShifts";
import { miniJobMonthlyHoursRule } from "@/lib/planning/rules/miniJobMonthlyHours";
import { noOverlapRule } from "@/lib/planning/rules/noOverlap";
import { overtimeExcessRule } from "@/lib/planning/rules/overtimeExcess";
import { qualificationCoverageRule } from "@/lib/planning/rules/qualificationCoverage";
import { sollDeltaRule } from "@/lib/planning/rules/sollDelta";
import {
  fairnessCountersRule,
  targetHoursBalanceRule,
  wishFulfillmentRule,
  restAfter6DaysRule,
  alternatingWeekendsRule,
  wblWeekendLimitRule,
} from "@/lib/planning/rules/softStubs";
import { staffingMinimumRule } from "@/lib/planning/rules/staffingMinimum";
import { blWeekendHolidayRule } from "@/lib/planning/rules/blWeekendHoliday";
import { stationCoverageGapRule } from "@/lib/planning/rules/stationCoverageGap";

/** Idempotent: overwrites any prior registration for the same rule ids. */
export function registerBuiltInPlanningRules(): void {
  registerRule(
    { id: "noOverlap", severity: "hard", scope: "employee", description: "No overlapping shift assignments for the same employee." },
    noOverlapRule,
  );
  registerRule(
    { id: "minRestBetweenShifts", severity: "hard", scope: "employee", description: "Minimum rest hours between consecutive shifts for the same employee." },
    minRestBetweenShiftsRule,
  );
  registerRule(
    { id: "miniJobMonthlyHours", severity: "hard", scope: "employee", description: "Mini-job employees must not exceed their monthly hours cap." },
    miniJobMonthlyHoursRule,
  );
  registerRule(
    { id: "staffingMinimum", severity: "hard", scope: "global", description: "Minimum staff count per shift type per day must be met." },
    staffingMinimumRule,
  );
  registerRule(
    { id: "qualificationCoverage", severity: "hard", scope: "global", description: "Required qualification tags must be covered by at least one assigned employee per shift." },
    qualificationCoverageRule,
  );
  registerRule(
    { id: "absenceConflict", severity: "hard", scope: "employee", description: "Employees with absences (sick, vacation) cannot be assigned shifts." },
    absenceConflictRule,
  );
  registerRule(
    { id: "wishFulfillment", severity: "soft", scope: "global", description: "Warn when employee shift wishes are not fulfilled." },
    wishFulfillmentRule,
  );
  registerRule(
    { id: "fairnessCounters", severity: "soft", scope: "global", description: "Warn on uneven distribution of nights and weekends." },
    fairnessCountersRule,
  );
  registerRule(
    { id: "targetHoursBalance", severity: "soft", scope: "employee", description: "Warn when an employee is significantly over or under target hours." },
    targetHoursBalanceRule,
  );
  registerRule(
    { id: "maxConsecutiveNights", severity: "hard", scope: "employee", description: "Limit consecutive night shifts per employee (default 3)." },
    maxConsecutiveNightsRule,
  );
  registerRule(
    { id: "maxConsecutiveDays", severity: "hard", scope: "employee", description: "Maximale aufeinanderfolgende Arbeitstage (Standard 7, danach 2 Ruhetage)." },
    maxConsecutiveDaysRule,
  );
  registerRule(
    { id: "allowedShiftProfiles", severity: "hard", scope: "employee", description: "Employee must only be assigned to their allowed shift profiles." },
    allowedShiftProfilesRule,
  );
  registerRule(
    { id: "maxStaffing", severity: "soft", scope: "global", description: "Max staffing per shift/station must not be exceeded." },
    maxStaffingRule,
  );
  registerRule(
    { id: "overtimeExcess", severity: "soft", scope: "employee", description: "Employee hours should not exceed Soll + 8h overtime." },
    overtimeExcessRule,
  );
  registerRule(
    { id: "sollDelta", severity: "hard", scope: "employee", description: "Soll-Stunden-Abweichung: Zielbereich für alle Mitarbeiter (Standard: -4h bis +8h)." },
    sollDeltaRule,
  );
  registerRule(
    { id: "restAfter6Days", severity: "hard", scope: "employee", description: "Nach 6+ aufeinanderfolgenden Arbeitstagen sind zusätzliche Ruhetage erforderlich." },
    restAfter6DaysRule,
  );
  registerRule(
    { id: "alternatingWeekends", severity: "hard", scope: "employee", description: "Jedes zweite Wochenende muss frei sein." },
    alternatingWeekendsRule,
  );
  registerRule(
    { id: "wblWeekendLimit", severity: "hard", scope: "employee", description: "WBL-Mitarbeiter können max. 1,5 Wochenenden pro Monat arbeiten (max. 3 Wochenendtage)." },
    wblWeekendLimitRule,
  );
  registerRule(
    { id: "blWeekendHoliday", severity: "hard", scope: "employee", description: "BL-Schichten sind an Wochenenden und Feiertagen nicht erlaubt." },
    blWeekendHolidayRule,
  );
  registerRule(
    { id: "stationCoverageGap", severity: "soft", scope: "global", description: "Warnung bei Zeitlücken in der Stationsabdeckung zwischen aufeinanderfolgenden Schichten." },
    stationCoverageGapRule,
  );
}
