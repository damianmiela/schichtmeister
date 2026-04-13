import { writeLog } from "./serverLogger";
import type { GenerationStartEvent, GenerationCompleteEvent, GenerationErrorEvent } from "./logTypes";

/**
 * Log the start of a schedule generation.
 */
export function logGenerationStart(params: {
  userId: string;
  userName?: string;
  scheduleId: string;
  month: string;
  employeeCount: number;
  profileCount: number;
  staffingRuleCount: number;
  manualPlacementCount: number;
  maxSolveTimeSeconds: number;
}): void {
  const event: GenerationStartEvent = {
    ts: new Date().toISOString(),
    type: "generation_start",
    userId: params.userId,
    userName: params.userName,
    data: {
      scheduleId: params.scheduleId,
      month: params.month,
      employeeCount: params.employeeCount,
      profileCount: params.profileCount,
      staffingRuleCount: params.staffingRuleCount,
      manualPlacementCount: params.manualPlacementCount,
      maxSolveTimeSeconds: params.maxSolveTimeSeconds,
    },
  };
  writeLog("system", event);
}

/**
 * Log the completion of a schedule generation.
 */
export function logGenerationComplete(params: {
  userId: string;
  userName?: string;
  scheduleId: string;
  status: string;
  solveTimeMs: number;
  assignmentCount: number;
  warningCount: number;
  unmetStaffingCount: number;
  unfulfilledWishCount: number;
  objectiveValue?: number;
}): void {
  const event: GenerationCompleteEvent = {
    ts: new Date().toISOString(),
    type: "generation_complete",
    userId: params.userId,
    userName: params.userName,
    data: {
      scheduleId: params.scheduleId,
      status: params.status,
      solveTimeMs: params.solveTimeMs,
      assignmentCount: params.assignmentCount,
      warningCount: params.warningCount,
      unmetStaffingCount: params.unmetStaffingCount,
      unfulfilledWishCount: params.unfulfilledWishCount,
      objectiveValue: params.objectiveValue,
    },
  };
  writeLog("system", event);
}

/**
 * Log a generation error.
 */
export function logGenerationError(params: {
  userId: string;
  userName?: string;
  scheduleId: string;
  error: string;
  status?: string;
  conflictingConstraints?: string[];
}): void {
  const event: GenerationErrorEvent = {
    ts: new Date().toISOString(),
    type: "generation_error",
    userId: params.userId,
    userName: params.userName,
    data: {
      scheduleId: params.scheduleId,
      error: params.error,
      status: params.status,
      conflictingConstraints: params.conflictingConstraints,
    },
  };
  writeLog("system", event);
}
