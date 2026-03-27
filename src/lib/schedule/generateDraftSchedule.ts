import type { PrismaClient, ShiftProfile, Wish } from "@prisma/client";
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
import type { AssignmentInput, QualificationRequirementInput } from "@/lib/planning/types";
import { assignmentPaidHours } from "@/lib/planning/time";

/** Deterministic shift order within a calendar day. */
export const SHIFT_TYPE_ORDER: ShiftType[] = [
  ShiftType.EARLY,
  ShiftType.LATE,
  ShiftType.NIGHT,
];

export type MergedStaffingEntry = {
  minTotalCount: number;
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
  preferredShiftTypes: ShiftType[];
  targetHours: number | null;
  targetHoursPeriod: TargetHoursPeriod | null;
  contractType: ContractType;
  miniJobMaxMonthlyHours: number | null;
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

/** Build a map from `"EARLY:1"` → profile for station-aware generation. */
export function buildProfileByTypeStation(
  profiles: (ShiftProfile & { stationNumber: number })[],
): Map<string, ShiftProfile & { stationNumber: number }> {
  const out = new Map<string, ShiftProfile & { stationNumber: number }>();
  for (const p of profiles) {
    if (!p.isActive) continue;
    const key = staffingKey(p.shiftType, p.stationNumber);
    const existing = out.get(key);
    if (!existing || p.name.localeCompare(existing.name, "de") < 0) {
      out.set(key, p);
    }
  }
  return out;
}

/**
 * Sort candidates by score. When requiredTag is provided, only employees with that tag are returned.
 * When requiredTag is null, all employees are returned sorted by score (qualified first for tiebreaking).
 */
function sortCandidatesDeterministic(
  employees: GenEmployee[],
  date: Date,
  shiftType: ShiftType,
  profileId: string,
  requiredTag: string | null,
  wishes: MinimalWish[],
  proposed: AssignmentInput[],
  profilesById: Map<string, Pick<ShiftProfile, "startTime" | "endTime" | "breakMinutes">>,
  alreadyPlacedIds: Set<string>,
): GenEmployee[] {
  const dateIso = toIsoDateOnly(date);
  const available = employees.filter(
    (e) => !e.unavailableDateSet.has(dateIso) && !alreadyPlacedIds.has(e.id),
  );

  if (requiredTag) {
    const withTag = available.filter((e) => e.qualificationTags.includes(requiredTag));
    const scored = withTag.map((e) => {
      const hours = sumPaidHoursForEmployeeInProposed(e.id, proposed, profilesById);
      const score =
        wishBonusForSlot(wishes, e.id, dateIso, shiftType, profileId) +
        schedulingTargetHoursBonus(e.targetHours, e.targetHoursPeriod, hours) -
        preferencePenalty(e.preferredShiftTypes, shiftType);
      return { e, score };
    });
    return [...scored].sort((a, b) => b.score - a.score || a.e.id.localeCompare(b.e.id)).map((x) => x.e);
  }

  const scored = available.map((e) => {
    const hours = sumPaidHoursForEmployeeInProposed(e.id, proposed, profilesById);
    const score =
      wishBonusForSlot(wishes, e.id, dateIso, shiftType, profileId) +
      schedulingTargetHoursBonus(e.targetHours, e.targetHoursPeriod, hours) -
      preferencePenalty(e.preferredShiftTypes, shiftType);
    return { e, score };
  });
  return [...scored].sort((a, b) => b.score - a.score || a.e.id.localeCompare(b.e.id)).map((x) => x.e);
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

  const mappedRows = staffingRows.map((r) => ({
    shiftType: r.shiftType,
    stationNumber: r.stationNumber,
    minTotalCount: r.minTotalCount,
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

/**
 * Two-pass greedy fill: ascending dates, EARLY->LATE->NIGHT.
 * Pass 1: fill qualification-required slots (tag-specific candidates only).
 * Pass 2: fill remaining general slots with anyone.
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
  const idSeq = { value: 0 };

  const profileByTS = buildProfileByTypeStation(
    ctx.profiles.map((p) => ({ ...p, stationNumber: (p as unknown as { stationNumber: number }).stationNumber ?? 1 })),
  );
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
      for (const station of STATION_NUMBERS) {
        const key = staffingKey(shiftType, station);
        const req = ctx.mergedStaffing.get(key);
        if (!req) continue;

        const profile = profileByTS.get(key) ?? null;
        if (!profile) {
          warnings.push(`Kein aktives Schichtprofil für ${shiftType} Station ${station} am ${toIsoDateOnly(date)}.`);
          unmet.push({ date: toIsoDateOnly(date), shiftType, requested: req.minTotalCount, assigned: 0 });
          continue;
        }

        const placedOnSlot = new Set<string>();
        let filled = 0;

        // Pass 1: fill qualification-required slots
        for (const qr of req.qualificationRequirements) {
          let qFilled = 0;
          for (let slot = 0; slot < qr.minCount; slot++) {
            const candidates = sortCandidatesDeterministic(
              ctx.employees, date, shiftType, profile.id,
              qr.qualificationTag, ctx.wishes, proposed, profilesById, placedOnSlot,
            );
            let placed = false;
            for (const emp of candidates) {
              const assignment = await tryPlaceEmployee(
                emp, date, profile.id, proposed, tx, facilityId, schedule, idSeq,
              );
              if (assignment) {
                proposed.push(assignment);
                placedOnSlot.add(emp.id);
                filled++;
                qFilled++;
                placed = true;
                break;
              }
            }
            if (!placed) break;
          }
          if (qFilled < qr.minCount) {
            warnings.push(
              `Nur ${qFilled}/${qr.minCount} "${qr.qualificationTag}" für ${shiftType} St.${station} am ${toIsoDateOnly(date)} besetzt.`,
            );
          }
        }

        // Pass 2: fill remaining general slots
        const remaining = req.minTotalCount - filled;
        for (let slot = 0; slot < remaining; slot++) {
          const candidates = sortCandidatesDeterministic(
            ctx.employees, date, shiftType, profile.id,
            null, ctx.wishes, proposed, profilesById, placedOnSlot,
          );
          let placed = false;
          for (const emp of candidates) {
            const assignment = await tryPlaceEmployee(
              emp, date, profile.id, proposed, tx, facilityId, schedule, idSeq,
            );
            if (assignment) {
              proposed.push(assignment);
              placedOnSlot.add(emp.id);
              filled++;
              placed = true;
              break;
            }
          }
          if (!placed) break;
        }

        if (filled < req.minTotalCount) {
          unmet.push({ date: toIsoDateOnly(date), shiftType, requested: req.minTotalCount, assigned: filled });
        }
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
