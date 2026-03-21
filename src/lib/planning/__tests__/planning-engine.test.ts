import { describe, it, expect, beforeEach } from "vitest";
import { ContractType, Prisma, ShiftType } from "@prisma/client";
import { defaultPlanningRulesConfig } from "@/lib/planning/defaultConfig";
import { mergePlanningRules, type FacilityRulesSlice } from "@/lib/planning/merge";
import { registerBuiltInPlanningRules } from "@/lib/planning/registerBuiltInRules";
import { registerRule, resetRuleRegistry, runAllRules } from "@/lib/planning/registry";
import { parsePlanningRulesConfig } from "@/lib/planning/rules/schema";
import { shiftIntervalMs, assignmentPaidHours } from "@/lib/planning/time";
import type {
  PlanningRulesSnapshot,
  RuleContext,
  RuleFn,
} from "@/lib/planning/types";

function facilitySlice(
  minRestHours: number,
  miniJobMaxMonthlyHours: number,
): FacilityRulesSlice {
  return {
    minRestHours: new Prisma.Decimal(minRestHours),
    miniJobMaxMonthlyHours: new Prisma.Decimal(miniJobMaxMonthlyHours),
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
      registerRule("stub", stub);
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
    it("requires minStaffCount per day and shift type", () => {
      const profiles = new Map([
        [
          "early",
          {
            id: "early",
            shiftType: ShiftType.EARLY,
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
          { dayOfWeek: 1, shiftType: ShiftType.EARLY, minStaffCount: 2, requiredQualificationTags: [] },
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
            dayOfWeek: 1,
            shiftType: ShiftType.NIGHT,
            minStaffCount: 1,
            requiredQualificationTags: ["NurseQualified"],
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
});
