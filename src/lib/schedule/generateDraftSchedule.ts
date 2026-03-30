import type { PrismaClient, ShiftProfile, Wish } from "@prisma/client";
import {
  ContractType,
  EmployeeStatus,
  ShiftType,
  TargetHoursPeriod,
  WishPriority,
  WishStatus,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import { validateScheduleAssignments } from "@/lib/api/planningScheduleValidation";
import type {
  AssignmentInput,
  EmployeeInput,
  PlanningRulesSnapshot,
  QualificationRequirementInput,
  RuleContext,
  ShiftProfileInput,
  StaffingRequirementInput,
} from "@/lib/planning/types";
import { assignmentPaidHours } from "@/lib/planning/time";
import { registerBuiltInPlanningRules, runScopedRules, mergePlanningRules, defaultPlanningRulesConfig } from "@/lib/planning";

/** Deterministic shift order within a calendar day. */
export const SHIFT_TYPE_ORDER: ShiftType[] = [
  ShiftType.EARLY,
  ShiftType.LATE,
  ShiftType.NIGHT,
  ShiftType.BL,
];

const SHIFT_LABEL_DE: Record<string, string> = {
  EARLY: "Früh",
  LATE: "Spät",
  NIGHT: "Nacht",
  BL: "BL",
};

function formatDateDE(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

/** Mulberry32 — fast 32-bit seeded PRNG. Returns a function that yields [0, 1) on each call. */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple string → 32-bit integer hash (djb2). */
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

export type MergedStaffingEntry = {
  minTotalCount: number;
  maxTotalCount: number | null;
  isFacilityWide: boolean;
  qualificationRequirements: QualificationRequirementInput[];
};

/** Key for station-aware staffing lookup: `"EARLY:1"`, `"LATE:2"`, etc. */
export function staffingKey(shiftType: ShiftType, stationNumber: number): string {
  return `${shiftType}:${stationNumber}`;
}

/** Merge DB rows that share (shiftType, stationNumber) — sums counts, unions qual reqs. */
export function mergeStaffingRequirements(
  rows: {
    shiftType: ShiftType;
    stationNumber: number;
    minTotalCount: number;
    maxTotalCount?: number | null;
    isFacilityWide?: boolean;
    qualificationRequirements: { qualificationTag: string; minCount: number }[];
  }[],
): Map<string, MergedStaffingEntry> {
  const map = new Map<string, MergedStaffingEntry>();
  for (const r of rows) {
    const k = staffingKey(r.shiftType, r.stationNumber);
    const cur = map.get(k);
    if (!cur) {
      map.set(k, {
        minTotalCount: r.minTotalCount,
        maxTotalCount: r.maxTotalCount ?? null,
        isFacilityWide: r.isFacilityWide ?? false,
        qualificationRequirements: [...r.qualificationRequirements],
      });
    } else {
      const tagMap = new Map<string, number>();
      for (const q of cur.qualificationRequirements) {
        tagMap.set(q.qualificationTag, q.minCount);
      }
      for (const q of r.qualificationRequirements) {
        tagMap.set(q.qualificationTag, (tagMap.get(q.qualificationTag) ?? 0) + q.minCount);
      }
      map.set(k, {
        minTotalCount: cur.minTotalCount + r.minTotalCount,
        maxTotalCount:
          cur.maxTotalCount != null && r.maxTotalCount != null
            ? cur.maxTotalCount + r.maxTotalCount
            : (cur.maxTotalCount ?? r.maxTotalCount ?? null),
        isFacilityWide: cur.isFacilityWide || (r.isFacilityWide ?? false),
        qualificationRequirements: [...tagMap.entries()].map(([qualificationTag, minCount]) => ({ qualificationTag, minCount })),
      });
    }
  }
  return map;
}

export function eachUtcDateInPeriod(periodStart: Date, periodEnd: Date): Date[] {
  const out: Date[] = [];
  let t = Date.UTC(
    periodStart.getUTCFullYear(),
    periodStart.getUTCMonth(),
    periodStart.getUTCDate(),
  );
  const last = Date.UTC(
    periodEnd.getUTCFullYear(),
    periodEnd.getUTCMonth(),
    periodEnd.getUTCDate(),
  );
  while (t <= last) {
    out.push(new Date(t));
    t += 24 * 60 * 60 * 1000;
  }
  return out;
}

export function employeeHasAllTags(
  employeeTags: string[],
  required: string[],
): boolean {
  return required.length === 0 || required.every((t) => employeeTags.includes(t));
}

export type MinimalWish = Pick<
  Wish,
  "employeeId" | "date" | "shiftType" | "shiftProfileId" | "priority" | "status"
>;

/** Exported for tests — bonus points from open wishes for this slot. */
export function wishBonusForSlot(
  wishes: MinimalWish[],
  employeeId: string,
  dateIso: string,
  shiftType: ShiftType,
  shiftProfileId: string,
): number {
  let bonus = 0;
  for (const w of wishes) {
    if (w.status !== WishStatus.OPEN) continue;
    if (w.employeeId !== employeeId) continue;
    if (toIsoDateOnly(w.date) !== dateIso) continue;
    const strong = w.priority === WishPriority.STRONG;
    if (w.shiftProfileId && w.shiftProfileId === shiftProfileId) {
      bonus += strong ? 28 : 16;
    } else if (w.shiftType && w.shiftType === shiftType) {
      bonus += strong ? 22 : 12;
    } else if (!w.shiftType && !w.shiftProfileId) {
      bonus += strong ? 12 : 6;
    }
  }
  return bonus;
}

export function preferencePenalty(preferred: ShiftType[], shiftType: ShiftType): number {
  if (preferred.length === 0) return 0;
  return preferred.includes(shiftType) ? 0 : 5;
}

/** Soft bonus when employee is below weekly/monthly Soll (same cumulative hours input for both). */
export function schedulingTargetHoursBonus(
  targetHours: number | null,
  targetPeriod: TargetHoursPeriod | null,
  hoursAssignedSoFar: number,
): number {
  if (targetHours == null || targetPeriod == null) return 0;
  if (hoursAssignedSoFar >= targetHours) return 0;
  const slack = targetHours - hoursAssignedSoFar;
  if (targetPeriod === TargetHoursPeriod.WEEKLY) {
    return Math.min(slack, 24) * 0.75;
  }
  if (targetPeriod === TargetHoursPeriod.MONTHLY) {
    return Math.min(slack, 40) * 0.75;
  }
  return 0;
}

export type GenEmployee = {
  id: string;
  qualificationTags: string[];
  qualificationAbbreviations: string[];
  preferredShiftTypes: ShiftType[];
  targetHours: number | null;
  targetHoursPeriod: TargetHoursPeriod | null;
  targetHoursPercent: number | null;
  contractType: ContractType;
  miniJobMaxMonthlyHours: number | null;
  assignedStationNumber: number | null;
  allowedShiftProfileIds: Set<string>;
  unavailableDateSet: Set<string>;
};

/** Presence of `EmployeeAvailability` row for that calendar day -> excluded from generation. */
export function isUnavailableOnDate(emp: GenEmployee, dateIso: string): boolean {
  return emp.unavailableDateSet.has(dateIso);
}

export function sumPaidHoursForEmployeeInProposed(
  employeeId: string,
  proposed: AssignmentInput[],
  profilesById: Map<string, Pick<ShiftProfile, "startTime" | "endTime" | "breakMinutes">>,
): number {
  let sum = 0;
  for (const a of proposed) {
    if (a.employeeId !== employeeId) continue;
    const p = profilesById.get(a.shiftProfileId);
    if (!p) continue;
    sum += assignmentPaidHours(a.date, p.startTime, p.endTime, p.breakMinutes);
  }
  return sum;
}

export function monthlyWorkingDays(year: number, month: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let wd = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow !== 0 && dow !== 6) wd++;
  }
  return wd;
}

export function monthlySollHours(workingDays: number, percent: number): number {
  return workingDays * 8 * (percent / 100);
}

export function buildDefaultProfileByShiftType(
  profiles: Pick<ShiftProfile, "id" | "name" | "shiftType" | "isActive">[],
): Map<ShiftType, ShiftProfile | null> {
  const out = new Map<ShiftType, ShiftProfile | null>();
  for (const st of SHIFT_TYPE_ORDER) {
    const sorted = profiles
      .filter((p) => p.shiftType === st && p.isActive)
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
    out.set(st, (sorted[0] as ShiftProfile | undefined) ?? null);
  }
  return out;
}

export const STATION_NUMBERS = [1, 2, 3] as const;

/** Build a map from ShiftType → first active profile (alphabetical) for generation. */
export function buildDefaultProfileByType(
  profiles: ShiftProfile[],
): Map<ShiftType, ShiftProfile> {
  const out = new Map<ShiftType, ShiftProfile>();
  const sorted = [...profiles].filter((p) => p.isActive).sort((a, b) => a.name.localeCompare(b.name, "de"));
  for (const p of sorted) {
    if (!out.has(p.shiftType)) {
      out.set(p.shiftType, p);
    }
  }
  return out;
}

export function selectProfileForEmployee(
  emp: GenEmployee,
  shiftType: ShiftType,
  allProfiles: ShiftProfile[],
): ShiftProfile | null {
  const candidates = allProfiles.filter(p =>
    p.shiftType === shiftType &&
    p.isActive &&
    (emp.allowedShiftProfileIds.size === 0 || emp.allowedShiftProfileIds.has(p.id))
  );
  if (candidates.length === 0) return null;
  return candidates[0]!;
}

const JITTER_MAX = 3;

/**
 * Sort candidates by score with optional random jitter for fair tiebreaking.
 * When requiredTag is provided, only employees with that tag are returned.
 */
function sortCandidates(
  employees: GenEmployee[],
  date: Date,
  shiftType: ShiftType,
  profileId: string,
  requiredTag: string | null,
  wishes: MinimalWish[],
  proposed: AssignmentInput[],
  profilesById: Map<string, Pick<ShiftProfile, "startTime" | "endTime" | "breakMinutes">>,
  alreadyPlacedIds: Set<string>,
  stationNumber: number,
  rng?: () => number,
  shiftTypeProfileIds?: Set<string>,
): GenEmployee[] {
  const dateIso = toIsoDateOnly(date);
  const available = employees.filter(
    (e) =>
      !e.unavailableDateSet.has(dateIso) &&
      !alreadyPlacedIds.has(e.id) &&
      (e.assignedStationNumber == null || e.assignedStationNumber === stationNumber || stationNumber === 0) &&
      (e.allowedShiftProfileIds.size === 0 ||
        (shiftTypeProfileIds
          ? [...e.allowedShiftProfileIds].some((pid) => shiftTypeProfileIds.has(pid))
          : e.allowedShiftProfileIds.has(profileId))),
  );

  const pool = requiredTag
    ? (() => {
        const tags = requiredTag.split(",").map((t) => t.trim());
        return available.filter((e) => tags.some((t) => e.qualificationTags.includes(t)));
      })()
    : available;

  const scored = pool.map((e) => {
    const hours = sumPaidHoursForEmployeeInProposed(e.id, proposed, profilesById);
    const jitter = rng ? rng() * JITTER_MAX : 0;
    const score =
      wishBonusForSlot(wishes, e.id, dateIso, shiftType, profileId) +
      schedulingTargetHoursBonus(e.targetHours, e.targetHoursPeriod, hours) -
      preferencePenalty(e.preferredShiftTypes, shiftType) +
      jitter;
    return { e, score };
  });

  return scored.sort((a, b) => b.score - a.score).map((x) => x.e);
}

export type UnmetStaffingEntry = {
  date: string;
  shiftType: ShiftType;
  requested: number;
  assigned: number;
};

export type UnfulfilledWishEntry = {
  wishId: string;
  employeeId: string;
  date: string;
};

export type ManualPlacementInput = {
  employeeId: string;
  date: string;
  stationNumber: number;
  shiftType: string;
};

export type GenerateReport = {
  createdAssignments: number;
  manualPlacementsApplied: number;
  unmetStaffing: UnmetStaffingEntry[];
  unfulfilledWishes: UnfulfilledWishEntry[];
  warnings: string[];
  debugLog: string;
};

type LoaderDb = Pick<
  PrismaClient,
  "employee" | "employeeAvailability" | "employeeAbsence" | "shiftProfile" | "staffingRequirement" | "wish"
>;

export async function loadGenerateContext(
  db: LoaderDb,
  facilityId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<{
  employees: GenEmployee[];
  profiles: ShiftProfile[];
  mergedStaffing: Map<string, MergedStaffingEntry>;
  wishes: Wish[];
}> {
  const employeesRaw = await db.employee.findMany({
    where: { facilityId, status: EmployeeStatus.ACTIVE },
    include: {
      qualifications: true,
      allowedShiftProfiles: true,
      absences: {
        where: {
          startDate: { lte: periodEnd },
          endDate: { gte: periodStart },
        },
      },
    },
  });
  const ids = employeesRaw.map((e) => e.id);
  const [availability, profiles, staffingRows, wishes] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([])
      : db.employeeAvailability.findMany({
          where: {
            employeeId: { in: ids },
            date: { gte: periodStart, lte: periodEnd },
          },
        }),
    db.shiftProfile.findMany({ where: { facilityId } }),
    db.staffingRequirement.findMany({
      where: { facilityId },
      include: { qualificationRequirements: true },
    }),
    ids.length === 0
      ? Promise.resolve([])
      : db.wish.findMany({
          where: {
            employeeId: { in: ids },
            date: { gte: periodStart, lte: periodEnd },
            status: WishStatus.OPEN,
          },
        }),
  ]);

  const unavailByEmp = new Map<string, Set<string>>();
  for (const a of availability) {
    const iso = toIsoDateOnly(a.date);
    const set = unavailByEmp.get(a.employeeId) ?? new Set<string>();
    set.add(iso);
    unavailByEmp.set(a.employeeId, set);
  }

  const employees: GenEmployee[] = employeesRaw.map((e) => {
    const unavail = unavailByEmp.get(e.id) ?? new Set<string>();

    for (const abs of e.absences) {
      let t = Date.UTC(abs.startDate.getUTCFullYear(), abs.startDate.getUTCMonth(), abs.startDate.getUTCDate());
      const end = Date.UTC(abs.endDate.getUTCFullYear(), abs.endDate.getUTCMonth(), abs.endDate.getUTCDate());
      while (t <= end) {
        unavail.add(toIsoDateOnly(new Date(t)));
        t += 24 * 60 * 60 * 1000;
      }
    }

    return {
      id: e.id,
      qualificationTags: e.qualificationTags,
      qualificationAbbreviations: e.qualifications.map(q => q.abbreviation),
      preferredShiftTypes: e.preferredShiftTypes,
      targetHours: e.targetHours != null ? Number(e.targetHours) : null,
      targetHoursPeriod: e.targetHoursPeriod,
      targetHoursPercent: e.targetHoursPercent != null ? Number(e.targetHoursPercent) : null,
      contractType: e.contractType,
      miniJobMaxMonthlyHours:
        e.miniJobMaxMonthlyHours != null ? Number(e.miniJobMaxMonthlyHours) : null,
      assignedStationNumber: e.assignedStationNumber ?? null,
      allowedShiftProfileIds: new Set(e.allowedShiftProfiles.map(p => p.id)),
      unavailableDateSet: unavail,
    };
  });

  const mappedRows = staffingRows.map((r) => ({
    shiftType: r.shiftType,
    stationNumber: r.stationNumber,
    minTotalCount: r.minTotalCount,
    maxTotalCount: r.maxTotalCount ?? null,
    isFacilityWide: r.isFacilityWide,
    qualificationRequirements: r.qualificationRequirements.map((q) => ({
      qualificationTag: q.qualificationTag,
      minCount: q.minCount,
    })),
  }));

  return {
    employees,
    profiles,
    mergedStaffing: mergeStaffingRequirements(mappedRows),
    wishes,
  };
}

function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function selectFacilityWideProfile(
  emp: GenEmployee,
  shiftType: ShiftType,
  allProfiles: ShiftProfile[],
): ShiftProfile | null {
  if (shiftType === ShiftType.NIGHT) {
    const isPfk = emp.qualificationTags.includes("PFK") || emp.qualificationAbbreviations.includes("PFK");
    const targetName = isPfk ? "N" : "N1";
    const nightProfiles = allProfiles.filter(p => p.shiftType === ShiftType.NIGHT && p.isActive);
    const match = nightProfiles.find(p => p.name === targetName);
    if (match && (emp.allowedShiftProfileIds.size === 0 || emp.allowedShiftProfileIds.has(match.id))) {
      return match;
    }
  }
  return selectProfileForEmployee(emp, shiftType, allProfiles);
}

function unfulfilledOpenWishes(wishes: Wish[]): UnfulfilledWishEntry[] {
  return wishes
    .filter((w) => w.status === WishStatus.OPEN)
    .map((w) => ({
      wishId: w.id,
      employeeId: w.employeeId,
      date: toIsoDateOnly(w.date),
    }));
}

async function tryPlaceEmployee(
  emp: GenEmployee,
  date: Date,
  profileId: string,
  proposed: AssignmentInput[],
  tx: Prisma.TransactionClient,
  facilityId: string,
  schedule: { periodStart: Date; periodEnd: Date },
  idSeq: { value: number },
): Promise<AssignmentInput | null> {
  const tid = `gen:${idSeq.value++}`;
  const next: AssignmentInput[] = [
    ...proposed,
    { id: tid, date, shiftProfileId: profileId, employeeId: emp.id },
  ];
  const v = await validateScheduleAssignments(
    tx,
    facilityId,
    { periodStart: schedule.periodStart, periodEnd: schedule.periodEnd },
    next,
    { ruleScope: "employee" },
  );
  if (!v.ok || v.result.errors.length > 0) return null;
  return { id: tid, date, shiftProfileId: profileId, employeeId: emp.id };
}

const DEFAULT_BALANCE_TARGET = 160;
const REBALANCE_MAX_ROUNDS = 5;

/**
 * Post-generation optimization: swap shifts from over-utilized employees to
 * under-utilized ones, equalizing the Ist/Soll % across the workforce.
 * Operates purely in-memory; validates every swap against employee-scoped rules.
 */
export function rebalanceAssignments(
  proposed: AssignmentInput[],
  employees: GenEmployee[],
  profilesById: Map<string, ShiftProfile>,
  mergedStaffing: Map<string, MergedStaffingEntry>,
  snapshot: PlanningRulesSnapshot,
  schedule: { periodStart: Date; periodEnd: Date },
  lockedIds?: Set<string>,
): { swapsMade: number; warnings: string[] } {
  let totalSwaps = 0;
  const warnings: string[] = [];

  if (proposed.length === 0 || employees.length < 2) {
    return { swapsMade: 0, warnings };
  }

  registerBuiltInPlanningRules();

  const empById = new Map(employees.map((e) => [e.id, e]));
  const employeeInputsById = new Map<string, EmployeeInput>(
    employees.map((e) => [
      e.id,
      {
        id: e.id,
        contractType: e.contractType,
        miniJobMaxMonthlyHours: e.miniJobMaxMonthlyHours,
        qualificationTags: e.qualificationTags,
      },
    ]),
  );
  const profileInputsById = new Map<string, ShiftProfileInput>(
    [...profilesById.entries()].map(([id, p]) => [
      id,
      {
        id: p.id,
        shiftType: p.shiftType,
        startTime: p.startTime,
        endTime: p.endTime,
        breakMinutes: p.breakMinutes,
      },
    ]),
  );
  const staffingReqs: StaffingRequirementInput[] = [...mergedStaffing.entries()].map(
    ([key, entry]) => {
      const parts = key.split(":");
      return {
        shiftType: parts[0] as ShiftType,
        stationNumber: parseInt(parts[1]!, 10),
        minTotalCount: entry.minTotalCount,
        qualificationRequirements: entry.qualificationRequirements,
      };
    },
  );

  for (let round = 0; round < REBALANCE_MAX_ROUNDS; round++) {
    let swapsThisRound = 0;

    const utilMap = new Map<string, { hours: number; target: number; pct: number }>();
    for (const emp of employees) {
      const hours = sumPaidHoursForEmployeeInProposed(emp.id, proposed, profilesById);
      const target =
        emp.targetHours && emp.targetHours > 0
          ? emp.targetHours
          : DEFAULT_BALANCE_TARGET;
      utilMap.set(emp.id, { hours, target, pct: target > 0 ? hours / target : 0 });
    }

    const sorted = [...utilMap.entries()].sort((a, b) => b[1].pct - a[1].pct);
    const avgPct =
      sorted.length > 0
        ? sorted.reduce((s, [, u]) => s + u.pct, 0) / sorted.length
        : 0;

    const overList = sorted.filter(([, u]) => u.pct > avgPct + 0.05);
    const underList = [...sorted].reverse().filter(([, u]) => u.pct < avgPct - 0.05);

    if (overList.length === 0 || underList.length === 0) break;

    for (const [overEmpId, overUtil] of overList) {
      if (overUtil.pct <= avgPct + 0.05) continue;
      const overEmp = empById.get(overEmpId);
      if (!overEmp) continue;

      const overAssignments = proposed
        .map((a, idx) => ({ a, idx }))
        .filter(({ a }) => a.employeeId === overEmpId && !(lockedIds?.has(a.id)));
      overAssignments.sort((x, y) => y.a.date.getTime() - x.a.date.getTime());

      let swappedThisEmployee = false;

      for (const { a: assignment, idx } of overAssignments) {
        if (swappedThisEmployee) break;
        const profile = profilesById.get(assignment.shiftProfileId);
        if (!profile) continue;
        const dateIso = toIsoDateOnly(assignment.date);
        const staffReqEntries = [...mergedStaffing.entries()].filter(([k]) => k.startsWith(profile.shiftType + ":"));
        const staffReq = staffReqEntries.length > 0 ? staffReqEntries[0]![1] : undefined;

        for (const [underEmpId, underUtil] of underList) {
          if (underEmpId === overEmpId) continue;
          if (overUtil.pct - underUtil.pct < 0.10) continue;

          const underEmp = empById.get(underEmpId);
          if (!underEmp) continue;
          if (underEmp.unavailableDateSet.has(dateIso)) continue;
          if (underEmp.assignedStationNumber != null || overEmp.assignedStationNumber != null) {
            const overSt = overEmp.assignedStationNumber;
            const underSt = underEmp.assignedStationNumber;
            if (overSt != null && underSt != null && overSt !== underSt) continue;
            if (underSt != null && overSt == null) continue;
          }

          if (underEmp.allowedShiftProfileIds.size > 0 && !underEmp.allowedShiftProfileIds.has(assignment.shiftProfileId)) continue;

          const alreadyOnSameType = proposed.some(
            (a2) =>
              a2.employeeId === underEmpId &&
              toIsoDateOnly(a2.date) === dateIso &&
              profilesById.get(a2.shiftProfileId)?.shiftType === profile.shiftType,
          );
          if (alreadyOnSameType) continue;

          if (staffReq) {
            let qualOk = true;
            for (const qr of staffReq.qualificationRequirements) {
              const tags = qr.qualificationTag.split(",").map((t) => t.trim());
              const overHasTag = tags.some((t) => overEmp.qualificationTags.includes(t));
              if (!overHasTag) continue;
              const othersWithTag = proposed.filter(
                (a2) =>
                  a2.employeeId !== overEmpId &&
                  toIsoDateOnly(a2.date) === dateIso &&
                  a2.shiftProfileId === assignment.shiftProfileId &&
                  (() => {
                    const empTags = empById.get(a2.employeeId)?.qualificationTags;
                    return empTags && tags.some((t) => empTags.includes(t));
                  })(),
              ).length;
              const underHasTag = tags.some((t) => underEmp.qualificationTags.includes(t));
              if (othersWithTag < qr.minCount && !underHasTag) {
                qualOk = false;
                break;
              }
            }
            if (!qualOk) continue;
          }

          const origEmployeeId = proposed[idx]!.employeeId;
          proposed[idx] = { ...proposed[idx]!, employeeId: underEmpId };

          const relevant = proposed.filter(
            (a) => a.employeeId === overEmpId || a.employeeId === underEmpId,
          );
          const ruleCtx: RuleContext = {
            periodStart: schedule.periodStart,
            periodEnd: schedule.periodEnd,
            assignments: relevant,
            employeesById: employeeInputsById,
            profilesById: profileInputsById,
            staffingRequirements: staffingReqs,
            wishes: [],
            snapshot,
          };
          const { errors } = runScopedRules(ruleCtx, "employee");

          if (errors.length === 0) {
            const shiftHours = assignmentPaidHours(
              assignment.date,
              profile.startTime,
              profile.endTime,
              profile.breakMinutes,
            );
            overUtil.hours -= shiftHours;
            overUtil.pct = overUtil.target > 0 ? overUtil.hours / overUtil.target : 0;
            underUtil.hours += shiftHours;
            underUtil.pct =
              underUtil.target > 0 ? underUtil.hours / underUtil.target : 0;
            swapsThisRound++;
            swappedThisEmployee = true;
            break;
          } else {
            proposed[idx] = { ...proposed[idx]!, employeeId: origEmployeeId };
          }
        }
      }
    }

    totalSwaps += swapsThisRound;
    if (swapsThisRound === 0) break;
  }

  return { swapsMade: totalSwaps, warnings };
}

/**
 * Three-pass greedy fill: ascending dates, EARLY->LATE->NIGHT->BL.
 * Pass 1: fill qualification-required slots (tag-specific candidates only).
 * Pass 2: fill remaining general slots up to minTotalCount.
 * Pass 3: fill up to maxTotalCount for employees who need more hours.
 */
export type BlockedDateInput = { employeeId: string; date: string };

export async function runGreedyScheduleGeneration(
  tx: Prisma.TransactionClient,
  facilityId: string,
  schedule: { id: string; periodStart: Date; periodEnd: Date },
  userId: string,
  ctx: Awaited<ReturnType<typeof loadGenerateContext>>,
  manualPlacements?: ManualPlacementInput[],
  blockedDates?: BlockedDateInput[],
): Promise<GenerateReport> {
  const warnings: string[] = [];
  const unmet: UnmetStaffingEntry[] = [];
  const proposed: AssignmentInput[] = [];
  const lockedIds = new Set<string>();
  const idSeq = { value: 0 };

  const seed = hashString(schedule.id) ^ Date.now();
  const rng = mulberry32(seed);

  const debugLog: string[] = [];
  const log = (msg: string) => debugLog.push(`[${new Date().toISOString()}] ${msg}`);

  log(`=== Schedule Generation Start ===`);
  log(`Schedule: ${schedule.id}, Period: ${schedule.periodStart.toISOString().slice(0, 10)} - ${schedule.periodEnd.toISOString().slice(0, 10)}`);
  log(`Employees: ${ctx.employees.length} active`);
  for (const emp of ctx.employees) {
    const allowedNames = [...emp.allowedShiftProfileIds].map(pid => {
      const p = ctx.profiles.find(pr => pr.id === pid);
      return p ? p.name : pid;
    });
    log(`  Employee ${emp.id}: station=${emp.assignedStationNumber ?? "any"}, quals=[${emp.qualificationTags.join(",")}], allowedProfiles=[${allowedNames.join(",")}], pct=${emp.targetHoursPercent ?? "?"}`);
  }
  log(`Profiles: ${ctx.profiles.filter(p => p.isActive).map(p => `${p.name}(${p.shiftType})`).join(", ")}`);
  log(`Staffing requirements: ${ctx.mergedStaffing.size} entries`);
  for (const [key, entry] of ctx.mergedStaffing) {
    log(`  ${key}: min=${entry.minTotalCount}, max=${entry.maxTotalCount ?? "none"}, fw=${entry.isFacilityWide}, quals=[${entry.qualificationRequirements.map(q => `${q.qualificationTag}×${q.minCount}`).join(",")}]`);
  }

  const defaultProfileByType = buildDefaultProfileByType(ctx.profiles);
  const profilesById = new Map(ctx.profiles.map((p) => [p.id, p]));

  const profileIdsByShiftType = new Map<ShiftType, Set<string>>();
  for (const p of ctx.profiles) {
    if (!p.isActive) continue;
    const set = profileIdsByShiftType.get(p.shiftType) ?? new Set<string>();
    set.add(p.id);
    profileIdsByShiftType.set(p.shiftType, set);
  }

  const dates = eachUtcDateInPeriod(schedule.periodStart, schedule.periodEnd);

  const hasActiveProfile = ctx.profiles.some((p) => p.isActive);
  if (ctx.mergedStaffing.size === 0 || !hasActiveProfile) {
    if (ctx.mergedStaffing.size === 0) {
      warnings.push("Keine Personalbedarfs-Einträge für diese Einrichtung — nichts generiert.");
    }
    if (!hasActiveProfile) {
      warnings.push("Keine aktiven Schichtprofile — nichts generiert.");
    }
    return {
      createdAssignments: 0,
      manualPlacementsApplied: 0,
      unmetStaffing: [],
      unfulfilledWishes: unfulfilledOpenWishes(ctx.wishes),
      warnings,
      debugLog: debugLog.join("\n"),
    };
  }

  let manualPlaced = 0;
  if (manualPlacements && manualPlacements.length > 0) {
    const empIds = new Set(ctx.employees.map((e) => e.id));
    for (const mp of manualPlacements) {
      if (!empIds.has(mp.employeeId)) {
        warnings.push(`Manuelle Zuweisung: Mitarbeiter ${mp.employeeId} nicht gefunden — übersprungen.`);
        continue;
      }
      const profile = defaultProfileByType.get(mp.shiftType as ShiftType);
      if (!profile) {
        const label = SHIFT_LABEL_DE[mp.shiftType] ?? mp.shiftType;
        warnings.push(`Manuelle Zuweisung: Kein Profil für ${label} — übersprungen.`);
        continue;
      }
      const [y, m, d] = mp.date.split("-").map(Number);
      const dateObj = new Date(Date.UTC(y!, m! - 1, d));
      const tid = `gen:${idSeq.value++}`;
      proposed.push({ id: tid, date: dateObj, shiftProfileId: profile.id, employeeId: mp.employeeId });
      lockedIds.add(tid);
      manualPlaced++;
    }
  }

  if (blockedDates && blockedDates.length > 0) {
    const empById = new Map(ctx.employees.map((e) => [e.id, e]));
    for (const bd of blockedDates) {
      empById.get(bd.employeeId)?.unavailableDateSet.add(bd.date);
    }
  }

  // WBL-BL pre-assignment: give WBL employees one BL shift per calendar week BEFORE main filling
  // Each WBL must get a DIFFERENT day to avoid stacking all BL shifts on Monday.
  const wblEmployees = ctx.employees.filter(e =>
    e.qualificationTags.includes("WBL") || e.qualificationAbbreviations.includes("WBL")
  );
  if (wblEmployees.length > 0) {
    const weekDatesMap = new Map<string, Date[]>();
    for (const date of dates) {
      const wk = isoWeekKey(date);
      const arr = weekDatesMap.get(wk) ?? [];
      arr.push(date);
      weekDatesMap.set(wk, arr);
    }

    for (const [weekKey, weekDates] of weekDatesMap) {
      const blDaysUsed = new Set<string>();

      const needsBl = wblEmployees.filter(emp => {
        return !proposed.some(a => {
          if (a.employeeId !== emp.id) return false;
          const p = profilesById.get(a.shiftProfileId);
          if (!p || p.shiftType !== ShiftType.BL) return false;
          return weekDates.some(d => toIsoDateOnly(d) === toIsoDateOnly(a.date));
        });
      });

      for (const emp of needsBl) {
        const blProfile = selectProfileForEmployee(emp, ShiftType.BL, ctx.profiles);
        if (!blProfile) {
          log(`WBL-BL: ${emp.id} has no BL profile allowed, skipping ${weekKey}`);
          continue;
        }

        const sortedDates = [...weekDates].sort((a, b) => {
          const aUsed = blDaysUsed.has(toIsoDateOnly(a)) ? 1 : 0;
          const bUsed = blDaysUsed.has(toIsoDateOnly(b)) ? 1 : 0;
          return aUsed - bUsed;
        });

        let added = false;
        for (const date of sortedDates) {
          const dateIso = toIsoDateOnly(date);
          if (emp.unavailableDateSet.has(dateIso)) continue;
          const alreadyOnDate = proposed.some(a =>
            a.employeeId === emp.id && toIsoDateOnly(a.date) === dateIso
          );
          if (alreadyOnDate) continue;

          const assignment = await tryPlaceEmployee(
            emp, date, blProfile.id, proposed, tx, facilityId, schedule, idSeq,
          );
          if (assignment) {
            proposed.push(assignment);
            lockedIds.add(assignment.id);
            blDaysUsed.add(dateIso);
            log(`WBL-BL: PLACED ${emp.id} -> BL on ${dateIso} (${weekKey})`);
            added = true;
            break;
          }
        }
        if (!added) {
          log(`WBL-BL: could not place BL for ${emp.id} in ${weekKey}`);
          warnings.push(`WBL: Mitarbeiter ${emp.id} hat in ${weekKey} keinen BL-Dienst.`);
        }
      }
    }
  }

  for (const [shiftType] of defaultProfileByType) {
    const hasStaffing = [...ctx.mergedStaffing.keys()].some((k) => k.startsWith(shiftType + ":"));
    if (!hasStaffing) {
      const label = SHIFT_LABEL_DE[shiftType] ?? shiftType;
      warnings.push(
        `${label}: Schichtprofil aktiv, aber kein Personalbedarf konfiguriert — wird übersprungen. Bitte unter Einstellungen > Mindestbesetzung anlegen.`,
      );
    }
  }

  for (const date of dates) {
    const dateIso = toIsoDateOnly(date);

    for (const shiftType of SHIFT_TYPE_ORDER) {
      const placedForTypeToday = new Set<string>();

      for (const a of proposed) {
        if (!lockedIds.has(a.id)) continue;
        if (toIsoDateOnly(a.date) !== dateIso) continue;
        const p = profilesById.get(a.shiftProfileId);
        if (p && p.shiftType === shiftType) {
          placedForTypeToday.add(a.employeeId);
        }
      }

      // Station-based filling (non-facility-wide)
      for (const station of STATION_NUMBERS) {
        const key = staffingKey(shiftType, station);
        const req = ctx.mergedStaffing.get(key);
        if (!req || req.isFacilityWide) continue;
        log(`--- ${dateIso} ${shiftType} St.${station}: min=${req.minTotalCount}, max=${req.maxTotalCount ?? "none"}, quals=${req.qualificationRequirements.length}`);

        const defaultProfile = defaultProfileByType.get(shiftType) ?? null;
        if (!defaultProfile) {
          warnings.push(`Kein aktives Schichtprofil für ${SHIFT_LABEL_DE[shiftType] ?? shiftType} Station ${station} am ${formatDateDE(date)}.`);
          unmet.push({ date: toIsoDateOnly(date), shiftType, requested: req.minTotalCount, assigned: 0 });
          continue;
        }

        const placedOnSlot = new Set<string>(placedForTypeToday);

        let filled = 0;
        for (const a of proposed) {
          if (lockedIds.has(a.id) && a.shiftProfileId === defaultProfile.id && toIsoDateOnly(a.date) === dateIso) {
            placedOnSlot.add(a.employeeId);
            filled++;
          }
        }

        // Pass 1: fill qualification-required slots
        for (const qr of req.qualificationRequirements) {
          for (let slot = 0; slot < qr.minCount; slot++) {
            const stProfileIds = profileIdsByShiftType.get(shiftType);
            const candidates = sortCandidates(
              ctx.employees, date, shiftType, defaultProfile.id,
              qr.qualificationTag, ctx.wishes, proposed, profilesById, placedOnSlot, station, rng,
              stProfileIds,
            );
            log(`  Pass1 qual="${qr.qualificationTag}" slot ${slot+1}/${qr.minCount}: ${candidates.length} candidates`);
            let placed = false;
            for (const emp of candidates) {
              const empProfile = selectProfileForEmployee(emp, shiftType, ctx.profiles);
              if (!empProfile) { log(`    ${emp.id}: no profile for ${shiftType}, skip`); continue; }
              const assignment = await tryPlaceEmployee(
                emp, date, empProfile.id, proposed, tx, facilityId, schedule, idSeq,
              );
              if (assignment) {
                log(`    PLACED ${emp.id} -> ${empProfile.name}`);
                proposed.push(assignment);
                placedOnSlot.add(emp.id);
                placedForTypeToday.add(emp.id);
                filled++;
                placed = true;
                break;
              } else {
                log(`    ${emp.id}: validation rejected (profile=${empProfile.name})`);
              }
            }
            if (!placed) { log(`  Pass1: could not fill slot`); break; }
          }
        }

        // Pass 2: fill remaining general slots
        const remaining = req.minTotalCount - filled;
        if (remaining > 0) log(`  Pass2: ${remaining} general slots to fill`);
        for (let slot = 0; slot < remaining; slot++) {
          const stProfileIds2 = profileIdsByShiftType.get(shiftType);
          const candidates = sortCandidates(
            ctx.employees, date, shiftType, defaultProfile.id,
            null, ctx.wishes, proposed, profilesById, placedOnSlot, station, rng,
            stProfileIds2,
          );
          log(`  Pass2 slot ${slot+1}/${remaining}: ${candidates.length} candidates`);
          let placed = false;
          for (const emp of candidates) {
            const empProfile = selectProfileForEmployee(emp, shiftType, ctx.profiles);
            if (!empProfile) continue;
            const assignment = await tryPlaceEmployee(
              emp, date, empProfile.id, proposed, tx, facilityId, schedule, idSeq,
            );
            if (assignment) {
              log(`    PLACED ${emp.id} -> ${empProfile.name}`);
              proposed.push(assignment);
              placedOnSlot.add(emp.id);
              placedForTypeToday.add(emp.id);
              filled++;
              placed = true;
              break;
            } else {
              log(`    ${emp.id}: validation rejected`);
            }
          }
          if (!placed) { log(`  Pass2: could not fill slot`); break; }
        }

        // Pass 3: fill up to maxTotalCount for employees who need more hours
        const maxSlots = (req.maxTotalCount ?? req.minTotalCount) - filled;
        if (maxSlots > 0) {
          const year = date.getUTCFullYear();
          const month = date.getUTCMonth();
          const wd = monthlyWorkingDays(year, month);
          for (let slot = 0; slot < maxSlots; slot++) {
            const stProfileIds3 = profileIdsByShiftType.get(shiftType);
            const candidates = sortCandidates(
              ctx.employees, date, shiftType, defaultProfile.id,
              null, ctx.wishes, proposed, profilesById, placedOnSlot, station, rng,
              stProfileIds3,
            ).filter(emp => {
              const hours = sumPaidHoursForEmployeeInProposed(emp.id, proposed, profilesById);
              const soll = emp.targetHoursPercent != null
                ? monthlySollHours(wd, emp.targetHoursPercent)
                : (emp.targetHours ?? DEFAULT_BALANCE_TARGET);
              return hours < soll + 8;
            });
            if (candidates.length === 0) break;
            let placed = false;
            for (const emp of candidates) {
              const empProfile = selectProfileForEmployee(emp, shiftType, ctx.profiles);
              if (!empProfile) continue;
              const assignment = await tryPlaceEmployee(
                emp, date, empProfile.id, proposed, tx, facilityId, schedule, idSeq,
              );
              if (assignment) {
                proposed.push(assignment);
                placedOnSlot.add(emp.id);
                placedForTypeToday.add(emp.id);
                filled++;
                placed = true;
                break;
              }
            }
            if (!placed) break;
          }
        }

        log(`  Result: filled ${filled}/${req.minTotalCount} (max ${req.maxTotalCount ?? "none"})`);
        if (filled < req.minTotalCount) {
          unmet.push({ date: toIsoDateOnly(date), shiftType, requested: req.minTotalCount, assigned: filled });
        }
      }

      // Facility-wide handling (e.g. night shifts)
      for (const [fwKey, fwReq] of ctx.mergedStaffing) {
        const parts = fwKey.split(":");
        if (parts[0] !== shiftType || !fwReq.isFacilityWide) continue;

        const defaultProfile = defaultProfileByType.get(shiftType) ?? null;
        if (!defaultProfile) continue;

        const placedOnSlot = new Set<string>();
        let filled = 0;
        for (const a of proposed) {
          if (toIsoDateOnly(a.date) !== dateIso) continue;
          const p = profilesById.get(a.shiftProfileId);
          if (p && p.shiftType === shiftType) {
            placedOnSlot.add(a.employeeId);
            filled++;
          }
        }

        const fwProfileIds = profileIdsByShiftType.get(shiftType);

        // Pass 1: qualification-required
        for (const qr of fwReq.qualificationRequirements) {
          for (let slot = 0; slot < qr.minCount; slot++) {
            const candidates = sortCandidates(
              ctx.employees, date, shiftType, defaultProfile.id,
              qr.qualificationTag, ctx.wishes, proposed, profilesById, placedOnSlot, 0, rng,
              fwProfileIds,
            );
            let placed = false;
            for (const emp of candidates) {
              const empProfile = selectFacilityWideProfile(emp, shiftType, ctx.profiles);
              if (!empProfile) continue;
              const assignment = await tryPlaceEmployee(
                emp, date, empProfile.id, proposed, tx, facilityId, schedule, idSeq,
              );
              if (assignment) {
                proposed.push(assignment);
                placedOnSlot.add(emp.id);
                placedForTypeToday.add(emp.id);
                filled++;
                placed = true;
                break;
              }
            }
            if (!placed) break;
          }
        }

        // Pass 2: fill remaining to minTotalCount
        const fwRemaining = fwReq.minTotalCount - filled;
        for (let slot = 0; slot < fwRemaining; slot++) {
          const candidates = sortCandidates(
            ctx.employees, date, shiftType, defaultProfile.id,
            null, ctx.wishes, proposed, profilesById, placedOnSlot, 0, rng,
            fwProfileIds,
          );
          let placed = false;
          for (const emp of candidates) {
            const empProfile = selectFacilityWideProfile(emp, shiftType, ctx.profiles);
            if (!empProfile) continue;
            const assignment = await tryPlaceEmployee(
              emp, date, empProfile.id, proposed, tx, facilityId, schedule, idSeq,
            );
            if (assignment) {
              proposed.push(assignment);
              placedOnSlot.add(emp.id);
              placedForTypeToday.add(emp.id);
              filled++;
              placed = true;
              break;
            }
          }
          if (!placed) break;
        }

        // Pass 3: fill up to maxTotalCount
        const fwMaxSlots = (fwReq.maxTotalCount ?? fwReq.minTotalCount) - filled;
        if (fwMaxSlots > 0) {
          const year = date.getUTCFullYear();
          const month = date.getUTCMonth();
          const wd = monthlyWorkingDays(year, month);
          for (let slot = 0; slot < fwMaxSlots; slot++) {
            const candidates = sortCandidates(
              ctx.employees, date, shiftType, defaultProfile.id,
              null, ctx.wishes, proposed, profilesById, placedOnSlot, 0, rng,
              fwProfileIds,
            ).filter(emp => {
              const hours = sumPaidHoursForEmployeeInProposed(emp.id, proposed, profilesById);
              const soll = emp.targetHoursPercent != null
                ? monthlySollHours(wd, emp.targetHoursPercent)
                : (emp.targetHours ?? DEFAULT_BALANCE_TARGET);
              return hours < soll + 8;
            });
            if (candidates.length === 0) break;
            let placed = false;
            for (const emp of candidates) {
              const empProfile = selectFacilityWideProfile(emp, shiftType, ctx.profiles);
              if (!empProfile) continue;
              const assignment = await tryPlaceEmployee(
                emp, date, empProfile.id, proposed, tx, facilityId, schedule, idSeq,
              );
              if (assignment) {
                proposed.push(assignment);
                placedOnSlot.add(emp.id);
                placedForTypeToday.add(emp.id);
                filled++;
                placed = true;
                break;
              }
            }
            if (!placed) break;
          }
        }

        if (filled < fwReq.minTotalCount) {
          unmet.push({ date: toIsoDateOnly(date), shiftType, requested: fwReq.minTotalCount, assigned: filled });
        }
      }
    }
  }

  // Rebalancing pass: equalize Ist/Soll across employees
  if (proposed.length > 0) {
    const facility = await tx.facility.findUniqueOrThrow({ where: { id: facilityId } });
    const snapshot = mergePlanningRules(facility, defaultPlanningRulesConfig);
    const rebalResult = rebalanceAssignments(
      proposed,
      ctx.employees,
      profilesById,
      ctx.mergedStaffing,
      snapshot,
      { periodStart: schedule.periodStart, periodEnd: schedule.periodEnd },
      lockedIds,
    );
    warnings.push(...rebalResult.warnings);
  }

  if (proposed.length > 0) {
    await tx.assignment.createMany({
      data: proposed.map((p) => ({
        scheduleId: schedule.id,
        date: p.date,
        shiftProfileId: p.shiftProfileId,
        employeeId: p.employeeId,
        createdByUserId: userId,
      })),
    });
  }

  const unfulfilled: UnfulfilledWishEntry[] = [];
  for (const w of ctx.wishes) {
    if (w.status !== WishStatus.OPEN) continue;
    const dateIso = toIsoDateOnly(w.date);
    const ok = proposed.some((a) => {
      if (a.employeeId !== w.employeeId || toIsoDateOnly(a.date) !== dateIso) return false;
      const prof = profilesById.get(a.shiftProfileId);
      if (!prof) return false;
      if (w.shiftProfileId && w.shiftProfileId !== a.shiftProfileId) return false;
      if (w.shiftType && prof.shiftType !== w.shiftType) return false;
      return true;
    });
    if (!ok) {
      unfulfilled.push({ wishId: w.id, employeeId: w.employeeId, date: dateIso });
    }
  }

  log(`=== Generation Complete: ${proposed.length} assignments, ${warnings.length} warnings, ${unmet.length} unmet ===`);

  return {
    createdAssignments: proposed.length,
    manualPlacementsApplied: manualPlaced,
    unmetStaffing: unmet,
    unfulfilledWishes: unfulfilled,
    warnings,
    debugLog: debugLog.join("\n"),
  };
}
