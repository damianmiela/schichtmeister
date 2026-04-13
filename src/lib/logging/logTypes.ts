/* ──────────────── Activity & System Log Types ──────────────── */

/** Base shape for every log entry */
export interface BaseLogEntry {
  ts: string;          // ISO-8601 timestamp
  type: string;
  userId?: string;
  userName?: string;   // firstName lastName for display
  sessionId?: string;
}

/* ────── Client-side (user activity) events ────── */

export interface PageViewEvent extends BaseLogEntry {
  type: "page_view";
  data: { path: string; referrer?: string; title?: string };
}

export interface PageLeaveEvent extends BaseLogEntry {
  type: "page_leave";
  data: { path: string; durationMs: number; scrollDepthPct: number };
}

export interface ClickEvent extends BaseLogEntry {
  type: "click";
  data: {
    element: string;        // tag name
    text: string;           // visible text (truncated)
    selector: string;       // CSS selector path
    path: string;           // current URL path
    x: number;
    y: number;
  };
}

export interface FormChangeEvent extends BaseLogEntry {
  type: "form_change";
  data: { fieldName: string; fieldType: string; path: string };
}

export interface ModalEvent extends BaseLogEntry {
  type: "modal_open" | "modal_close";
  data: { modalId: string; path: string };
}

export interface SessionStartEvent extends BaseLogEntry {
  type: "session_start";
  data: {
    userAgent: string;
    screenWidth: number;
    screenHeight: number;
    language: string;
  };
}

export interface SessionEndEvent extends BaseLogEntry {
  type: "session_end";
  data: { durationMs: number };
}

export interface FocusEvent extends BaseLogEntry {
  type: "focus" | "blur";
  data: { path: string };
}

export type ActivityEvent =
  | PageViewEvent
  | PageLeaveEvent
  | ClickEvent
  | FormChangeEvent
  | ModalEvent
  | SessionStartEvent
  | SessionEndEvent
  | FocusEvent;

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
