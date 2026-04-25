"""Pydantic request/response models for the CP-SAT solver API."""

from __future__ import annotations

from pydantic import BaseModel, Field


# ── Request models ──────────────────────────────────────────────────────────


class EmployeeInput(BaseModel):
    id: str
    qualificationTags: list[str] = []
    assignedStations: list[int] = []
    allowedShiftProfileIds: list[str] = []
    preferredShiftTypes: list[str] = []
    targetHoursPercent: float | None = None
    targetHours: float | None = None
    targetHoursPeriod: str | None = None
    contractType: str = "FULL_TIME"
    miniJobMaxMonthlyHours: float | None = None
    unavailableDates: list[str] = []
    isWbl: bool = False
    isFullTimeBl: bool = False
    maxConsecutiveDays: int | None = None
    shiftDistribution: dict[str, float] | None = None


class ShiftProfileInput(BaseModel):
    id: str
    name: str
    shiftType: str
    stationNumber: int | None = None
    startTime: str
    endTime: str
    breakMinutes: int = 0
    paidHours: float
    isActive: bool = True


class QualificationRequirementInput(BaseModel):
    tags: list[str]
    minCount: int
    maxCount: int | None = None


class StaffingRequirementInput(BaseModel):
    shiftType: str
    stationNumber: int | None = None
    minTotalCount: int = 0
    maxTotalCount: int | None = None
    isFacilityWide: bool = False
    qualificationRequirements: list[QualificationRequirementInput] = []


class WishInput(BaseModel):
    id: str
    employeeId: str
    date: str
    shiftType: str | None = None
    shiftProfileId: str | None = None
    priority: str = "NORMAL"


class ManualPlacementInput(BaseModel):
    employeeId: str
    date: str
    shiftProfileId: str
    stationNumber: int | None = None


class BlockedDateInput(BaseModel):
    employeeId: str
    date: str


class PreviousAssignment(BaseModel):
    """Fixed assignment from the previous month's schedule (last ~7 days).
    Used by constraints that span month boundaries (consecutive days/nights,
    rest between shifts, alternating weekends)."""
    employeeId: str
    date: str
    shiftProfileId: str


class RulesInput(BaseModel):
    minRestHours: float = 11
    maxConsecutiveNights: int = 3
    maxConsecutiveDays: int = 7
    requiredRestDaysAfterStreak: int = 2
    requiredRestDaysAfter6: int = 2
    maxOvertimeHours: float = 8
    maxUndercutHours: float = 4
    alternatingWeekendsEnabled: bool = True
    wblMaxWeekendDays: int = 3
    sollMinDelta: float = -4.0
    sollMaxDelta: float = 8.0


class SolveRequest(BaseModel):
    schemaVersion: int = 1
    scheduleId: str
    periodStart: str
    periodEnd: str
    maxSolveTimeSeconds: int = 120
    # CP-SAT tuning. `randomSeed` lets the API race multiple runs with different
    # seeds (comparison mode). `numWorkers` lets a parallel race use smaller
    # per-process portfolios (e.g. 2 processes × 2 workers on a 4-core VPS).
    randomSeed: int | None = None
    numWorkers: int = 4
    employees: list[EmployeeInput]
    shiftProfiles: list[ShiftProfileInput]
    staffingRequirements: list[StaffingRequirementInput] = []
    wishes: list[WishInput] = []
    manualPlacements: list[ManualPlacementInput] = []
    blockedDates: list[BlockedDateInput] = []
    previousAssignments: list[PreviousAssignment] = []
    rules: RulesInput = Field(default_factory=RulesInput)
    monthlyWorkingDays: int | None = None
    monthlySollHoursByEmployee: dict[str, float] | None = None
    # Per-facility solver weight overrides. Keys are W_* field names from
    # solver.config.Weights; values are integers. Unknown keys are
    # ignored. When None / empty, the solver uses factory defaults from
    # solver/config.py. The API layer is responsible for validating
    # invariants (see config.validate_overrides) before submitting.
    weights: dict[str, int] | None = None


# ── Response models ─────────────────────────────────────────────────────────


class AssignmentOutput(BaseModel):
    employeeId: str
    date: str
    shiftProfileId: str
    stationNumber: int | None = None


class ModelStats(BaseModel):
    variables: int = 0
    constraints: int = 0
    booleans: int = 0


class SollDelta(BaseModel):
    soll: float
    actual: float
    delta: float


class Diagnostics(BaseModel):
    sollDeviation: dict[str, SollDelta] = {}
    fairnessSpread: float | None = None
    wishFulfillmentRate: float | None = None


class QualityMetrics(BaseModel):
    """Human-readable headline metrics derived from the solved schedule.

    These are surfaced in Generator-Protokoll (especially in comparison mode)
    so reviewers can eyeball why one run beat another beyond the raw objective.
    All hour values are in paid hours (not shift-count).
    """
    maxOverSollH: float = 0.0            # largest positive soll-delta across all employees
    avgAbsDeviationH: float = 0.0        # mean |delta| across employees with a soll target
    blWeekViolations: int = 0            # count of (WBL emp, week) pairs missing BL in workable weeks
    peakEmployeeId: str | None = None    # employee id with the largest |delta|
    peakEmployeeDeltaH: float = 0.0      # that employee's signed delta
    employeesOutsideRange: int = 0       # count with delta outside [-4, +8] h


class SolveResponse(BaseModel):
    status: str
    solveTimeMs: float = 0
    objectiveValue: float | None = None
    gap: float | None = None
    modelStats: ModelStats = Field(default_factory=ModelStats)
    assignments: list[AssignmentOutput] = []
    unfulfilledWishes: list[str] = []
    diagnostics: Diagnostics = Field(default_factory=Diagnostics)
    qualityMetrics: QualityMetrics | None = None
    reason: str | None = None
    conflictingConstraints: list[str] = []
