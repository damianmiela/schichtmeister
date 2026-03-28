import { describe, it, expect, beforeEach } from "vitest";
import {
  ContractType,
  ShiftType,
  TargetHoursPeriod,
  WishPriority,
  WishStatus,
} from "@prisma/client";
import type { ShiftProfile } from "@prisma/client";
import type { AssignmentInput, PlanningRulesSnapshot } from "@/lib/planning/types";
import { registerBuiltInPlanningRules, resetRuleRegistry } from "@/lib/planning";
import {
  type GenEmployee,
  type MergedStaffingEntry,
  SHIFT_TYPE_ORDER,
  buildDefaultProfileByShiftType,
  eachUtcDateInPeriod,
  employeeHasAllTags,
  isUnavailableOnDate,
  mergeStaffingRequirements,
  preferencePenalty,
  rebalanceAssignments,
  sumPaidHoursForEmployeeInProposed,
  schedulingTargetHoursBonus,
  wishBonusForSlot,
} from "@/lib/schedule/generateDraftSchedule";

describe("phase 07 — generate draft schedule (pure helpers)", () => {
  it("uses fixed shift order for determinism", () => {
    expect(SHIFT_TYPE_ORDER).toEqual([
      ShiftType.EARLY,
      ShiftType.LATE,
      ShiftType.NIGHT,
    ]);
  });

  it("merges staffing rows on same (shiftType, stationNumber) key (defensive)", () => {
    const m = mergeStaffingRequirements([
      {
        shiftType: ShiftType.EARLY,
        stationNumber: 1,
        minTotalCount: 2,
        qualificationRequirements: [{ qualificationTag: "A", minCount: 1 }],
      },
      {
        shiftType: ShiftType.EARLY,
        stationNumber: 1,
        minTotalCount: 1,
        qualificationRequirements: [{ qualificationTag: "B", minCount: 2 }],
      },
    ]);
    const e = m.get("EARLY:1");
    expect(e?.minTotalCount).toBe(3);
    expect(e?.qualificationRequirements.map((q) => q.qualificationTag).sort()).toEqual(["A", "B"]);
    expect(e?.qualificationRequirements.find((q) => q.qualificationTag === "B")?.minCount).toBe(2);
  });

  it("iterates UTC dates inclusive", () => {
    const start = new Date(Date.UTC(2026, 0, 5));
    const end = new Date(Date.UTC(2026, 0, 7));
    const d = eachUtcDateInPeriod(start, end);
    expect(d.map((x) => x.toISOString().slice(0, 10))).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
    ]);
  });

  it("marks employee unavailable when availability row exists for that day", () => {
    const emp: GenEmployee = {
      id: "e1",
      qualificationTags: [],
      preferredShiftTypes: [],
      targetHours: null,
      targetHoursPeriod: null,
      contractType: ContractType.FULL_TIME,
      miniJobMaxMonthlyHours: null,
      unavailableDateSet: new Set(["2026-02-01"]),
    };
    expect(isUnavailableOnDate(emp, "2026-02-01")).toBe(true);
    expect(isUnavailableOnDate(emp, "2026-02-02")).toBe(false);
  });

  it("qualification tags subset check", () => {
    expect(employeeHasAllTags(["x", "y"], ["x"])).toBe(true);
    expect(employeeHasAllTags(["x"], ["x", "y"])).toBe(false);
    expect(employeeHasAllTags([], [])).toBe(true);
  });

  it("wish bonus: stronger wish and profile match beat weaker shift-only", () => {
    const date = new Date(Date.UTC(2026, 0, 10));
    const wishes = [
      {
        employeeId: "e1",
        date,
        shiftType: null,
        shiftProfileId: "p1",
        priority: WishPriority.STRONG,
        status: WishStatus.OPEN,
      },
      {
        employeeId: "e2",
        date,
        shiftType: ShiftType.EARLY,
        shiftProfileId: null,
        priority: WishPriority.NORMAL,
        status: WishStatus.OPEN,
      },
    ];
    const b1 = wishBonusForSlot(wishes, "e1", "2026-01-10", ShiftType.EARLY, "p1");
    const b2 = wishBonusForSlot(wishes, "e2", "2026-01-10", ShiftType.EARLY, "px");
    expect(b1).toBeGreaterThan(b2);
  });

  it("preference penalty when shift not preferred", () => {
    expect(preferencePenalty([ShiftType.LATE], ShiftType.EARLY)).toBe(5);
    expect(preferencePenalty([ShiftType.EARLY], ShiftType.EARLY)).toBe(0);
    expect(preferencePenalty([], ShiftType.NIGHT)).toBe(0);
  });

  it("scheduling target bonus when under weekly hours", () => {
    const b = schedulingTargetHoursBonus(40, TargetHoursPeriod.WEEKLY, 10);
    expect(b).toBeGreaterThan(0);
    expect(schedulingTargetHoursBonus(40, TargetHoursPeriod.WEEKLY, 50)).toBe(0);
  });

  it("scheduling target bonus when under monthly hours", () => {
    const b = schedulingTargetHoursBonus(173, TargetHoursPeriod.MONTHLY, 50);
    expect(b).toBeGreaterThan(0);
    expect(schedulingTargetHoursBonus(173, TargetHoursPeriod.MONTHLY, 200)).toBe(0);
  });

  it("sums paid hours from proposed slice", () => {
    const day = new Date(Date.UTC(2026, 0, 6));
    const proposed: AssignmentInput[] = [
      {
        id: "1",
        date: day,
        shiftProfileId: "p",
        employeeId: "e1",
      },
    ];
    const profiles = new Map([
      ["p", { startTime: "06:00", endTime: "14:00", breakMinutes: 0 }],
    ]);
    const h = sumPaidHoursForEmployeeInProposed("e1", proposed, profiles);
    expect(h).toBe(8);
  });

  it("picks lexicographically first active profile per shift type", () => {
    const m = buildDefaultProfileByShiftType([
      {
        id: "b",
        name: "B_early",
        shiftType: ShiftType.EARLY,
        isActive: true,
      },
      {
        id: "a",
        name: "A_early",
        shiftType: ShiftType.EARLY,
        isActive: true,
      },
      {
        id: "z",
        name: "Z_late",
        shiftType: ShiftType.LATE,
        isActive: true,
      },
    ]);
    expect(m.get(ShiftType.EARLY)?.id).toBe("a");
    expect(m.get(ShiftType.LATE)?.id).toBe("z");
  });

  it("snapshot: empty generate report shape", () => {
    expect({
      createdAssignments: 0,
      unmetStaffing: [],
      unfulfilledWishes: [],
      warnings: [],
    }).toMatchInlineSnapshot(`
      {
        "createdAssignments": 0,
        "unfulfilledWishes": [],
        "unmetStaffing": [],
        "warnings": [],
      }
    `);
  });
});

describe("rebalanceAssignments", () => {
  beforeEach(() => {
    resetRuleRegistry();
    registerBuiltInPlanningRules();
  });

  const earlyProfile = {
    id: "early1",
    facilityId: "f",
    name: "F1",
    shiftType: ShiftType.EARLY,
    stationNumber: 1,
    startTime: "06:00",
    endTime: "14:00",
    breakMinutes: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ShiftProfile;

  const profilesById = new Map<string, ShiftProfile>([["early1", earlyProfile]]);

  const mergedStaffing = new Map<string, MergedStaffingEntry>([
    ["EARLY:1", { minTotalCount: 2, qualificationRequirements: [] }],
  ]);

  const baseSnapshot: PlanningRulesSnapshot = {
    schemaVersion: 1,
    minRestHours: 11,
    miniJobMaxMonthlyHours: 520,
    maxConsecutiveNightsEnabled: false,
    ruleStates: {
      noOverlap: { enabled: true, params: {} },
      minRestBetweenShifts: { enabled: true, params: {} },
      miniJobMonthlyHours: { enabled: true, params: {} },
      maxConsecutiveNights: { enabled: true, params: { maxCount: 3 } },
      maxConsecutiveDays: { enabled: true, params: { maxDays: 7, requiredRestDays: 2 } },
    },
  };

  const period = {
    periodStart: new Date(Date.UTC(2026, 0, 5)),
    periodEnd: new Date(Date.UTC(2026, 0, 11)),
  };

  function makeEmp(id: string, targetHours: number | null, tags: string[] = []): GenEmployee {
    return {
      id,
      qualificationTags: tags,
      preferredShiftTypes: [],
      targetHours,
      targetHoursPeriod: TargetHoursPeriod.MONTHLY,
      contractType: ContractType.FULL_TIME,
      miniJobMaxMonthlyHours: null,
      unavailableDateSet: new Set(),
    };
  }

  it("swaps shifts from over-utilized to under-utilized employees", () => {
    const empOver = makeEmp("over", 40);
    const empUnder = makeEmp("under", 40);
    const employees = [empOver, empUnder];

    const proposed: AssignmentInput[] = [];
    for (let d = 5; d <= 11; d++) {
      proposed.push({
        id: `a${d}`,
        date: new Date(Date.UTC(2026, 0, d)),
        shiftProfileId: "early1",
        employeeId: "over",
      });
    }

    const result = rebalanceAssignments(
      proposed, employees, profilesById, mergedStaffing, baseSnapshot, period,
    );

    expect(result.swapsMade).toBeGreaterThan(0);
    const underAssignments = proposed.filter((a) => a.employeeId === "under");
    expect(underAssignments.length).toBeGreaterThan(0);
  });

  it("does nothing when hours are already balanced", () => {
    const emp1 = makeEmp("e1", 40);
    const emp2 = makeEmp("e2", 40);
    const employees = [emp1, emp2];

    const proposed: AssignmentInput[] = [
      { id: "a1", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "early1", employeeId: "e1" },
      { id: "a2", date: new Date(Date.UTC(2026, 0, 6)), shiftProfileId: "early1", employeeId: "e2" },
      { id: "a3", date: new Date(Date.UTC(2026, 0, 7)), shiftProfileId: "early1", employeeId: "e1" },
      { id: "a4", date: new Date(Date.UTC(2026, 0, 8)), shiftProfileId: "early1", employeeId: "e2" },
    ];

    const result = rebalanceAssignments(
      proposed, employees, profilesById, mergedStaffing, baseSnapshot, period,
    );

    expect(result.swapsMade).toBe(0);
  });

  it("respects qualification requirements during swaps", () => {
    const staffingWithQual = new Map<string, MergedStaffingEntry>([
      [
        "EARLY:1",
        {
          minTotalCount: 1,
          qualificationRequirements: [{ qualificationTag: "Fachkraft", minCount: 1 }],
        },
      ],
    ]);

    const empQualified = makeEmp("fk", 40, ["Fachkraft"]);
    const empUnqualified = makeEmp("hk", 40);
    const employees = [empQualified, empUnqualified];

    const proposed: AssignmentInput[] = [];
    for (let d = 5; d <= 11; d++) {
      proposed.push({
        id: `a${d}`,
        date: new Date(Date.UTC(2026, 0, d)),
        shiftProfileId: "early1",
        employeeId: "fk",
      });
    }

    const result = rebalanceAssignments(
      proposed, employees, profilesById, staffingWithQual, baseSnapshot, period,
    );

    const fkAssignments = proposed.filter((a) => a.employeeId === "fk");
    expect(fkAssignments.length).toBe(7);
    expect(result.swapsMade).toBe(0);
  });

  it("includes employees without targetHours in rebalancing", () => {
    const empWithTarget = makeEmp("wt", 40);
    const empNoTarget = makeEmp("nt", null);
    const employees = [empWithTarget, empNoTarget];

    const proposed: AssignmentInput[] = [];
    for (let d = 5; d <= 11; d++) {
      proposed.push({
        id: `a${d}`,
        date: new Date(Date.UTC(2026, 0, d)),
        shiftProfileId: "early1",
        employeeId: "wt",
      });
    }

    const result = rebalanceAssignments(
      proposed, employees, profilesById, mergedStaffing, baseSnapshot, period,
    );

    expect(result.swapsMade).toBeGreaterThan(0);
    const ntAssignments = proposed.filter((a) => a.employeeId === "nt");
    expect(ntAssignments.length).toBeGreaterThan(0);
  });

  it("does not swap when only one employee exists", () => {
    const emp = makeEmp("solo", 40);
    const proposed: AssignmentInput[] = [
      { id: "a1", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "early1", employeeId: "solo" },
    ];

    const result = rebalanceAssignments(
      proposed, [emp], profilesById, mergedStaffing, baseSnapshot, period,
    );

    expect(result.swapsMade).toBe(0);
  });
});
