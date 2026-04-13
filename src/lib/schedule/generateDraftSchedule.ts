import type { PrismaClient, ShiftProfile, Wish } from "@prisma/client";
import {
  ContractType,
  EmployeeStatus,
  ShiftType,
  TargetHoursPeriod,
  WishPriority,
  WishStatus,
} from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import type {
  AssignmentInput,
  QualificationRequirementInput,
} from "@/lib/planning/types";
import { assignmentPaidHours } from "@/lib/planning/time";
import { monthlyWorkingDaysWithHolidays } from "@/lib/holidays";

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

/** Merge DB rows that share (shiftType, stationNumber, isFacilityWide) — sums counts, unions qual reqs.
 *  FW rows get key suffix `:fw` to prevent merging with station-specific rows of the same station number. */
export function mergeStaffingRequirements(
  rows: {
    shiftType: ShiftType;
    stationNumber: number;
    minTotalCount: number;
    maxTotalCount?: number | null;
    isFacilityWide?: boolean;
    qualificationRequirements: { qualificationTag: string; minCount: number; maxCount?: number | null }[];
  }[],
): Map<string, MergedStaffingEntry> {
  const map = new Map<string, MergedStaffingEntry>();
  for (const r of rows) {
    const k = (r.isFacilityWide ?? false)
      ? `${staffingKey(r.shiftType, r.stationNumber)}:fw`
      : staffingKey(r.shiftType, r.stationNumber);
    const cur = map.get(k);
    if (!cur) {
      map.set(k, {
        minTotalCount: r.minTotalCount,
        maxTotalCount: r.maxTotalCount ?? null,
        isFacilityWide: r.isFacilityWide ?? false,
        qualificationRequirements: r.qualificationRequirements.map((q) => ({
          qualificationTag: q.qualificationTag,
          minCount: q.minCount,
          maxCount: q.maxCount ?? null,
        })),
      });
    } else {
      const tagMinMap = new Map<string, number>();
      const tagMaxMap = new Map<string, number | null>();
      for (const q of cur.qualificationRequirements) {
        tagMinMap.set(q.qualificationTag, q.minCount);
        tagMaxMap.set(q.qualificationTag, q.maxCount ?? null);
      }
      for (const q of r.qualificationRequirements) {
        tagMinMap.set(q.qualificationTag, (tagMinMap.get(q.qualificationTag) ?? 0) + q.minCount);
        // Merge maxCount: when both sides define a max, sum them; otherwise take whichever is set (or null).
        const curMax = tagMaxMap.get(q.qualificationTag);
        const newMax = q.maxCount ?? null;
        if (curMax != null && newMax != null) {
          tagMaxMap.set(q.qualificationTag, curMax + newMax);
        } else {
          tagMaxMap.set(q.qualificationTag, curMax ?? newMax);
        }
      }
      map.set(k, {
        minTotalCount: cur.minTotalCount + r.minTotalCount,
        maxTotalCount:
          cur.maxTotalCount != null && r.maxTotalCount != null
            ? cur.maxTotalCount + r.maxTotalCount
            : (cur.maxTotalCount ?? r.maxTotalCount ?? null),
        isFacilityWide: cur.isFacilityWide || (r.isFacilityWide ?? false),
        qualificationRequirements: [...tagMinMap.entries()].map(([qualificationTag, minCount]) => ({
          qualificationTag,
          minCount,
          maxCount: tagMaxMap.get(qualificationTag) ?? null,
        })),
      });
    }
  }

  // When a facility-wide entry exists for a shift type, the station-specific
  // entries for that same type are redundant — the FW entry already defines
  // the total headcount needed across the entire facility.  Remove them so
  // neither the greedy nor the CP-SAT engine double-counts.
  const fwShiftTypes = new Set<string>();
  for (const [k, v] of map) {
    if (v.isFacilityWide) {
      fwShiftTypes.add(k.split(":")[0]!);
    }
  }
  if (fwShiftTypes.size > 0) {
    for (const k of [...map.keys()]) {
      const entry = map.get(k)!;
      if (!entry.isFacilityWide && fwShiftTypes.has(k.split(":")[0]!)) {
        map.delete(k);
      }
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
  assignedStations: number[];
  allowedShiftProfileIds: Set<string>;
  unavailableDateSet: Set<string>;
  isFullTimeBl: boolean;
  fixedWorkingDays: number[];
  maxConsecutiveDays: number | null;
  shiftDistribution: Record<string, number> | null;
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
  return monthlyWorkingDaysWithHolidays(year, month);
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
      (e.assignedStations.length === 0 || e.assignedStations.includes(stationNumber) || stationNumber === 0) &&
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
  stationNumber?: number;
  shiftProfileId?: string;
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
    where: {
      facilityId,
      status: EmployeeStatus.ACTIVE,
      contractType: { not: ContractType.AUSBILDUNG },
    },
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

    // fixedWorkingDays: mark all dates outside those weekdays as unavailable
    const fwd = e.fixedWorkingDays ?? [];
    if (fwd.length > 0) {
      const fwdSet = new Set(fwd);
      let t2 = Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), periodStart.getUTCDate());
      const end2 = Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), periodEnd.getUTCDate());
      while (t2 <= end2) {
        const dt = new Date(t2);
        const isoDay = dt.getUTCDay() === 0 ? 7 : dt.getUTCDay();
        if (!fwdSet.has(isoDay)) {
          unavail.add(toIsoDateOnly(dt));
        }
        t2 += 24 * 60 * 60 * 1000;
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
      assignedStations: e.assignedStations ?? [],
      allowedShiftProfileIds: new Set(e.allowedShiftProfiles.map(p => p.id)),
      unavailableDateSet: unavail,
      isFullTimeBl: e.isFullTimeBl ?? false,
      fixedWorkingDays: fwd,
      maxConsecutiveDays: e.maxConsecutiveDays ?? null,
      shiftDistribution: (e.shiftDistribution as Record<string, number>) ?? null,
    };
  });

  const mappedRows = staffingRows.map((r) => ({
    shiftType: r.shiftType,
    stationNumber: r.stationNumber,
    minTotalCount: r.minTotalCount,
    maxTotalCount: r.maxTotalCount ?? null,
    isFacilityWide: r.isFacilityWide,
    qualificationRequirements: r.qualificationRequirements.map((q: Record<string, unknown>) => ({
      qualificationTag: q.qualificationTag as string,
      minCount: q.minCount as number,
      maxCount: (q.maxCount as number | null) ?? null,
    })),
  }));

  return {
    employees,
    profiles,
    mergedStaffing: mergeStaffingRequirements(mappedRows),
    wishes,
  };
}

