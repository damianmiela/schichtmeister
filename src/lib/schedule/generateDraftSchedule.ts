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
];

const SHIFT_LABEL_DE: Record<string, string> = {
  EARLY: "Früh",
  LATE: "Spät",
  NIGHT: "Nacht",
};

function formatDateDE(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

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
  profiles: ShiftProfile[],
): Map<string, ShiftProfile> {
  const out = new Map<string, ShiftProfile>();
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
        stationNumber: p.stationNumber,
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
        .filter(({ a }) => a.employeeId === overEmpId);
      overAssignments.sort((x, y) => y.a.date.getTime() - x.a.date.getTime());

      let swappedThisEmployee = false;

      for (const { a: assignment, idx } of overAssignments) {
        if (swappedThisEmployee) break;
        const profile = profilesById.get(assignment.shiftProfileId);
        if (!profile) continue;
        const dateIso = toIsoDateOnly(assignment.date);
        const stKey = staffingKey(profile.shiftType, profile.stationNumber);
        const staffReq = mergedStaffing.get(stKey);

        for (const [underEmpId, underUtil] of underList) {
          if (underEmpId === overEmpId) continue;
          if (overUtil.pct - underUtil.pct < 0.10) continue;

          const underEmp = empById.get(underEmpId);
          if (!underEmp) continue;
          if (underEmp.unavailableDateSet.has(dateIso)) continue;

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
              if (!overEmp.qualificationTags.includes(qr.qualificationTag)) continue;
              const othersWithTag = proposed.filter(
                (a2) =>
                  a2.employeeId !== overEmpId &&
                  toIsoDateOnly(a2.date) === dateIso &&
                  a2.shiftProfileId === assignment.shiftProfileId &&
                  empById
                    .get(a2.employeeId)
                    ?.qualificationTags.includes(qr.qualificationTag),
              ).length;
              if (
                othersWithTag < qr.minCount &&
                !underEmp.qualificationTags.includes(qr.qualificationTag)
              ) {
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

  const profileByTS = buildProfileByTypeStation(ctx.profiles);
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

  for (const [key] of profileByTS) {
    if (!ctx.mergedStaffing.has(key)) {
      const [st, sn] = key.split(":");
      const label = SHIFT_LABEL_DE[st!] ?? st;
      warnings.push(
        `${label} Station ${sn}: Schichtprofil aktiv, aber kein Personalbedarf konfiguriert — wird übersprungen. Bitte unter Einstellungen > Mindestbesetzung anlegen.`,
      );
    }
  }

  for (const date of dates) {
    for (const shiftType of SHIFT_TYPE_ORDER) {
      const placedForTypeToday = new Set<string>();

      for (const station of STATION_NUMBERS) {
        const key = staffingKey(shiftType, station);
        const req = ctx.mergedStaffing.get(key);
        if (!req) continue;

        const profile = profileByTS.get(key) ?? null;
        if (!profile) {
          warnings.push(`Kein aktives Schichtprofil für ${SHIFT_LABEL_DE[shiftType] ?? shiftType} Station ${station} am ${formatDateDE(date)}.`);
          unmet.push({ date: toIsoDateOnly(date), shiftType, requested: req.minTotalCount, assigned: 0 });
          continue;
        }

        const placedOnSlot = new Set<string>(placedForTypeToday);
        let filled = 0;
        const qualGaps: { tag: string; required: number; got: number }[] = [];

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
                placedForTypeToday.add(emp.id);
                filled++;
                qFilled++;
                placed = true;
                break;
              }
            }
            if (!placed) break;
          }
          if (qFilled < qr.minCount) {
            qualGaps.push({ tag: qr.qualificationTag, required: qr.minCount, got: qFilled });
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
              placedForTypeToday.add(emp.id);
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

        // Emit qualification gap warnings with full context after both passes
        if (qualGaps.length > 0) {
          const dateDE = formatDateDE(date);
          const shift = SHIFT_LABEL_DE[shiftType] ?? shiftType;
          const totalInfo =
            filled >= req.minTotalCount
              ? "Schicht voll besetzt"
              : `Schicht unterbesetzt: ${filled}/${req.minTotalCount}`;
          for (const gap of qualGaps) {
            warnings.push(
              `${shift} Station ${station} am ${dateDE}: ${gap.got}/${gap.required} ${gap.tag} – ${totalInfo}.`,
            );
          }
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

  return {
    createdAssignments: proposed.length,
    unmetStaffing: unmet,
    unfulfilledWishes: unfulfilled,
    warnings,
  };
}
