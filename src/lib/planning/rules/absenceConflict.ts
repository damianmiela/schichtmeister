import type { RuleContext, RuleResult } from "@/lib/planning/types";
import { sameUtcCalendarDay, datesInPeriodUtc } from "@/lib/planning/time";

/**
 * Prevents assigning employees who are absent (KRANK, URLAUB, etc.).
 * If an employee has an absence record covering a day, any shift assignment
 * on that day is an error.
 */
export function absenceConflictRule(ctx: RuleContext): RuleResult {
  const errors: RuleResult["errors"] = [];
  if (!ctx.absences || ctx.absences.length === 0) return { errors, warnings: [] };

  // Build a set of "employeeId|YYYY-MM-DD" for each absence day
  const absentSet = new Set<string>();
  for (const abs of ctx.absences) {
    // If targetFilter is set, only process absences for the target employee
    if (ctx.targetFilter && abs.employeeId !== ctx.targetFilter.employeeId) continue;

    const absDates = datesInPeriodUtc(abs.startDate, abs.endDate);
    for (const d of absDates) {
      const key = `${abs.employeeId}|${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      absentSet.add(key);
    }
  }

  for (const a of ctx.assignments) {
    // If targetFilter, only check the target employee
    if (ctx.targetFilter && a.employeeId !== ctx.targetFilter.employeeId) continue;

    const dk = `${a.date.getUTCFullYear()}-${String(a.date.getUTCMonth() + 1).padStart(2, "0")}-${String(a.date.getUTCDate()).padStart(2, "0")}`;
    const key = `${a.employeeId}|${dk}`;
    if (absentSet.has(key)) {
      const emp = ctx.employeesById.get(a.employeeId);
      const name = emp?.displayName ?? a.employeeId;
      // Find the absence type
      const matchingAbsence = ctx.absences.find(
        (abs) =>
          abs.employeeId === a.employeeId &&
          datesInPeriodUtc(abs.startDate, abs.endDate).some((d) => sameUtcCalendarDay(d, a.date)),
      );
      const typeDe = matchingAbsence?.type === "KRANK" ? "Krank" : matchingAbsence?.type === "URLAUB" ? "Urlaub" : matchingAbsence?.type ?? "Abwesend";
      errors.push({
        ruleId: "absenceConflict",
        code: "ABSENCE_CONFLICT",
        message: `${name}: Ist als "${typeDe}" eingetragen am ${dk}.`,
        employeeIds: [a.employeeId],
        assignmentIds: [a.id],
      });
    }
  }

  return { errors, warnings: [] };
}
