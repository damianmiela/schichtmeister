/* ──────────────── Activity & System Log Types ──────────────── */

/** Base shape for every log entry */
export interface BaseLogEntry {
  ts: string;          // ISO-8601 timestamp
  type: string;
  userId?: string;
  userName?: string;   // firstName lastName for display
  sessionId?: string;
}

/* ────── Client-side (user activity) events ──────
 *
 * Intentionally minimal — only `page_view` is recorded so the admin log
 * gives a "where was the user" trail. Meaningful actions are captured
 * server-side (generation, login, api_error). See useActivityTracker.
 *
 * Old event types (click / focus / blur / page_leave / session_* /
 * form_change / modal_*) are retained as legacy variants below so the
 * parser keeps tolerating older .jsonl files during the 30-day retention
 * window after this refactor lands.
 */

export interface PageViewEvent extends BaseLogEntry {
  type: "page_view";
  data: { path: string; title?: string };
}

/** Legacy events written before the noise-cleanup refactor. Kept so the
 *  reader can still display old log files until they age out. */
export interface LegacyActivityEvent extends BaseLogEntry {
  type:
    | "page_leave"
    | "click"
    | "form_change"
    | "modal_open"
    | "modal_close"
    | "session_start"
    | "session_end"
    | "focus"
    | "blur";
  data: Record<string, unknown>;
}

export type ActivityEvent = PageViewEvent | LegacyActivityEvent;

/* ────── Server-side (system) events ────── */

export interface GenerationStartEvent extends BaseLogEntry {
  type: "generation_start";
  data: {
    scheduleId: string;
    month: string;
    employeeCount: number;
    profileCount: number;
    staffingRuleCount: number;
    manualPlacementCount: number;
    maxSolveTimeSeconds: number;
  };
}

/** Headline quality metrics computed by the solver (see solver/models.py). */
export interface GenerationQualityMetrics {
  maxOverSollH: number;
  avgAbsDeviationH: number;
  blWeekViolations: number;
  peakEmployeeId?: string | null;
  peakEmployeeDeltaH: number;
  employeesOutsideRange: number;
}

/** Comparison-mode variant label. "baseline" = current engine settings,
 * "race" = parallel-seed race mode.  Omitted on single-run generations. */
export type GenerationVariant = "baseline" | "race";

export interface GenerationCompleteEvent extends BaseLogEntry {
  type: "generation_complete";
  data: {
    scheduleId: string;
    status: string;           // OPTIMAL | FEASIBLE | INFEASIBLE | UNKNOWN | ERROR
    solveTimeMs: number;
    assignmentCount: number;
    warningCount: number;
    unmetStaffingCount: number;
    unfulfilledWishCount: number;
    objectiveValue?: number;
    // ── Vergleichsmodus fields (only set when comparison mode is active) ──
    variant?: GenerationVariant;           // "baseline" | "race"
    comparisonId?: string;                 // groups the runs of one comparison
    winner?: boolean;                      // true if this run was selected
    qualityMetrics?: GenerationQualityMetrics;
    randomSeed?: number;                   // seed used (race runs only)
    numWorkers?: number;                   // CP-SAT num_workers used
  };
}

export interface GenerationErrorEvent extends BaseLogEntry {
  type: "generation_error";
  data: {
    scheduleId: string;
    error: string;
    status?: string;
    conflictingConstraints?: string[];
  };
}

export interface AuthEvent extends BaseLogEntry {
  type: "login" | "logout" | "login_failed" | "register";
  data: {
    email: string;
    ip?: string;
    userAgent?: string;
    reason?: string;        // for login_failed
  };
}

export interface ApiErrorEvent extends BaseLogEntry {
  type: "api_error";
  data: {
    method: string;
    path: string;
    status: number;
    error: string;
  };
}

export type SystemEvent =
  | GenerationStartEvent
  | GenerationCompleteEvent
  | GenerationErrorEvent
  | AuthEvent
  | ApiErrorEvent;

export type LogEntry = ActivityEvent | SystemEvent;

/* ────── Query types ────── */

export type LogType = "activity" | "system";

export interface LogQuery {
  type: LogType;
  startDate?: string;   // YYYY-MM-DD
  endDate?: string;     // YYYY-MM-DD
  userId?: string;
  eventTypes?: string[];
  limit?: number;
  offset?: number;
}

export interface LogQueryResult {
  entries: LogEntry[];
  total: number;
  hasMore: boolean;
}
