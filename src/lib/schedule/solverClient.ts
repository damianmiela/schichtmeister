/**
 * CP-SAT solver client — builds the payload from DB context, calls the solver,
 * and maps the response back to Prisma assignment shapes.
 */

import type { ShiftProfile, Wish } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import { assignmentPaidHours } from "@/lib/planning/time";
import { mergePlanningRules, type FacilityRulesSlice } from "@/lib/planning/merge";
import { defaultPlanningRulesConfig } from "@/lib/planning/defaultConfig";
import type { GenEmployee, MergedStaffingEntry, ManualPlacementInput } from "./generateDraftSchedule";
import { monthlyWorkingDays, monthlySollHours } from "./generateDraftSchedule";

type BlockedDateInput = { employeeId: string; date: string };

// ── Solver request types (mirror Python models.py) ──────────────────────────

interface SolverEmployee {
  id: string;
  qualificationTags: string[];
  assignedStations: number[];
  allowedShiftProfileIds: string[];
  preferredShiftTypes: string[];
  targetHoursPercent: number | null;
  targetHours: number | null;
  targetHoursPeriod: string | null;
  contractType: string;
  miniJobMaxMonthlyHours: number | null;
  unavailableDates: string[];
  isWbl: boolean;
  isFullTimeBl: boolean;
  shiftDistribution: Record<string, number> | null;
}

interface SolverShiftProfile {
  id: string;
  name: string;
  shiftType: string;
  stationNumber: number | null;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  paidHours: number;
  isActive: boolean;
}

interface SolverStaffingRequirement {
  shiftType: string;
  stationNumber: number | null;
  minTotalCount: number;
  maxTotalCount: number | null;
  isFacilityWide: boolean;
  qualificationRequirements: { tags: string[]; minCount: number }[];
}

interface SolverWish {
  id: string;
  employeeId: string;
  date: string;
  shiftType: string | null;
  shiftProfileId: string | null;
  priority: string;
}

interface SolverManualPlacement {
  employeeId: string;
  date: string;
  shiftProfileId: string;
}

interface SolverRules {
  minRestHours: number;
  maxConsecutiveNights: number;
  maxConsecutiveDays: number;
  requiredRestDaysAfterStreak: number;
  requiredRestDaysAfter6: number;
  maxOvertimeHours: number;
  maxUndercutHours: number;
  alternatingWeekendsEnabled: boolean;
  wblMaxWeekendDays: number;
  sollMinDelta: number;
  sollMaxDelta: number;
}

export interface SolverPayload {
  schemaVersion: number;
  scheduleId: string;
  periodStart: string;
  periodEnd: string;
  maxSolveTimeSeconds: number;
  employees: SolverEmployee[];
  shiftProfiles: SolverShiftProfile[];
  staffingRequirements: SolverStaffingRequirement[];
  wishes: SolverWish[];
  manualPlacements: SolverManualPlacement[];
  blockedDates: { employeeId: string; date: string }[];
  rules: SolverRules;
  monthlyWorkingDays: number | null;
  monthlySollHoursByEmployee: Record<string, number> | null;
}

interface SolverAssignment {
  employeeId: string;
  date: string;
  shiftProfileId: string;
}

interface SolverDiagnostics {
  sollDeviation: Record<string, { soll: number; actual: number; delta: number }>;
  fairnessSpread: number | null;
  wishFulfillmentRate: number | null;
}

interface SolverResponse {
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN";
  solveTimeMs: number;
  objectiveValue: number | null;
  gap: number | null;
  modelStats: { variables: number; constraints: number; booleans: number };
  assignments: SolverAssignment[];
  unfulfilledWishes: string[];
  diagnostics: SolverDiagnostics;
  reason: string | null;
  conflictingConstraints: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function profilePaidHours(p: ShiftProfile): number {
  const refDate = new Date(Date.UTC(2026, 0, 1));
  return Math.round(assignmentPaidHours(refDate, p.startTime, p.endTime, p.breakMinutes) * 100) / 100;
}

function resolveManualPlacementProfile(
  mp: ManualPlacementInput,
  profiles: ShiftProfile[],
): string | null {
  const match = profiles.find(
    (p) => p.shiftType === mp.shiftType && p.isActive,
  );
  return match?.id ?? null;
}

// ── Payload builder ─────────────────────────────────────────────────────────

export function buildSolverPayload(
  scheduleId: string,
  periodStart: Date,
  periodEnd: Date,
  genCtx: {
    employees: GenEmployee[];
    profiles: ShiftProfile[];
    mergedStaffing: Map<string, MergedStaffingEntry>;
    wishes: Wish[];
  },
  facility: FacilityRulesSlice,
  manualPlacements: ManualPlacementInput[],
  blockedDates: BlockedDateInput[],
): SolverPayload {
  const snapshot = mergePlanningRules(facility, defaultPlanningRulesConfig);

  const maxNightsRule = snapshot.ruleStates["maxConsecutiveNights"];
  const maxDaysRule = snapshot.ruleStates["maxConsecutiveDays"];
  const altWeekendRule = snapshot.ruleStates["alternatingWeekends"];
  const wblWeekendRule = snapshot.ruleStates["wblWeekendLimit"];
  const sollDeltaRule = snapshot.ruleStates["sollDelta"];
  const restAfter6Rule = snapshot.ruleStates["restAfter6Days"];

  const rules: SolverRules = {
    minRestHours: snapshot.minRestHours,
    maxConsecutiveNights:
      maxNightsRule?.enabled
        ? (maxNightsRule.params.maxCount as number) ?? 3
        : 99,
    maxConsecutiveDays:
      maxDaysRule?.enabled
        ? (maxDaysRule.params.maxDays as number) ?? 7
        : 99,
    requiredRestDaysAfterStreak:
      maxDaysRule?.enabled
        ? (maxDaysRule.params.requiredRestDays as number) ?? 2
        : 0,
    requiredRestDaysAfter6:
      restAfter6Rule?.enabled
        ? (restAfter6Rule.params.requiredRestDays as number) ?? 2
        : 0,
    maxOvertimeHours: 8,
    maxUndercutHours: 4,
    alternatingWeekendsEnabled: altWeekendRule?.enabled ?? true,
    wblMaxWeekendDays:
      wblWeekendRule?.enabled
        ? (wblWeekendRule.params.maxWeekendDays as number) ?? 3
        : 99,
    sollMinDelta:
      sollDeltaRule?.enabled
        ? (sollDeltaRule.params.minDelta as number) ?? -4
        : -999,
    sollMaxDelta:
      sollDeltaRule?.enabled
        ? (sollDeltaRule.params.maxDelta as number) ?? 8
        : 999,
  };

  const startYear = periodStart.getUTCFullYear();
  const startMonth = periodStart.getUTCMonth();
  const wd = monthlyWorkingDays(startYear, startMonth);

  const sollByEmployee: Record<string, number> = {};
  const employees: SolverEmployee[] = genCtx.employees.map((e) => {
    if (e.targetHoursPercent != null) {
      sollByEmployee[e.id] = monthlySollHours(wd, e.targetHoursPercent);
    }
    return {
      id: e.id,
      qualificationTags: e.qualificationTags,
      assignedStations: e.assignedStations,
      allowedShiftProfileIds: [...e.allowedShiftProfileIds],
      preferredShiftTypes: e.preferredShiftTypes,
      targetHoursPercent: e.targetHoursPercent,
      targetHours: e.targetHours,
      targetHoursPeriod: e.targetHoursPeriod,
      contractType: e.contractType,
      miniJobMaxMonthlyHours: e.miniJobMaxMonthlyHours,
      unavailableDates: [...e.unavailableDateSet],
      isWbl:
        e.qualificationTags.includes("WBL") ||
        e.qualificationAbbreviations.includes("WBL"),
      isFullTimeBl: e.isFullTimeBl,
      shiftDistribution: e.shiftDistribution,
    };
  });

  const shiftProfiles: SolverShiftProfile[] = genCtx.profiles.map((p) => ({
    id: p.id,
    name: p.name,
    shiftType: p.shiftType,
    stationNumber: null,
    startTime: p.startTime,
    endTime: p.endTime,
    breakMinutes: p.breakMinutes,
    paidHours: profilePaidHours(p),
    isActive: p.isActive,
  }));

  const staffingRequirements: SolverStaffingRequirement[] = [];
  for (const [key, entry] of genCtx.mergedStaffing.entries()) {
    const [shiftType, stationStr] = key.split(":");
    const stationNumber = parseInt(stationStr, 10);
    staffingRequirements.push({
      shiftType,
      stationNumber: entry.isFacilityWide ? null : stationNumber,
      minTotalCount: entry.minTotalCount,
      maxTotalCount: entry.maxTotalCount,
      isFacilityWide: entry.isFacilityWide,
      qualificationRequirements: entry.qualificationRequirements.map((qr) => ({
        tags: [qr.qualificationTag],
        minCount: qr.minCount,
      })),
    });
  }

  const wishes: SolverWish[] = genCtx.wishes.map((w) => ({
    id: w.id,
    employeeId: w.employeeId,
    date: toIsoDateOnly(w.date),
    shiftType: w.shiftType,
    shiftProfileId: w.shiftProfileId,
    priority: w.priority,
  }));

  const solverManualPlacements: SolverManualPlacement[] = [];
  for (const mp of manualPlacements) {
    const pid = resolveManualPlacementProfile(mp, genCtx.profiles);
    if (pid) {
      solverManualPlacements.push({
        employeeId: mp.employeeId,
        date: mp.date,
        shiftProfileId: pid,
      });
    }
  }

  return {
    schemaVersion: 1,
    scheduleId,
    periodStart: toIsoDateOnly(periodStart),
    periodEnd: toIsoDateOnly(periodEnd),
    maxSolveTimeSeconds: 120,
    employees,
    shiftProfiles,
    staffingRequirements,
    wishes,
    manualPlacements: solverManualPlacements,
    blockedDates: blockedDates.map((bd) => ({
      employeeId: bd.employeeId,
      date: bd.date,
    })),
    rules,
    monthlyWorkingDays: wd,
    monthlySollHoursByEmployee:
      Object.keys(sollByEmployee).length > 0 ? sollByEmployee : null,
  };
}

// ── Solver HTTP client ──────────────────────────────────────────────────────

export class SolverError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "SolverError";
  }
}

const SOLVER_URL = process.env.SOLVER_URL ?? "http://schichtmeister-solver:8000";
const SOLVER_TIMEOUT_MS = 300_000;

export async function callSolver(payload: SolverPayload): Promise<SolverResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOLVER_TIMEOUT_MS);

  try {
    const resp = await fetch(`${SOLVER_URL}/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new SolverError(
        `Solver returned ${resp.status}: ${body.slice(0, 500)}`,
        resp.status,
        body,
      );
    }

    return (await resp.json()) as SolverResponse;
  } catch (e) {
    if (e instanceof SolverError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new SolverError("Solver-Anfrage Zeitüberschreitung (5min)", 504);
    }
    throw new SolverError(
      `Solver nicht erreichbar: ${e instanceof Error ? e.message : String(e)}`,
      503,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ── Map solver assignments → Prisma createMany ──────────────────────────────

export function assignmentsToPrismaInputs(
  solverAssignments: SolverAssignment[],
  scheduleId: string,
  userId: string,
): Prisma.AssignmentCreateManyInput[] {
  return solverAssignments.map((a) => ({
    scheduleId,
    employeeId: a.employeeId,
    date: new Date(a.date + "T00:00:00.000Z"),
    shiftProfileId: a.shiftProfileId,
    createdByUserId: userId,
  }));
}

// ── Build debug log from solver response ────────────────────────────────────

function formatSolverLog(response: SolverResponse, solverPayload: SolverPayload): string {
  const lines: string[] = [
    `=== CP-SAT Solver Run ===`,
    `Status: ${response.status}`,
    `Solve time: ${response.solveTimeMs.toFixed(1)}ms`,
    `Objective: ${response.objectiveValue ?? "N/A"}`,
    `Model: ${response.modelStats.booleans} bools, ${response.modelStats.variables} vars, ${response.modelStats.constraints} constraints`,
    `Employees: ${solverPayload.employees.length}`,
    `Shift profiles: ${solverPayload.shiftProfiles.length}`,
    `Staffing reqs: ${solverPayload.staffingRequirements.length}`,
    `Wishes: ${solverPayload.wishes.length}`,
    `Manual placements: ${solverPayload.manualPlacements.length}`,
    `Assignments created: ${response.assignments.length}`,
  ];

  if (response.reason) {
    lines.push(`Reason: ${response.reason}`);
  }

  const diag = response.diagnostics;
  if (diag.wishFulfillmentRate != null) {
    lines.push(`Wish fulfillment: ${(diag.wishFulfillmentRate * 100).toFixed(0)}%`);
  }
  if (diag.fairnessSpread != null) {
    lines.push(`Fairness spread: ${diag.fairnessSpread.toFixed(1)}h`);
  }
  if (Object.keys(diag.sollDeviation).length > 0) {
    lines.push(`--- Soll deviation ---`);
    for (const [empId, d] of Object.entries(diag.sollDeviation)) {
      lines.push(`  ${empId}: soll=${d.soll}h actual=${d.actual}h delta=${d.delta > 0 ? "+" : ""}${d.delta}h`);
    }
  }
  if (response.unfulfilledWishes.length > 0) {
    lines.push(`Unfulfilled wishes: ${response.unfulfilledWishes.join(", ")}`);
  }

  return lines.join("\n");
}

// ── High-level orchestration (called from route) ────────────────────────────

export type CpsatGenerateResult = {
  createdAssignments: number;
  manualPlacementsApplied: number;
  unmetStaffing: { date: string; shiftType: string; requested: number; assigned: number }[];
  unfulfilledWishes: { employeeId: string; date: string; shiftType: string }[];
  warnings: string[];
  debugLog: string;
};

export async function runCpsatGeneration(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  periodStart: Date,
  periodEnd: Date,
  userId: string,
  genCtx: {
    employees: GenEmployee[];
    profiles: ShiftProfile[];
    mergedStaffing: Map<string, MergedStaffingEntry>;
    wishes: Wish[];
  },
  facility: FacilityRulesSlice,
  manualPlacements: ManualPlacementInput[],
  blockedDates: BlockedDateInput[],
): Promise<CpsatGenerateResult> {
  const payload = buildSolverPayload(
    scheduleId,
    periodStart,
    periodEnd,
    genCtx,
    facility,
    manualPlacements,
    blockedDates,
  );

  const response = await callSolver(payload);

  if (response.status === "INFEASIBLE") {
    return {
      createdAssignments: 0,
      manualPlacementsApplied: 0,
      unmetStaffing: [],
      unfulfilledWishes: [],
      warnings: [
        `CP-SAT: Keine zulässige Lösung gefunden. ${response.reason ?? "Prüfen Sie Personalbesetzung und Regeln."}`,
        ...(response.conflictingConstraints.length > 0
          ? [`Konflikte: ${response.conflictingConstraints.join(", ")}`]
          : []),
      ],
      debugLog: formatSolverLog(response, payload),
    };
  }

  const prismaInputs = assignmentsToPrismaInputs(response.assignments, scheduleId, userId);

  await tx.assignment.deleteMany({ where: { scheduleId } });
  if (prismaInputs.length > 0) {
    await tx.assignment.createMany({ data: prismaInputs });
  }

  const mpApplied = manualPlacements.filter((mp) => {
    const pid = resolveManualPlacementProfile(mp, genCtx.profiles);
    return response.assignments.some(
      (a) => a.employeeId === mp.employeeId && a.date === mp.date && a.shiftProfileId === pid,
    );
  }).length;

  const warnings: string[] = [];
  if (response.status === "FEASIBLE") {
    warnings.push("CP-SAT: Zeitlimit erreicht — Lösung ist gut, aber möglicherweise nicht optimal.");
  }

  const wishMap = new Map(genCtx.wishes.map((w) => [w.id, w]));
  const unfulfilledWishes = response.unfulfilledWishes
    .map((wid) => {
      const w = wishMap.get(wid);
      if (!w) return null;
      return {
        employeeId: w.employeeId,
        date: toIsoDateOnly(w.date),
        shiftType: w.shiftType ?? "N/A",
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  return {
    createdAssignments: response.assignments.length,
    manualPlacementsApplied: mpApplied,
    unmetStaffing: [],
    unfulfilledWishes,
    warnings,
    debugLog: formatSolverLog(response, payload),
  };
}
