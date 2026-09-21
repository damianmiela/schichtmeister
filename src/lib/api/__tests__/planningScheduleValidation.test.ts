import { describe, it, expect, vi } from "vitest";
import { ContractType, ShiftType } from "@prisma/client";
import { validateScheduleAssignments } from "@/lib/api/planningScheduleValidation";
import type { AssignmentInput } from "@/lib/planning/types";

const facilityId = "f1";
const periodStart = new Date(Date.UTC(2026, 0, 1));
const periodEnd = new Date(Date.UTC(2026, 0, 3));

function mockDb() {
  return {
    facility: {
      findUnique: vi.fn().mockResolvedValue({
        id: facilityId,
        minRestHours: 11,
        miniJobMaxMonthlyHours: 520,
        ruleOverridesJson: null,
      }),
    },
    employee: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "e1",
          contractType: ContractType.FULL_TIME,
          miniJobMaxMonthlyHours: null,
          qualificationTags: ["Fachkraft"],
        },
      ]),
    },
    shiftProfile: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "prof-early",
          shiftType: ShiftType.EARLY,
          stationNumber: 1,
          startTime: "06:00",
          endTime: "14:30",
          breakMinutes: 30,
        },
        {
          id: "prof-late",
          shiftType: ShiftType.LATE,
          stationNumber: 1,
          startTime: "12:00",
          endTime: "20:30",
          breakMinutes: 30,
        },
      ]),
    },
    staffingRequirement: {
      findMany: vi.fn().mockResolvedValue([
        {
          shiftType: ShiftType.EARLY,
          stationNumber: 1,
          minTotalCount: 1,
          qualificationRequirements: [{ qualificationTag: "Fachkraft", minCount: 1 }],
        },
        {
          shiftType: ShiftType.LATE,
          stationNumber: 1,
          minTotalCount: 1,
          qualificationRequirements: [{ qualificationTag: "Fachkraft", minCount: 1 }],
        },
      ]),
    },
    employeeAbsence: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    // No previous month, so there are no boundary assignments to load.
    schedule: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
}

describe("validateScheduleAssignments", () => {
  it("flags staffing/qualification gaps on partial roster by default", async () => {
    const db = mockDb();
    const oneSlot: AssignmentInput[] = [
      {
        id: "a1",
        date: new Date(Date.UTC(2026, 0, 1)),
        shiftProfileId: "prof-early",
        employeeId: "e1",
      },
    ];
    const v = await validateScheduleAssignments(
      db as never,
      facilityId,
      { periodStart, periodEnd },
      oneSlot,
    );
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.result.errors.length).toBeGreaterThan(0);
      expect(v.result.errors.some((e) => e.ruleId === "staffingMinimum")).toBe(true);
    }
  });

  it("ruleScope 'employee' skips global staffing rules so greedy fill can start", async () => {
    const db = mockDb();
    const oneSlot: AssignmentInput[] = [
      {
        id: "a1",
        date: new Date(Date.UTC(2026, 0, 1)),
        shiftProfileId: "prof-early",
        employeeId: "e1",
      },
    ];
    const v = await validateScheduleAssignments(
      db as never,
      facilityId,
      { periodStart, periodEnd },
      oneSlot,
      { ruleScope: "employee" },
    );
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.result.errors).toEqual([]);
    }
  });
});
