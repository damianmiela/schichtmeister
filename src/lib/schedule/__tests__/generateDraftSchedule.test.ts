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
  hashString,
  isUnavailableOnDate,
  mergeStaffingRequirements,
  monthlyWorkingDays,
  monthlySollHours,
  mulberry32,
  preferencePenalty,
  rebalanceAssignments,
  selectProfileForEmployee,
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
      ShiftType.BL,
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
      qualificationAbbreviations: [],
      preferredShiftTypes: [],
      targetHours: null,
      targetHoursPeriod: null,
      targetHoursPercent: null,
      contractType: ContractType.FULL_TIME,
      miniJobMaxMonthlyHours: null,
      assignedStationNumber: null,
      allowedShiftProfileIds: new Set(),
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

describe("mulberry32 PRNG", () => {
  it("produces values in [0, 1)", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("same seed produces same sequence", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 20; i++) {
      expect(a()).toBe(b());
    }
  });

  it("different seeds produce different sequences", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });
});

describe("hashString", () => {
  it("returns a number for any string", () => {
    expect(typeof hashString("hello")).toBe("number");
    expect(typeof hashString("")).toBe("number");
  });

  it("same string produces same hash", () => {
    expect(hashString("test-id")).toBe(hashString("test-id"));
  });

  it("different strings produce different hashes", () => {
    expect(hashString("abc")).not.toBe(hashString("xyz"));
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
    startTime: "06:00",
    endTime: "14:00",
    breakMinutes: 0,
    startTime2: null,
    endTime2: null,
    breakMinutes2: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ShiftProfile;

  const profilesById = new Map<string, ShiftProfile>([["early1", earlyProfile]]);

  const mergedStaffing = new Map<string, MergedStaffingEntry>([
    ["EARLY:1", { minTotalCount: 2, maxTotalCount: null, isFacilityWide: false, qualificationRequirements: [] }],
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

  function makeEmp(id: string, targetHours: number | null, tags: string[] = [], assignedStation: number | null = null): GenEmployee {
    return {
      id,
      qualificationTags: tags,
      qualificationAbbreviations: [],
      preferredShiftTypes: [],
      targetHours,
      targetHoursPeriod: TargetHoursPeriod.MONTHLY,
      targetHoursPercent: null,
      contractType: ContractType.FULL_TIME,
      miniJobMaxMonthlyHours: null,
      assignedStationNumber: assignedStation,
      allowedShiftProfileIds: new Set(),
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
          maxTotalCount: null,
          isFacilityWide: false,
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

  it("blocks swap when under-utilized employee is assigned to a different station", () => {
    const empOver = makeEmp("over", 40, [], 1);
    const empUnderSt2 = makeEmp("under_st2", 40, [], 2);
    const employees = [empOver, empUnderSt2];

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

    expect(result.swapsMade).toBe(0);
    const st2Assignments = proposed.filter((a) => a.employeeId === "under_st2");
    expect(st2Assignments.length).toBe(0);
  });

  it("allows swap when under-utilized employee is assigned to the same station", () => {
    const empOver = makeEmp("over", 40, [], 1);
    const empUnderSt1 = makeEmp("under_st1", 40, [], 1);
    const employees = [empOver, empUnderSt1];

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
    const st1Assignments = proposed.filter((a) => a.employeeId === "under_st1");
    expect(st1Assignments.length).toBeGreaterThan(0);
  });

  it("does not swap locked assignments (manual placements)", () => {
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

    const lockedIds = new Set(proposed.map((a) => a.id));

    const result = rebalanceAssignments(
      proposed, employees, profilesById, mergedStaffing, baseSnapshot, period, lockedIds,
    );

    expect(result.swapsMade).toBe(0);
    const underAssignments = proposed.filter((a) => a.employeeId === "under");
    expect(underAssignments.length).toBe(0);
  });

  it("swaps only unlocked assignments when some are locked", () => {
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

    const lockedIds = new Set(["a5", "a6", "a7"]);

    const result = rebalanceAssignments(
      proposed, employees, profilesById, mergedStaffing, baseSnapshot, period, lockedIds,
    );

    expect(result.swapsMade).toBeGreaterThan(0);
    for (const lid of lockedIds) {
      const locked = proposed.find((a) => a.id === lid);
      expect(locked?.employeeId).toBe("over");
    }
    const underAssignments = proposed.filter((a) => a.employeeId === "under");
    expect(underAssignments.length).toBeGreaterThan(0);
  });
});

describe("blocked dates (Frei-Wünsche)", () => {
  it("isUnavailableOnDate returns true after injecting blocked dates into unavailableDateSet", () => {
    const emp: GenEmployee = {
      id: "e1",
      qualificationTags: [],
      qualificationAbbreviations: [],
      preferredShiftTypes: [],
      targetHours: null,
      targetHoursPeriod: null,
      targetHoursPercent: null,
      contractType: ContractType.FULL_TIME,
      miniJobMaxMonthlyHours: null,
      assignedStationNumber: null,
      allowedShiftProfileIds: new Set(),
      unavailableDateSet: new Set(),
    };

    expect(isUnavailableOnDate(emp, "2026-03-10")).toBe(false);
    expect(isUnavailableOnDate(emp, "2026-03-11")).toBe(false);
    expect(isUnavailableOnDate(emp, "2026-03-12")).toBe(false);

    const blockedDates = [
      { employeeId: "e1", date: "2026-03-10" },
      { employeeId: "e1", date: "2026-03-11" },
      { employeeId: "e1", date: "2026-03-12" },
    ];

    const empById = new Map([["e1", emp]]);
    for (const bd of blockedDates) {
      empById.get(bd.employeeId)?.unavailableDateSet.add(bd.date);
    }

    expect(isUnavailableOnDate(emp, "2026-03-10")).toBe(true);
    expect(isUnavailableOnDate(emp, "2026-03-11")).toBe(true);
    expect(isUnavailableOnDate(emp, "2026-03-12")).toBe(true);
    expect(isUnavailableOnDate(emp, "2026-03-13")).toBe(false);
  });

  it("blocked dates only affect the targeted employee", () => {
    const emp1: GenEmployee = {
      id: "e1",
      qualificationTags: [],
      qualificationAbbreviations: [],
      preferredShiftTypes: [],
      targetHours: null,
      targetHoursPeriod: null,
      targetHoursPercent: null,
      contractType: ContractType.FULL_TIME,
      miniJobMaxMonthlyHours: null,
      assignedStationNumber: null,
      allowedShiftProfileIds: new Set(),
      unavailableDateSet: new Set(),
    };
    const emp2: GenEmployee = {
      id: "e2",
      qualificationTags: [],
      qualificationAbbreviations: [],
      preferredShiftTypes: [],
      targetHours: null,
      targetHoursPeriod: null,
      targetHoursPercent: null,
      contractType: ContractType.FULL_TIME,
      miniJobMaxMonthlyHours: null,
      assignedStationNumber: null,
      allowedShiftProfileIds: new Set(),
      unavailableDateSet: new Set(),
    };

    const blockedDates = [{ employeeId: "e1", date: "2026-03-15" }];
    const empById = new Map([["e1", emp1], ["e2", emp2]]);
    for (const bd of blockedDates) {
      empById.get(bd.employeeId)?.unavailableDateSet.add(bd.date);
    }

    expect(isUnavailableOnDate(emp1, "2026-03-15")).toBe(true);
    expect(isUnavailableOnDate(emp2, "2026-03-15")).toBe(false);
  });

  it("blocked dates merge with pre-existing unavailable dates", () => {
    const emp: GenEmployee = {
      id: "e1",
      qualificationTags: [],
      qualificationAbbreviations: [],
      preferredShiftTypes: [],
      targetHours: null,
      targetHoursPeriod: null,
      targetHoursPercent: null,
      contractType: ContractType.FULL_TIME,
      miniJobMaxMonthlyHours: null,
      assignedStationNumber: null,
      allowedShiftProfileIds: new Set(),
      unavailableDateSet: new Set(["2026-03-01"]),
    };

    emp.unavailableDateSet.add("2026-03-02");

    expect(isUnavailableOnDate(emp, "2026-03-01")).toBe(true);
    expect(isUnavailableOnDate(emp, "2026-03-02")).toBe(true);
    expect(isUnavailableOnDate(emp, "2026-03-03")).toBe(false);
  });

  it("ignores blocked dates for unknown employee IDs without error", () => {
    const emp: GenEmployee = {
      id: "e1",
      qualificationTags: [],
      qualificationAbbreviations: [],
      preferredShiftTypes: [],
      targetHours: null,
      targetHoursPeriod: null,
      targetHoursPercent: null,
      contractType: ContractType.FULL_TIME,
      miniJobMaxMonthlyHours: null,
      assignedStationNumber: null,
      allowedShiftProfileIds: new Set(),
      unavailableDateSet: new Set(),
    };

    const blockedDates = [{ employeeId: "nonexistent", date: "2026-03-10" }];
    const empById = new Map([["e1", emp]]);
    for (const bd of blockedDates) {
      empById.get(bd.employeeId)?.unavailableDateSet.add(bd.date);
    }

    expect(isUnavailableOnDate(emp, "2026-03-10")).toBe(false);
  });
});

describe("monthlyWorkingDays & monthlySollHours", () => {
  it("counts weekdays in March 2026 (22 working days)", () => {
    expect(monthlyWorkingDays(2026, 2)).toBe(22);
  });

  it("counts weekdays in February 2026 (20 working days)", () => {
    expect(monthlyWorkingDays(2026, 1)).toBe(20);
  });

  it("calculates Soll hours for 100% in March 2026", () => {
    expect(monthlySollHours(22, 100)).toBe(176);
  });

  it("calculates Soll hours for 75% in March 2026", () => {
    expect(monthlySollHours(22, 75)).toBe(132);
  });

  it("calculates Soll hours for 50%", () => {
    expect(monthlySollHours(20, 50)).toBe(80);
  });
});

describe("selectProfileForEmployee", () => {
  const profiles = [
    { id: "f1", name: "F1", shiftType: ShiftType.EARLY, isActive: true, startTime: "06:00", endTime: "13:30", breakMinutes: 0 },
    { id: "f2", name: "F2", shiftType: ShiftType.EARLY, isActive: true, startTime: "06:00", endTime: "14:30", breakMinutes: 0 },
    { id: "s1", name: "S1", shiftType: ShiftType.LATE, isActive: true, startTime: "13:00", endTime: "21:30", breakMinutes: 0 },
    { id: "n1", name: "N", shiftType: ShiftType.NIGHT, isActive: true, startTime: "21:00", endTime: "06:30", breakMinutes: 0 },
    { id: "inactive", name: "X", shiftType: ShiftType.EARLY, isActive: false, startTime: "06:00", endTime: "10:00", breakMinutes: 0 },
  ] as any[];

  it("returns first matching active profile when no allowedShiftProfileIds", () => {
    const emp: GenEmployee = {
      id: "e1",
      qualificationTags: [],
      qualificationAbbreviations: [],
      preferredShiftTypes: [],
      targetHours: null,
      targetHoursPeriod: null,
      targetHoursPercent: null,
      contractType: ContractType.FULL_TIME,
      miniJobMaxMonthlyHours: null,
      assignedStationNumber: null,
      allowedShiftProfileIds: new Set(),
      unavailableDateSet: new Set(),
    };
    const result = selectProfileForEmployee(emp, ShiftType.EARLY, profiles);
    expect(result).not.toBeNull();
    expect(result!.shiftType).toBe(ShiftType.EARLY);
  });

  it("filters by allowedShiftProfileIds", () => {
    const emp: GenEmployee = {
      id: "e1",
      qualificationTags: [],
      qualificationAbbreviations: [],
      preferredShiftTypes: [],
      targetHours: null,
      targetHoursPeriod: null,
      targetHoursPercent: null,
      contractType: ContractType.FULL_TIME,
      miniJobMaxMonthlyHours: null,
      assignedStationNumber: null,
      allowedShiftProfileIds: new Set(["f2"]),
      unavailableDateSet: new Set(),
    };
    const result = selectProfileForEmployee(emp, ShiftType.EARLY, profiles);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("f2");
  });

  it("returns null when no matching profiles", () => {
    const emp: GenEmployee = {
      id: "e1",
      qualificationTags: [],
      qualificationAbbreviations: [],
      preferredShiftTypes: [],
      targetHours: null,
      targetHoursPeriod: null,
      targetHoursPercent: null,
      contractType: ContractType.FULL_TIME,
      miniJobMaxMonthlyHours: null,
      assignedStationNumber: null,
      allowedShiftProfileIds: new Set(["nonexistent"]),
      unavailableDateSet: new Set(),
    };
    const result = selectProfileForEmployee(emp, ShiftType.EARLY, profiles);
    expect(result).toBeNull();
  });

  it("excludes inactive profiles", () => {
    const emp: GenEmployee = {
      id: "e1",
      qualificationTags: [],
      qualificationAbbreviations: [],
      preferredShiftTypes: [],
      targetHours: null,
      targetHoursPeriod: null,
      targetHoursPercent: null,
      contractType: ContractType.FULL_TIME,
      miniJobMaxMonthlyHours: null,
      assignedStationNumber: null,
      allowedShiftProfileIds: new Set(["inactive"]),
      unavailableDateSet: new Set(),
    };
    const result = selectProfileForEmployee(emp, ShiftType.EARLY, profiles);
    expect(result).toBeNull();
  });
});

describe("rebalanceAssignments respects allowedShiftProfileIds", () => {
  beforeEach(() => {
    resetRuleRegistry();
    registerBuiltInPlanningRules();
  });

  const earlyProfile = {
    id: "early1",
    facilityId: "f",
    name: "F1",
    shiftType: ShiftType.EARLY,
    startTime: "06:00",
    endTime: "14:00",
    breakMinutes: 0,
    startTime2: null,
    endTime2: null,
    breakMinutes2: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;

  const profilesById = new Map([["early1", earlyProfile]]);
  const mergedStaffing = new Map<string, MergedStaffingEntry>([
    ["EARLY:1", { minTotalCount: 2, maxTotalCount: null, isFacilityWide: false, qualificationRequirements: [] }],
  ]);

  const baseSnapshot = {
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
  } as PlanningRulesSnapshot;

  const period = {
    periodStart: new Date(Date.UTC(2026, 0, 5)),
    periodEnd: new Date(Date.UTC(2026, 0, 11)),
  };

  it("blocks swap when under-employee has no matching allowedShiftProfileIds", () => {
    const empOver: GenEmployee = {
      id: "over",
      qualificationTags: [],
      qualificationAbbreviations: [],
      preferredShiftTypes: [],
      targetHours: 40,
      targetHoursPeriod: TargetHoursPeriod.MONTHLY,
      targetHoursPercent: null,
      contractType: ContractType.FULL_TIME,
      miniJobMaxMonthlyHours: null,
      assignedStationNumber: null,
      allowedShiftProfileIds: new Set(),
      unavailableDateSet: new Set(),
    };
    const empUnder: GenEmployee = {
      id: "under",
      qualificationTags: [],
      qualificationAbbreviations: [],
      preferredShiftTypes: [],
      targetHours: 40,
      targetHoursPeriod: TargetHoursPeriod.MONTHLY,
      targetHoursPercent: null,
      contractType: ContractType.FULL_TIME,
      miniJobMaxMonthlyHours: null,
      assignedStationNumber: null,
      allowedShiftProfileIds: new Set(["late1"]),
      unavailableDateSet: new Set(),
    };

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
      proposed, [empOver, empUnder], profilesById, mergedStaffing, baseSnapshot, period,
    );

    expect(result.swapsMade).toBe(0);
  });
});
