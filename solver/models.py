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


class BlockedDateInput(BaseModel):
    employeeId: str
    date: str


class RulesInput(BaseModel):
    minRestHours: float = 11
    maxConsecutiveNights: int = 3
    maxConsecutiveDays: int = 7
    requiredRestDaysAfterStreak: int = 2
    maxOvertimeHours: float = 8
    maxUndercutHours: float = 4


class SolveRequest(BaseModel):
    schemaVersion: int = 1
    scheduleId: str
    periodStart: str
    periodEnd: str
    maxSolveTimeSeconds: int = 30
    employees: list[EmployeeInput]
    shiftProfiles: list[ShiftProfileInput]
    staffingRequirements: list[StaffingRequirementInput] = []
    wishes: list[WishInput] = []
    manualPlacements: list[ManualPlacementInput] = []
    blockedDates: list[BlockedDateInput] = []
    rules: RulesInput = Field(default_factory=RulesInput)
    monthlyWorkingDays: int | None = None
    monthlySollHoursByEmployee: dict[str, float] | None = None


# ── Response models ─────────────────────────────────────────────────────────


class AssignmentOutput(BaseModel):
    employeeId: str
    date: str
    shiftProfileId: str


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


class SolveResponse(BaseModel):
    status: str
    solveTimeMs: float = 0
    objectiveValue: float | None = None
    gap: float | None = None
    modelStats: ModelStats = Field(default_factory=ModelStats)
    assignments: list[AssignmentOutput] = []
    unfulfilledWishes: list[str] = []
    diagnostics: Diagnostics = Field(default_factory=Diagnostics)
    reason: str | None = None
    conflictingConstraints: list[str] = []
