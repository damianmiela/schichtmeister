import { describe, it, expect } from "vitest";
import {
  ContractType,
  ShiftType,
  TargetHoursPeriod,
  WishPriority,
  WishStatus,
} from "@prisma/client";
import type { AssignmentInput } from "@/lib/planning/types";
import {
  type GenEmployee,
  SHIFT_TYPE_ORDER,
  buildDefaultProfileByShiftType,
  eachUtcDateInPeriod,
  employeeHasAllTags,
  isUnavailableOnDate,
  mergeStaffingRequirements,
  preferencePenalty,
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

  it("merges staffing rows on same shift type (defensive)", () => {
    const m = mergeStaffingRequirements([
      {
        shiftType: ShiftType.EARLY,
        minStaffCount: 2,
        requiredQualificationTags: ["A"],
      },
      {
        shiftType: ShiftType.EARLY,
        minStaffCount: 1,
        requiredQualificationTags: ["B"],
      },
    ]);
    const e = m.get(ShiftType.EARLY);
    expect(e?.minStaffCount).toBe(3);
    expect(e?.requiredQualificationTags.sort()).toEqual(["A", "B"]);
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
