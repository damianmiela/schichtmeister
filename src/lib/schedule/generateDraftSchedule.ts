import type { PrismaClient, ShiftProfile, StaffingRequirement, Wish } from "@prisma/client";
import {
  ContractType,
  ShiftType,
  TargetHoursPeriod,
  WishPriority,
  WishStatus,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import { validateScheduleAssignments } from "@/lib/api/planningScheduleValidation";
import type { AssignmentInput } from "@/lib/planning/types";
import { assignmentPaidHours } from "@/lib/planning/time";

/** Deterministic shift order within a calendar day. */
export const SHIFT_TYPE_ORDER: ShiftType[] = [
  ShiftType.EARLY,
  ShiftType.LATE,
  ShiftType.NIGHT,
];

export type MergedStaffingEntry = {
  minStaffCount: number;
  requiredQualificationTags: string[];
};

/** Merge DB rows that share shiftType (defensive if duplicates exist) — sums counts, unions tags. */
export function mergeStaffingRequirements(
  rows: Pick<
    StaffingRequirement,
    "shiftType" | "minStaffCount" | "requiredQualificationTags"
  >[],
): Map<string, MergedStaffingEntry> {
  const map = new Map<string, MergedStaffingEntry>();
  for (const r of rows) {
    const k = r.shiftType;
    const cur = map.get(k);
    if (!cur) {
      map.set(k, {
        minStaffCount: r.minStaffCount,
        requiredQualificationTags: [...r.requiredQualificationTags],
      });
    } else {
      map.set(k, {
        minStaffCount: cur.minStaffCount + r.minStaffCount,
        requiredQualificationTags: [
          ...new Set([...cur.requiredQualificationTags, ...r.requiredQualificationTags]),
        ],
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
  preferredShiftTypes: ShiftType[];
  targetHours: number | null;
  targetHoursPeriod: TargetHoursPeriod | null;
  contractType: ContractType;
  miniJobMaxMonthlyHours: number | null;
  unavailableDateSet: Set<string>;
};

/** Presence of `EmployeeAvailability` row for that calendar day → excluded from generation. */
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

function sortCandidatesDeterministic(
  employees: GenEmployee[],
  date: Date,
  shiftType: ShiftType,
  profileId: string,
  requiredTags: string[],
  wishes: MinimalWish[],
  proposed: AssignmentInput[],
  profilesById: Map<string, Pick<ShiftProfile, "startTime" | "endTime" | "breakMinutes">>,
): GenEmployee[] {
  const dateIso = toIsoDateOnly(date);
  const available = employees.filter((e) => !e.unavailableDateSet.has(dateIso));

  const scored = available.map((e) => {
    const qualBoost =
      requiredTags.length > 0 && employeeHasAllTags(e.qualificationTags, requiredTags)
        ? 50
        : 0;
    const hours = sumPaidHoursForEmployeeInProposed(e.id, proposed, profilesById);
    const score =
      qualBoost +
      wishBonusForSlot(wishes, e.id, dateIso, shiftType, profileId) +
      schedulingTargetHoursBonus(e.targetHours, e.targetHoursPeriod, hours) -
      preferencePenalty(e.preferredShiftTypes, shiftType);
    return { e, score };
  });

  const qualified = scored.filter(
    ({ e }) => requiredTags.length === 0 || employeeHasAllTags(e.qualificationTags, requiredTags),
  );
  const rest = scored.filter(
    ({ e }) => requiredTags.length > 0 && !employeeHasAllTags(e.qualificationTags, requiredTags),
  );

  const sortBlock = (arr: typeof scored) =>
    [...arr].sort((a, b) => b.score - a.score || a.e.id.localeCompare(b.e.id)).map((x) => x.e);

  return [...sortBlock(qualified), ...sortBlock(rest)];
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

export type GenerateReport = {
  /** Number of rows written (after replace). */
  createdAssignments: number;
  unmetStaffing: UnmetStaffingEntry[];
  unfulfilledWishes: UnfulfilledWishEntry[];
  warnings: string[];
};

type LoaderDb = Pick<
  PrismaClient,
  "employee" | "employeeAvailability" | "shiftProfile" | "staffingRequirement" | "wish"
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
  const employeesRaw = await db.employee.findMany({ where: { facilityId } });
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
    db.staffingRequirement.findMany({ where: { facilityId } }),
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

  const employees: GenEmployee[] = employeesRaw.map((e) => ({
    id: e.id,
    qualificationTags: e.qualificationTags,
    preferredShiftTypes: e.preferredShiftTypes,
    targetHours: e.targetHours != null ? Number(e.targetHours) : null,
    targetHoursPeriod: e.targetHoursPeriod,
    contractType: e.contractType,
    miniJobMaxMonthlyHours:
      e.miniJobMaxMonthlyHours != null ? Number(e.miniJobMaxMonthlyHours) : null,
    unavailableDateSet: unavailByEmp.get(e.id) ?? new Set(),
  }));

  return {
    employees,
    profiles,
    mergedStaffing: mergeStaffingRequirements(staffingRows),
    wishes,
  };
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

/**
 * Idempotency: caller must delete existing assignments for this schedule first.
 * Greedy fill: ascending dates, EARLY→LATE→NIGHT; qualified candidates before others; deterministic ties.
 */
export async function runGreedyScheduleGeneration(
  tx: Prisma.TransactionClient,
  facilityId: string,
  schedule: { id: string; periodStart: Date; periodEnd: Date },
  userId: string,
  ctx: Awaited<ReturnType<typeof loadGenerateContext>>,
): Promise<GenerateReport> {
  const warnings: string[] = [];
  const unmet: UnmetStaffingEntry[] = [];
  const proposed: AssignmentInput[] = [];
  let idSeq = 0;

  const defaultBySt = buildDefaultProfileByShiftType(ctx.profiles);
  const profilesById = new Map(ctx.profiles.map((p) => [p.id, p]));

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
      unmetStaffing: [],
      unfulfilledWishes: unfulfilledOpenWishes(ctx.wishes),
      warnings,
    };
  }

  for (const date of dates) {
    for (const shiftType of SHIFT_TYPE_ORDER) {
      const req = ctx.mergedStaffing.get(shiftType);
      if (!req) {
        continue;
      }

      const profile = defaultBySt.get(shiftType) ?? null;
      if (!profile) {
        warnings.push(`Kein aktives Schichtprofil für ${shiftType} am ${toIsoDateOnly(date)}.`);
        unmet.push({
          date: toIsoDateOnly(date),
          shiftType,
          requested: req.minStaffCount,
          assigned: 0,
        });
        continue;
      }

      let filled = 0;
      for (let slot = 0; slot < req.minStaffCount; slot++) {
        const candidates = sortCandidatesDeterministic(
          ctx.employees,
          date,
          shiftType,
          profile.id,
          req.requiredQualificationTags,
          ctx.wishes,
          proposed,
          profilesById,
        );

        let placed = false;
        for (const emp of candidates) {
          const tid = `gen:${idSeq++}`;
          const next: AssignmentInput[] = [
            ...proposed,
            {
              id: tid,
              date,
              shiftProfileId: profile.id,
              employeeId: emp.id,
            },
          ];
          const v = await validateScheduleAssignments(
            tx,
            facilityId,
            { periodStart: schedule.periodStart, periodEnd: schedule.periodEnd },
            next,
            { ruleScope: "employee" },
          );
          if (!v.ok) continue;
          if (v.result.errors.length === 0) {
            proposed.push({
              id: tid,
              date,
              shiftProfileId: profile.id,
              employeeId: emp.id,
            });
            filled++;
            placed = true;
            break;
          }
        }
        if (!placed) break;
      }

      if (filled < req.minStaffCount) {
        unmet.push({
          date: toIsoDateOnly(date),
          shiftType,
          requested: req.minStaffCount,
          assigned: filled,
        });
      }
    }
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

  return {
    createdAssignments: proposed.length,
    unmetStaffing: unmet,
    unfulfilledWishes: unfulfilled,
    warnings,
  };
}
