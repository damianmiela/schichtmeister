import { describe, it, expect, beforeEach } from "vitest";
import { ContractType, Prisma, ShiftType } from "@prisma/client";
import { defaultPlanningRulesConfig } from "@/lib/planning/defaultConfig";
import { mergePlanningRules, type FacilityRulesSlice } from "@/lib/planning/merge";
import { registerBuiltInPlanningRules } from "@/lib/planning/registerBuiltInRules";
import { registerRule, resetRuleRegistry, runAllRules, runScopedRules, getRegisteredRules } from "@/lib/planning/registry";
import { parsePlanningRulesConfig } from "@/lib/planning/rules/schema";
import { shiftIntervalMs, assignmentPaidHours, datesInPeriodUtc, sameUtcCalendarDay } from "@/lib/planning/time";
import type {
  PlanningRulesSnapshot,
  RuleContext,
  RuleFn,
} from "@/lib/planning/types";

function facilitySlice(
  minRestHours: number,
  miniJobMaxMonthlyHours: number,
  ruleOverridesJson: string | null = null,
): FacilityRulesSlice {
  return {
    minRestHours: new Prisma.Decimal(minRestHours),
    miniJobMaxMonthlyHours: new Prisma.Decimal(miniJobMaxMonthlyHours),
    ruleOverridesJson,
  };
}

function baseSnapshot(overrides?: Partial<PlanningRulesSnapshot>): PlanningRulesSnapshot {
  return {
    schemaVersion: 1,
    minRestHours: 11,
    miniJobMaxMonthlyHours: 520,
    maxConsecutiveNightsEnabled: false,
    ruleStates: {
      noOverlap: { enabled: true, params: {} },
      minRestBetweenShifts: { enabled: true, params: {} },
      miniJobMonthlyHours: { enabled: true, params: {} },
      staffingMinimum: { enabled: true, params: {} },
      qualificationCoverage: { enabled: true, params: {} },
      wishFulfillment: { enabled: false, params: {} },
      fairnessCounters: { enabled: false, params: {} },
      targetHoursBalance: { enabled: false, params: {} },
      maxConsecutiveNights: { enabled: true, params: { maxCount: 3 } },
    },
    ...overrides,
  };
}

function minimalCtx(partial: Partial<RuleContext> & Pick<RuleContext, "assignments">): RuleContext {
  return {
    periodStart: new Date(Date.UTC(2026, 0, 5)),
    periodEnd: new Date(Date.UTC(2026, 0, 11)),
    employeesById: new Map(),
    profilesById: new Map(),
    staffingRequirements: [],
    wishes: [],
    snapshot: baseSnapshot(),
    ...partial,
  };
}

describe("phase 04 — planning rules", () => {
  beforeEach(() => {
    resetRuleRegistry();
    registerBuiltInPlanningRules();
  });

  describe("default JSON + schema", () => {
    it("parses committed default config", () => {
      const cfg = parsePlanningRulesConfig(defaultPlanningRulesConfig);
      expect(cfg.schemaVersion).toBe(1);
      expect(cfg.rules.some((r) => r.id === "noOverlap" && r.enabled)).toBe(true);
    });

    it("rejects invalid config", () => {
      expect(() => parsePlanningRulesConfig({ schemaVersion: "bad" })).toThrow();
    });
  });

  describe("mergePlanningRules", () => {
    it("uses facility DB numbers for rest and mini-job cap", () => {
      const merged = mergePlanningRules(facilitySlice(14, 99), defaultPlanningRulesConfig);
      expect(merged.minRestHours).toBe(14);
      expect(merged.miniJobMaxMonthlyHours).toBe(99);
    });

    it("applies ruleOverridesJson from facility", () => {
      const overrides = JSON.stringify({
        noOverlap: { enabled: false },
        maxConsecutiveNights: { enabled: true, params: { maxCount: 5 } },
      });
      const merged = mergePlanningRules(facilitySlice(11, 520, overrides), defaultPlanningRulesConfig);
      expect(merged.ruleStates.noOverlap?.enabled).toBe(false);
      expect(merged.ruleStates.maxConsecutiveNights?.enabled).toBe(true);
      expect(merged.ruleStates.maxConsecutiveNights?.params?.maxCount).toBe(5);
    });

    it("ignores invalid ruleOverridesJson", () => {
      const merged = mergePlanningRules(facilitySlice(11, 520, "not json"), defaultPlanningRulesConfig);
      expect(merged.ruleStates.noOverlap?.enabled).toBe(true);
    });
  });

  describe("PlanningRulesSnapshot", () => {
    it("constructs a resolved snapshot", () => {
      const s = baseSnapshot({ minRestHours: 10 });
      expect(s.minRestHours).toBe(10);
      expect(s.ruleStates.noOverlap?.enabled).toBe(true);
    });
  });

  describe("registry", () => {
    it("returns empty when no rules match enabled ids", () => {
      resetRuleRegistry();
      const ctx = minimalCtx({
        assignments: [],
        snapshot: baseSnapshot({ ruleStates: { onlyUnknown: { enabled: true, params: {} } } }),
      });
      const out = runAllRules(ctx);
      expect(out.errors).toEqual([]);
      expect(out.warnings).toEqual([]);
    });

    it("runs a registered stub rule", () => {
      resetRuleRegistry();
      const stub: RuleFn = () => ({
        errors: [{ ruleId: "stub", code: "T", message: "test" }],
        warnings: [],
      });
      registerRule({ id: "stub", severity: "hard", scope: "employee", description: "test stub" }, stub);
      const ctx = minimalCtx({
        assignments: [],
        snapshot: baseSnapshot({
          ruleStates: { stub: { enabled: true, params: {} } },
        }),
      });
      const out = runAllRules(ctx);
      expect(out.errors).toHaveLength(1);
      expect(out.errors[0]!.ruleId).toBe("stub");
    });
  });

  describe("shiftIntervalMs / assignmentPaidHours", () => {
    it("treats end before start as next calendar day", () => {
      const day = new Date(Date.UTC(2026, 0, 5));
      const { startMs, endMs } = shiftIntervalMs(day, "21:30", "06:30");
      expect(endMs - startMs).toBe(9 * 60 * 60 * 1000);
    });

    it("computes paid hours minus break", () => {
      const day = new Date(Date.UTC(2026, 0, 5));
      const h = assignmentPaidHours(day, "06:00", "14:30", 30);
      expect(h).toBe(8);
    });
  });

  describe("noOverlap", () => {
    it("detects overlapping assignments", () => {
      const profiles = new Map([
        [
          "p1",
          {
            id: "p1",
            shiftType: ShiftType.EARLY,
            stationNumber: 1,
            startTime: "06:00",
            endTime: "14:00",
            breakMinutes: 0,
          },
        ],
      ]);
      const ctx = minimalCtx({
        assignments: [
          { id: "a1", date: new Date(Date.UTC(2026, 0, 6)), shiftProfileId: "p1", employeeId: "e1" },
          { id: "a2", date: new Date(Date.UTC(2026, 0, 6)), shiftProfileId: "p1", employeeId: "e1" },
        ],
        profilesById: profiles,
        snapshot: baseSnapshot({ ruleStates: { noOverlap: { enabled: true, params: {} } } }),
      });
      const { errors } = runAllRules(ctx);
      expect(errors.some((e) => e.code === "OVERLAP")).toBe(true);
    });

    it("allows adjacent shifts with no overlap", () => {
      const profiles = new Map([
        [
          "early",
          {
            id: "early",
            shiftType: ShiftType.EARLY,
            stationNumber: 1,
            startTime: "06:00",
            endTime: "14:00",
            breakMinutes: 0,
          },
        ],
        [
          "late",
          {
            id: "late",
            shiftType: ShiftType.LATE,
            stationNumber: 1,
            startTime: "14:00",
            endTime: "22:00",
            breakMinutes: 0,
          },
        ],
      ]);
      const ctx = minimalCtx({
        assignments: [
          { id: "a1", date: new Date(Date.UTC(2026, 0, 6)), shiftProfileId: "early", employeeId: "e1" },
          { id: "a2", date: new Date(Date.UTC(2026, 0, 6)), shiftProfileId: "late", employeeId: "e1" },
        ],
        profilesById: profiles,
        snapshot: baseSnapshot({
          ruleStates: {
            noOverlap: { enabled: true, params: {} },
            minRestBetweenShifts: { enabled: false, params: {} },
          },
        }),
      });
      const { errors } = runAllRules(ctx);
      expect(errors.filter((e) => e.ruleId === "noOverlap")).toEqual([]);
    });
  });

  describe("minRestBetweenShifts", () => {
    it("flags insufficient rest across same UTC day using profile times", () => {
      const profiles = new Map([
        [
          "a",
          {
            id: "a",
            shiftType: ShiftType.EARLY,
            stationNumber: 1,
            startTime: "06:00",
            endTime: "08:00",
            breakMinutes: 0,
          },
        ],
        [
          "b",
          {
            id: "b",
            shiftType: ShiftType.LATE,
            stationNumber: 1,
            startTime: "18:00",
            endTime: "22:00",
            breakMinutes: 0,
          },
        ],
      ]);
      const ctx = minimalCtx({
        assignments: [
          { id: "x1", date: new Date(Date.UTC(2026, 0, 6)), shiftProfileId: "a", employeeId: "e1" },
          { id: "x2", date: new Date(Date.UTC(2026, 0, 6)), shiftProfileId: "b", employeeId: "e1" },
        ],
        profilesById: profiles,
        snapshot: baseSnapshot({
          minRestHours: 11,
          ruleStates: {
            noOverlap: { enabled: false, params: {} },
            minRestBetweenShifts: { enabled: true, params: {} },
          },
        }),
      });
      const { errors } = runAllRules(ctx);
      expect(errors.some((e) => e.code === "INSUFFICIENT_REST")).toBe(true);
    });

    it("passes when gap meets minRestHours (overnight)", () => {
      const profiles = new Map([
        [
          "a",
          {
            id: "a",
            shiftType: ShiftType.EARLY,
            stationNumber: 1,
            startTime: "06:00",
            endTime: "14:30",
            breakMinutes: 0,
          },
        ],
      ]);
      const ctx = minimalCtx({
        assignments: [
          { id: "x1", date: new Date(Date.UTC(2026, 0, 6)), shiftProfileId: "a", employeeId: "e1" },
          { id: "x2", date: new Date(Date.UTC(2026, 0, 7)), shiftProfileId: "a", employeeId: "e1" },
        ],
        profilesById: profiles,
        snapshot: baseSnapshot({
          minRestHours: 11,
          ruleStates: {
            noOverlap: { enabled: false, params: {} },
            minRestBetweenShifts: { enabled: true, params: {} },
          },
        }),
      });
      const { errors } = runAllRules(ctx);
      expect(errors.filter((e) => e.ruleId === "minRestBetweenShifts")).toEqual([]);
    });
  });

  describe("miniJobMonthlyHours", () => {
    it("sums paid hours per calendar month vs limit", () => {
      const profiles = new Map([
        [
          "p",
          {
            id: "p",
            shiftType: ShiftType.EARLY,
            stationNumber: 1,
            startTime: "06:00",
            endTime: "10:00",
            breakMinutes: 0,
          },
        ],
      ]);
      const employees = new Map([
        [
          "mj",
          {
            id: "mj",
            contractType: ContractType.MINI_JOB,
            miniJobMaxMonthlyHours: null,
            qualificationTags: [],
          },
        ],
      ]);
      const ctx = minimalCtx({
        assignments: [
          { id: "m1", date: new Date(Date.UTC(2026, 0, 10)), shiftProfileId: "p", employeeId: "mj" },
          { id: "m2", date: new Date(Date.UTC(2026, 0, 12)), shiftProfileId: "p", employeeId: "mj" },
        ],
        employeesById: employees,
        profilesById: profiles,
        snapshot: baseSnapshot({
          miniJobMaxMonthlyHours: 6,
          ruleStates: {
            noOverlap: { enabled: false, params: {} },
            minRestBetweenShifts: { enabled: false, params: {} },
            miniJobMonthlyHours: { enabled: true, params: {} },
            staffingMinimum: { enabled: false, params: {} },
            qualificationCoverage: { enabled: false, params: {} },
          },
        }),
      });
      const { errors } = runAllRules(ctx);
      expect(errors.some((e) => e.code === "MINI_JOB_CAP")).toBe(true);
    });
  });

  describe("staffingMinimum", () => {
    it("requires minTotalCount per day and shift type and station", () => {
      const profiles = new Map([
        [
          "early",
          {
            id: "early",
            shiftType: ShiftType.EARLY,
            stationNumber: 1,
            startTime: "06:00",
            endTime: "14:00",
            breakMinutes: 0,
          },
        ],
      ]);
      const ctx = minimalCtx({
        periodStart: new Date(Date.UTC(2026, 0, 5)),
        periodEnd: new Date(Date.UTC(2026, 0, 5)),
        assignments: [
          { id: "a1", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "early", employeeId: "e1" },
        ],
        profilesById: profiles,
        staffingRequirements: [
          { shiftType: ShiftType.EARLY, stationNumber: 1, minTotalCount: 2, qualificationRequirements: [] },
        ],
        snapshot: baseSnapshot({
          ruleStates: {
            noOverlap: { enabled: false, params: {} },
            minRestBetweenShifts: { enabled: false, params: {} },
            miniJobMonthlyHours: { enabled: false, params: {} },
            staffingMinimum: { enabled: true, params: {} },
            qualificationCoverage: { enabled: false, params: {} },
          },
        }),
      });
      const { errors } = runAllRules(ctx);
      expect(errors.some((e) => e.code === "UNDERSTAFFED")).toBe(true);
    });
  });

  describe("qualificationCoverage", () => {
    it("errors when no assigned employee has the required tag", () => {
      const profiles = new Map([
        [
          "night",
          {
            id: "night",
            shiftType: ShiftType.NIGHT,
            stationNumber: 1,
            startTime: "22:00",
            endTime: "06:00",
            breakMinutes: 0,
          },
        ],
      ]);
      const employees = new Map([
        [
          "e1",
          {
            id: "e1",
            contractType: ContractType.FULL_TIME,
            miniJobMaxMonthlyHours: null,
            qualificationTags: ["Hilfskraft"],
          },
        ],
      ]);
      const ctx = minimalCtx({
        periodStart: new Date(Date.UTC(2026, 0, 5)),
        periodEnd: new Date(Date.UTC(2026, 0, 5)),
        assignments: [
          { id: "a1", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "night", employeeId: "e1" },
        ],
        employeesById: employees,
        profilesById: profiles,
        staffingRequirements: [
          {
            shiftType: ShiftType.NIGHT,
            stationNumber: 1,
            minTotalCount: 1,
            qualificationRequirements: [{ qualificationTag: "NurseQualified", minCount: 1 }],
          },
        ],
        snapshot: baseSnapshot({
          ruleStates: {
            noOverlap: { enabled: false, params: {} },
            minRestBetweenShifts: { enabled: false, params: {} },
            miniJobMonthlyHours: { enabled: false, params: {} },
            staffingMinimum: { enabled: false, params: {} },
            qualificationCoverage: { enabled: true, params: {} },
          },
        }),
      });
      const { errors } = runAllRules(ctx);
      expect(errors.some((e) => e.code === "MISSING_QUALIFICATION")).toBe(true);
    });

    it("passes when enough employees with required tag are assigned", () => {
      const profiles = new Map([
        [
          "night",
          {
            id: "night",
            shiftType: ShiftType.NIGHT,
            stationNumber: 1,
            startTime: "22:00",
            endTime: "06:00",
            breakMinutes: 0,
          },
        ],
      ]);
      const employees = new Map([
        ["e1", { id: "e1", contractType: ContractType.FULL_TIME, miniJobMaxMonthlyHours: null, qualificationTags: ["NurseQualified"] }],
        ["e2", { id: "e2", contractType: ContractType.FULL_TIME, miniJobMaxMonthlyHours: null, qualificationTags: ["NurseQualified"] }],
        ["e3", { id: "e3", contractType: ContractType.FULL_TIME, miniJobMaxMonthlyHours: null, qualificationTags: [] }],
      ]);
      const ctx = minimalCtx({
        periodStart: new Date(Date.UTC(2026, 0, 5)),
        periodEnd: new Date(Date.UTC(2026, 0, 5)),
        assignments: [
          { id: "a1", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "night", employeeId: "e1" },
          { id: "a2", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "night", employeeId: "e2" },
          { id: "a3", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "night", employeeId: "e3" },
        ],
        employeesById: employees,
        profilesById: profiles,
        staffingRequirements: [
          {
            shiftType: ShiftType.NIGHT,
            stationNumber: 1,
            minTotalCount: 3,
            qualificationRequirements: [{ qualificationTag: "NurseQualified", minCount: 2 }],
          },
        ],
        snapshot: baseSnapshot({
          ruleStates: {
            noOverlap: { enabled: false, params: {} },
            minRestBetweenShifts: { enabled: false, params: {} },
            miniJobMonthlyHours: { enabled: false, params: {} },
            staffingMinimum: { enabled: false, params: {} },
            qualificationCoverage: { enabled: true, params: {} },
          },
        }),
      });
      const { errors } = runAllRules(ctx);
      expect(errors.filter((e) => e.ruleId === "qualificationCoverage")).toEqual([]);
    });

    it("errors when minCount > 1 and not enough qualified employees assigned", () => {
      const profiles = new Map([
        [
          "early",
          {
            id: "early",
            shiftType: ShiftType.EARLY,
            stationNumber: 1,
            startTime: "06:00",
            endTime: "14:00",
            breakMinutes: 0,
          },
        ],
      ]);
      const employees = new Map([
        ["e1", { id: "e1", contractType: ContractType.FULL_TIME, miniJobMaxMonthlyHours: null, qualificationTags: ["Fachkraft"] }],
        ["e2", { id: "e2", contractType: ContractType.FULL_TIME, miniJobMaxMonthlyHours: null, qualificationTags: [] }],
        ["e3", { id: "e3", contractType: ContractType.FULL_TIME, miniJobMaxMonthlyHours: null, qualificationTags: [] }],
      ]);
      const ctx = minimalCtx({
        periodStart: new Date(Date.UTC(2026, 0, 5)),
        periodEnd: new Date(Date.UTC(2026, 0, 5)),
        assignments: [
          { id: "a1", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "early", employeeId: "e1" },
          { id: "a2", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "early", employeeId: "e2" },
          { id: "a3", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "early", employeeId: "e3" },
        ],
        employeesById: employees,
        profilesById: profiles,
        staffingRequirements: [
          {
            shiftType: ShiftType.EARLY,
            stationNumber: 1,
            minTotalCount: 3,
            qualificationRequirements: [{ qualificationTag: "Fachkraft", minCount: 3 }],
          },
        ],
        snapshot: baseSnapshot({
          ruleStates: {
            noOverlap: { enabled: false, params: {} },
            minRestBetweenShifts: { enabled: false, params: {} },
            miniJobMonthlyHours: { enabled: false, params: {} },
            staffingMinimum: { enabled: false, params: {} },
            qualificationCoverage: { enabled: true, params: {} },
          },
        }),
      });
      const { errors } = runAllRules(ctx);
      expect(errors.some((e) => e.code === "MISSING_QUALIFICATION")).toBe(true);
    });
  });

  describe("soft rule stubs", () => {
    it("emits no warnings when disabled (default)", () => {
      const ctx = minimalCtx({
        assignments: [],
        snapshot: baseSnapshot({
          ruleStates: {
            noOverlap: { enabled: false, params: {} },
            minRestBetweenShifts: { enabled: false, params: {} },
            miniJobMonthlyHours: { enabled: false, params: {} },
            staffingMinimum: { enabled: false, params: {} },
            qualificationCoverage: { enabled: false, params: {} },
            wishFulfillment: { enabled: false, params: {} },
            fairnessCounters: { enabled: false, params: {} },
            targetHoursBalance: { enabled: false, params: {} },
          },
        }),
      });
      const out = runAllRules(ctx);
      expect(out.warnings).toEqual([]);
      expect(out.errors).toEqual([]);
    });

    it("emits no warnings when soft rules enabled (stubs not yet implemented)", () => {
      const ctx = minimalCtx({
        assignments: [],
        snapshot: baseSnapshot({
          ruleStates: {
            noOverlap: { enabled: false, params: {} },
            minRestBetweenShifts: { enabled: false, params: {} },
            miniJobMonthlyHours: { enabled: false, params: {} },
            staffingMinimum: { enabled: false, params: {} },
            qualificationCoverage: { enabled: false, params: {} },
            wishFulfillment: { enabled: true, params: {} },
            fairnessCounters: { enabled: true, params: {} },
            targetHoursBalance: { enabled: true, params: {} },
          },
        }),
      });
      const out = runAllRules(ctx);
      expect(out.warnings).toEqual([]);
      expect(out.errors).toEqual([]);
    });
  });

  describe("shared time utilities", () => {
    it("datesInPeriodUtc returns inclusive date range", () => {
      const start = new Date(Date.UTC(2026, 0, 5));
      const end = new Date(Date.UTC(2026, 0, 7));
      const dates = datesInPeriodUtc(start, end);
      expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
        "2026-01-05",
        "2026-01-06",
        "2026-01-07",
      ]);
    });

    it("sameUtcCalendarDay matches same day, rejects different", () => {
      const a = new Date(Date.UTC(2026, 0, 5, 10, 30));
      const b = new Date(Date.UTC(2026, 0, 5, 23, 59));
      const c = new Date(Date.UTC(2026, 0, 6, 0, 0));
      expect(sameUtcCalendarDay(a, b)).toBe(true);
      expect(sameUtcCalendarDay(a, c)).toBe(false);
    });
  });

  describe("RuleDescriptor + registry metadata", () => {
    it("getRegisteredRules returns descriptors for all built-in rules", () => {
      const descriptors = getRegisteredRules();
      expect(descriptors.length).toBeGreaterThanOrEqual(9);
      const ids = descriptors.map((d) => d.id);
      expect(ids).toContain("noOverlap");
      expect(ids).toContain("maxConsecutiveNights");
    });

    it("descriptors carry severity and scope", () => {
      const descriptors = getRegisteredRules();
      const noOverlap = descriptors.find((d) => d.id === "noOverlap");
      expect(noOverlap?.severity).toBe("hard");
      expect(noOverlap?.scope).toBe("employee");
      const staffMin = descriptors.find((d) => d.id === "staffingMinimum");
      expect(staffMin?.severity).toBe("hard");
      expect(staffMin?.scope).toBe("global");
    });
  });

  describe("runScopedRules", () => {
    it("runs only employee-scoped rules, skipping global ones", () => {
      const profiles = new Map([
        [
          "early",
          {
            id: "early",
            shiftType: ShiftType.EARLY,
            stationNumber: 1,
            startTime: "06:00",
            endTime: "14:00",
            breakMinutes: 0,
          },
        ],
      ]);
      const ctx = minimalCtx({
        periodStart: new Date(Date.UTC(2026, 0, 5)),
        periodEnd: new Date(Date.UTC(2026, 0, 5)),
        assignments: [
          { id: "a1", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "early", employeeId: "e1" },
        ],
        profilesById: profiles,
        staffingRequirements: [
          { shiftType: ShiftType.EARLY, stationNumber: 1, minTotalCount: 5, qualificationRequirements: [] },
        ],
        snapshot: baseSnapshot({
          ruleStates: {
            noOverlap: { enabled: true, params: {} },
            minRestBetweenShifts: { enabled: true, params: {} },
            miniJobMonthlyHours: { enabled: true, params: {} },
            staffingMinimum: { enabled: true, params: {} },
            qualificationCoverage: { enabled: true, params: {} },
            maxConsecutiveNights: { enabled: true, params: { maxCount: 3 } },
          },
        }),
      });

      const allResult = runAllRules(ctx);
      expect(allResult.errors.some((e) => e.ruleId === "staffingMinimum")).toBe(true);

      const scopedResult = runScopedRules(ctx, "employee");
      expect(scopedResult.errors.every((e) => e.ruleId !== "staffingMinimum")).toBe(true);
      expect(scopedResult.errors.every((e) => e.ruleId !== "qualificationCoverage")).toBe(true);
    });

    it("runs only global-scoped rules when requested", () => {
      const profiles = new Map([
        [
          "p1",
          {
            id: "p1",
            shiftType: ShiftType.EARLY,
            stationNumber: 1,
            startTime: "06:00",
            endTime: "14:00",
            breakMinutes: 0,
          },
        ],
      ]);
      const ctx = minimalCtx({
        periodStart: new Date(Date.UTC(2026, 0, 5)),
        periodEnd: new Date(Date.UTC(2026, 0, 5)),
        assignments: [
          { id: "a1", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "p1", employeeId: "e1" },
          { id: "a2", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "p1", employeeId: "e1" },
        ],
        profilesById: profiles,
        staffingRequirements: [
          { shiftType: ShiftType.EARLY, stationNumber: 1, minTotalCount: 5, qualificationRequirements: [] },
        ],
        snapshot: baseSnapshot({
          ruleStates: {
            noOverlap: { enabled: true, params: {} },
            staffingMinimum: { enabled: true, params: {} },
          },
        }),
      });

      const scopedResult = runScopedRules(ctx, "global");
      expect(scopedResult.errors.some((e) => e.ruleId === "staffingMinimum")).toBe(true);
      expect(scopedResult.errors.every((e) => e.ruleId !== "noOverlap")).toBe(true);
    });
  });

  describe("maxConsecutiveNights", () => {
    const nightProfile = new Map([
      [
        "night",
        {
          id: "night",
          shiftType: ShiftType.NIGHT,
          stationNumber: 1,
          startTime: "22:00",
          endTime: "06:00",
          breakMinutes: 0,
        },
      ],
    ]);

    function nightsOnlySnapshot(maxCount: number, enabled = true): PlanningRulesSnapshot {
      return baseSnapshot({
        ruleStates: {
          noOverlap: { enabled: false, params: {} },
          minRestBetweenShifts: { enabled: false, params: {} },
          miniJobMonthlyHours: { enabled: false, params: {} },
          staffingMinimum: { enabled: false, params: {} },
          qualificationCoverage: { enabled: false, params: {} },
          maxConsecutiveNights: { enabled, params: { maxCount } },
        },
      });
    }

    it("allows up to maxCount consecutive night shifts", () => {
      const ctx = minimalCtx({
        periodStart: new Date(Date.UTC(2026, 0, 5)),
        periodEnd: new Date(Date.UTC(2026, 0, 10)),
        assignments: [
          { id: "n1", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "night", employeeId: "e1" },
          { id: "n2", date: new Date(Date.UTC(2026, 0, 6)), shiftProfileId: "night", employeeId: "e1" },
          { id: "n3", date: new Date(Date.UTC(2026, 0, 7)), shiftProfileId: "night", employeeId: "e1" },
        ],
        profilesById: nightProfile,
        snapshot: nightsOnlySnapshot(3),
      });
      const { errors } = runAllRules(ctx);
      expect(errors.filter((e) => e.ruleId === "maxConsecutiveNights")).toEqual([]);
    });

    it("errors when exceeding maxCount consecutive night shifts", () => {
      const ctx = minimalCtx({
        periodStart: new Date(Date.UTC(2026, 0, 5)),
        periodEnd: new Date(Date.UTC(2026, 0, 10)),
        assignments: [
          { id: "n1", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "night", employeeId: "e1" },
          { id: "n2", date: new Date(Date.UTC(2026, 0, 6)), shiftProfileId: "night", employeeId: "e1" },
          { id: "n3", date: new Date(Date.UTC(2026, 0, 7)), shiftProfileId: "night", employeeId: "e1" },
          { id: "n4", date: new Date(Date.UTC(2026, 0, 8)), shiftProfileId: "night", employeeId: "e1" },
        ],
        profilesById: nightProfile,
        snapshot: nightsOnlySnapshot(3),
      });
      const { errors } = runAllRules(ctx);
      expect(errors.some((e) => e.code === "MAX_CONSECUTIVE_NIGHTS")).toBe(true);
    });

    it("resets streak after a gap day", () => {
      const ctx = minimalCtx({
        periodStart: new Date(Date.UTC(2026, 0, 5)),
        periodEnd: new Date(Date.UTC(2026, 0, 12)),
        assignments: [
          { id: "n1", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "night", employeeId: "e1" },
          { id: "n2", date: new Date(Date.UTC(2026, 0, 6)), shiftProfileId: "night", employeeId: "e1" },
          { id: "n3", date: new Date(Date.UTC(2026, 0, 8)), shiftProfileId: "night", employeeId: "e1" },
          { id: "n4", date: new Date(Date.UTC(2026, 0, 9)), shiftProfileId: "night", employeeId: "e1" },
        ],
        profilesById: nightProfile,
        snapshot: nightsOnlySnapshot(3),
      });
      const { errors } = runAllRules(ctx);
      expect(errors.filter((e) => e.ruleId === "maxConsecutiveNights")).toEqual([]);
    });

    it("emits no errors when rule is disabled", () => {
      const ctx = minimalCtx({
        periodStart: new Date(Date.UTC(2026, 0, 5)),
        periodEnd: new Date(Date.UTC(2026, 0, 10)),
        assignments: [
          { id: "n1", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "night", employeeId: "e1" },
          { id: "n2", date: new Date(Date.UTC(2026, 0, 6)), shiftProfileId: "night", employeeId: "e1" },
          { id: "n3", date: new Date(Date.UTC(2026, 0, 7)), shiftProfileId: "night", employeeId: "e1" },
          { id: "n4", date: new Date(Date.UTC(2026, 0, 8)), shiftProfileId: "night", employeeId: "e1" },
          { id: "n5", date: new Date(Date.UTC(2026, 0, 9)), shiftProfileId: "night", employeeId: "e1" },
        ],
        profilesById: nightProfile,
        snapshot: nightsOnlySnapshot(3, false),
      });
      const { errors } = runAllRules(ctx);
      expect(errors.filter((e) => e.ruleId === "maxConsecutiveNights")).toEqual([]);
    });

    it("uses default maxCount 3 when params are empty", () => {
      const ctx = minimalCtx({
        periodStart: new Date(Date.UTC(2026, 0, 5)),
        periodEnd: new Date(Date.UTC(2026, 0, 10)),
        assignments: [
          { id: "n1", date: new Date(Date.UTC(2026, 0, 5)), shiftProfileId: "night", employeeId: "e1" },
          { id: "n2", date: new Date(Date.UTC(2026, 0, 6)), shiftProfileId: "night", employeeId: "e1" },
          { id: "n3", date: new Date(Date.UTC(2026, 0, 7)), shiftProfileId: "night", employeeId: "e1" },
          { id: "n4", date: new Date(Date.UTC(2026, 0, 8)), shiftProfileId: "night", employeeId: "e1" },
        ],
        profilesById: nightProfile,
        snapshot: baseSnapshot({
          ruleStates: {
            maxConsecutiveNights: { enabled: true, params: {} },
          },
        }),
      });
      const { errors } = runAllRules(ctx);
      expect(errors.some((e) => e.code === "MAX_CONSECUTIVE_NIGHTS")).toBe(true);
    });
  });
});
