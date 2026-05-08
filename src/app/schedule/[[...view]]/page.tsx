"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import MainLayout from "@/components/layout/MainLayout";
import MonthView from "@/components/schedule/MonthView";
import MonthTableView, { type CellEdit } from "@/components/schedule/MonthTableView";
import WeekView from "@/components/schedule/WeekView";
import DayView from "@/components/schedule/DayView";
import EmployeeView from "@/components/schedule/EmployeeView";
import WarningsDrawer from "@/components/schedule/WarningsDrawer";
import { highestSeverity, SEVERITY_TOKENS } from "@/lib/schedule/warningSeverity";
import {
  Box,
  Button,
  IconButton,
  Typography,
  Chip,
  Breadcrumbs,
  Link,
  ToggleButton,
  ToggleButtonGroup,
  Alert,
  AlertTitle,
  CircularProgress,
  Menu,
  MenuItem,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Drawer,
  Badge,
  Tooltip,
  Divider,
  Autocomplete,
  TextField,
  ListItemIcon,
  ListItemText,
  Tabs,
  Tab,
  Stack,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

import DownloadIcon from "@mui/icons-material/Download";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import CalendarViewWeekIcon from "@mui/icons-material/CalendarViewWeek";
import TodayIcon from "@mui/icons-material/Today";
import PersonIcon from "@mui/icons-material/Person";
import TableChartIcon from "@mui/icons-material/TableChart";
import GridViewIcon from "@mui/icons-material/GridView";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import EditIcon from "@mui/icons-material/Edit";
import SaveIcon from "@mui/icons-material/Save";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import CloseIcon from "@mui/icons-material/Close";
import DescriptionIcon from "@mui/icons-material/Description";
import SickIcon from "@mui/icons-material/Sick";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import CleaningServicesIcon from "@mui/icons-material/CleaningServices";
import DrawIcon from "@mui/icons-material/Draw";
import HistoryIcon from "@mui/icons-material/History";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import RestoreIcon from "@mui/icons-material/Restore";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import TuneIcon from "@mui/icons-material/Tune";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PersonOffIcon from "@mui/icons-material/PersonOff";
import TimerIcon from "@mui/icons-material/Timer";
import TrendingFlatIcon from "@mui/icons-material/TrendingFlat";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import CropFreeIcon from "@mui/icons-material/CropFree";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import {
  monthRangeIso,
  pickScheduleForMonth,
  type ScheduleSummary,
} from "@/lib/schedule/monthSchedule";
import type {
  AssignmentJson,
  EmployeeJson,
  ScheduleJson,
  ShiftProfileJson,
  StaffingJson,
} from "@/lib/schedule/scheduleTypes";
import { getWeekNumber, shiftTypeLabel } from "@/lib/schedule/viewUtils";
import { holidayDateMap } from "@/lib/holidays";

type ScheduleVersionSummary = {
  id: string;
  label: string;
  assignmentCount: number;
  warningCount: number | null;
  scoreReport: string | null;
  createdAt: string;
};

type GenerateScheduleResponse = {
  createdAssignments: number;
  manualPlacementsApplied?: number;
  unmetStaffing: { date: string; shiftType: string; requested: number; assigned: number }[];
  warnings: { message: string; count: number }[];
  /** True when the solver returned INFEASIBLE / UNKNOWN. */
  infeasible?: boolean;
  infeasibleReason?: string | null;
  /** Pre-flight conflicts detected before the solver ran. */
  preflightIssues?: string[];
  manualPlacementCount?: number;
};

type ManualPlacement = {
  employeeId: string;
  date: string;
  stationNumber?: number;
  shiftProfileId: string;
  shiftType: string;
};

type PreGenEntry = {
  employeeId: string;
  type: "shift" | "frei" | "absence";
  date: string;
  shiftProfileId: string;
  stationNumber: number;
  dateFrom: string;
  dateTo: string;
  absenceType: "KRANK" | "URLAUB";
};

type GenProgress = {
  label: string;
  solutions?: number;
  objective?: number;
  done?: boolean;
};

type ViewType = "month" | "week" | "day" | "employee";
type MonthViewMode = "table" | "overview";

interface ViewState {
  type: ViewType;
  year: number;
  month: number;
  weekNumber?: number;
  weekStartDate?: Date;
  date?: Date;
  employeeId?: string;
}

const MONTH_NAMES = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

/* ── URL ↔ ViewState sync helpers ── */

function viewStateToUrl(vs: ViewState): string {
  return `/schedule/${vs.type}`;
}

/** Holds the target state when navigating between view types so it survives re-mount */
let _pendingViewState: ViewState | null = null;

function defaultViewState(viewType: ViewType | undefined): ViewState {
  const today = new Date();

  if (viewType === "week") {
    const monday = new Date(today);
    const day = monday.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    monday.setDate(monday.getDate() + diff);
    return {
      type: "week",
      year: monday.getFullYear(),
      month: monday.getMonth(),
      weekNumber: getWeekNumber(monday),
      weekStartDate: monday,
    };
  }

  if (viewType === "day") {
    return { type: "day", year: today.getFullYear(), month: today.getMonth(), date: today };
  }

  if (viewType === "employee") {
    return { type: "employee", year: today.getFullYear(), month: today.getMonth() };
  }

  // Default: month
  return { type: "month", year: today.getFullYear(), month: today.getMonth() };
}

export default function SchedulePage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const router = useRouter();
  const params = useParams();
  const viewSegments = params.view as string[] | undefined;

  // Initialize viewState: use pending state from navigation, otherwise default from URL
  const [viewState, setViewStateRaw] = useState<ViewState>(() => {
    if (_pendingViewState) {
      const state = _pendingViewState;
      _pendingViewState = null;
      return state;
    }
    return defaultViewState(viewSegments?.[0] as ViewType | undefined);
  });
  const [monthViewMode, setMonthViewMode] = useState<MonthViewMode>("table");

  // Wrap setViewState to push URL only when view type changes
  const setViewState = useCallback((newState: ViewState | ((prev: ViewState) => ViewState)) => {
    setViewStateRaw((prev) => {
      const resolved = typeof newState === "function" ? newState(prev) : newState;
      if (resolved.type !== prev.type) {
        _pendingViewState = resolved;
        queueMicrotask(() => {
          router.replace(viewStateToUrl(resolved), { scroll: false });
        });
      }
      return resolved;
    });
  }, [router]);

  // Redirect bare /schedule to /schedule/month
  useEffect(() => {
    if (!viewSegments || viewSegments.length === 0) {
      router.replace(viewStateToUrl(viewState), { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleJson | null>(null);
  const [assignments, setAssignments] = useState<AssignmentJson[]>([]);
  const [employees, setEmployees] = useState<EmployeeJson[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, ShiftProfileJson>>({});
  const [shiftMarkings, setShiftMarkings] = useState<{ id: string; code: string; label: string; color: string }[]>([]);
  const [staffing, setStaffing] = useState<StaffingJson[]>([]);

  const [generateBusy, setGenerateBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionDebugPayload, setActionDebugPayload] = useState<unknown>(null);
  const [actionAlertSeverity, setActionAlertSeverity] = useState<
    "info" | "success" | "warning" | "error"
  >("info");
  const [exportMenuEl, setExportMenuEl] = useState<null | HTMLElement>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [adminMenuEl, setAdminMenuEl] = useState<null | HTMLElement>(null);
  const [cleanAbsencesBusy, setCleanAbsencesBusy] = useState(false);
  const [genProgress, setGenProgress] = useState<GenProgress>({ label: "" });
  const [genModalOpen, setGenModalOpen] = useState(false);
  const [genElapsed, setGenElapsed] = useState(0);
  const genTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [preGenOpen, setPreGenOpen] = useState(false);
  const [preGenTab, setPreGenTab] = useState<"wishes" | "settings">("wishes");
  const [preGenEntries, setPreGenEntries] = useState<PreGenEntry[]>([]);
  const [preGenSaving, setPreGenSaving] = useState(false);
  const [solveTimeDraft, setSolveTimeDraft] = useState("120");
  // Phase/progress label shown in the progress modal (e.g. "Rennen B von 5…").
  const [genPhaseLabel, setGenPhaseLabel] = useState<string | null>(null);
  // Live objective value reported by the solver (lower is better).
  const [genObjective, setGenObjective] = useState<number | null>(null);
  // Live optimality gap as a percentage — (objective - bound) / |objective|.
  // 0% = proven optimal. For our heavy-soft-penalty model the bound stays
  // loose so the gap typically stays in the 80-95% range; useful for
  // RELATIVE comparison across runs ("this run got to 82%, that one only
  // 88%") more than as an absolute optimality signal.
  const [genGap, setGenGap] = useState<number | null>(null);
  // Browser-side wall clock when the current race started — Date.now() ms.
  // Reset on generation start AND on each race_starting event in
  // Mehrfach-Lauf. Used together with `genLastImprovementElapsed` to
  // display "Letzte Verbesserung vor Xs" live (counts up between solver
  // events, including during a plateau when no events arrive).
  const [genCurrentRaceStartMs, setGenCurrentRaceStartMs] = useState<number | null>(null);
  // Per-race-relative seconds at which the solver last found a
  // strictly-better objective. Sent by the solver in every progress event
  // ("lastImprovementElapsed") and stored here for live ticking display.
  const [genLastImprovementElapsed, setGenLastImprovementElapsed] = useState<number | null>(null);
  // Number of sequential races per generation (1-10). When > 1 we run a
  // Mehrfach-Lauf with distinct seeds and keep the run with the lowest
  // objective. Total wall time ≈ raceCount × maxSolveTimeSeconds.
  const [raceCountDraft, setRaceCountDraft] = useState("1");
  // Timing mode for the solver:
  //   "FIXED" — each race runs for exactly solveTimeDraft seconds (current default).
  //   "PLATEAU" — each race runs until plateauSecondsDraft seconds elapse
  //               without finding a strictly-better objective. Solver self-stops
  //               with the best-so-far solution. Useful for letting the search
  //               take "as long as it actually needs" without a fixed budget.
  const [timingMode, setTimingMode] = useState<"FIXED" | "PLATEAU">("FIXED");
  const [plateauSecondsDraft, setPlateauSecondsDraft] = useState("60");
  // Solver strategy: "PREFER_FULL_COVERAGE" (default — fill every slot
  // with overtime / rule-breaking if needed) or "PREFER_GAPS" (lieber
  // Slot leer lassen). See src/lib/solver/weights.ts.
  const [strategyDraft, setStrategyDraft] = useState<
    "PREFER_FULL_COVERAGE" | "PREFER_GAPS"
  >("PREFER_FULL_COVERAGE");
  // Per-variant live state for the stacked Mehrfach-Lauf display. One slot
  // per variant "A", "B", …, populated when the first race_starting event
  // arrives.
  type RaceSlot = {
    variant: string;                 // "A", "B", …
    label: string;                   // "Rennen A", "Rennen B", …
    objective: number | null;        // latest live (or final) objective
    solutions: number | null;        // how many feasible solutions solver has
    status: "pending" | "running" | "done" | "failed";
    finalObjective: number | null;   // frozen value once the race finishes
    gap: number | null;              // latest optimality gap (%), live
  };
  const [genRaceSlots, setGenRaceSlots] = useState<RaceSlot[]>([]);
  // Best-so-far variant id ("A".."J") that currently holds the 🏆 trophy in
  // the stacked display. Updated on every race_starting / race_finished event
  // using the server-sent `bestSoFarVariant` field.
  const [genBestSoFarVariant, setGenBestSoFarVariant] = useState<string | null>(null);
  // True from the moment the user clicks "Abbrechen" until the server
  // streams its final event (success, cancellation-with-result, or error).
  // Used to disable the cancel button so it can't be clicked twice and
  // to show "Abbruch läuft…" feedback.
  const [genCancelInFlight, setGenCancelInFlight] = useState(false);
  // Final summary shown in the modal after generation finishes. Cleared
  // when a new generation starts. The modal stays open until the user
  // clicks "Schließen" — this drives the message in that final state.
  const [genFinalState, setGenFinalState] = useState<
    | { kind: "success"; message: string }
    | { kind: "cancelled"; message: string }
    | { kind: "error"; message: string }
    | null
  >(null);
  const [editMode, setEditMode] = useState(false);
  const [editedCells, setEditedCells] = useState<Map<string, CellEdit>>(new Map());
  const [editedShiftWishSet, setEditedShiftWishSet] = useState<Set<string>>(new Set());
  const [editedFreiWishSet, setEditedFreiWishSet] = useState<Set<string>>(new Set());
  const [editedVirtualPlacements, setEditedVirtualPlacements] = useState<Record<string, "1" | "2" | "3" | "NIGHT">>({});
  const [editSaving, setEditSaving] = useState(false);
  const [infeasibleInfo, setInfeasibleInfo] = useState<{
    reason: string | null;
    preflightIssues: string[];
    manualPlacementCount: number;
  } | null>(null);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [logContent, setLogContent] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [scoreDialogOpen, setScoreDialogOpen] = useState(false);
  const [scoreContent, setScoreContent] = useState<string | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [employeeWarnings, setEmployeeWarnings] = useState<{ message: string; count: number }[]>([]);
  const [warningsByDay, setWarningsByDay] = useState<Record<string, string[]>>({});
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<ScheduleVersionSummary[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionBusy, setVersionBusy] = useState(false);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [renamingVersionId, setRenamingVersionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);

  const daysInMonth = useMemo(() => {
    const { year, month } = viewState;
    const count = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: count }, (_, i) => {
      const d = i + 1;
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dow = new Date(year, month, d).getDay();
      const dayName = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][dow];
      return { day: d, iso, label: `${dayName} ${d}.` };
    });
  }, [viewState]);

  const sortedEmployees = useMemo(
    () =>
      [...employees].sort((a, b) => {
        // Primary: qualification sortOrder (lowest first)
        const qa = a.qualifications?.length
          ? Math.min(...a.qualifications.map((q) => q.sortOrder))
          : 9999;
        const qb = b.qualifications?.length
          ? Math.min(...b.qualifications.map((q) => q.sortOrder))
          : 9999;
        if (qa !== qb) return qa - qb;
        // Secondary: alphabetical
        return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, "de");
      }),
    [employees],
  );

  /** Active employees only — used in pre-gen planning (exclude INACTIVE and long-term absent) */
  const planningEmployees = useMemo(
    () => sortedEmployees.filter((e) => e.status === "ACTIVE"),
    [sortedEmployees],
  );

  const updateEntry = (idx: number, patch: Partial<PreGenEntry>) => {
    setPreGenEntries((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    );
  };

  const removeEntry = (idx: number) => {
    setPreGenEntries((prev) => prev.filter((_, i) => i !== idx));
  };

  function expandDateRange(employeeId: string, from: string, to: string): { employeeId: string; date: string }[] {
    const out: { employeeId: string; date: string }[] = [];
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    let cur = new Date(fy!, fm! - 1, fd!);
    const end = new Date(ty!, tm! - 1, td!);
    while (cur <= end) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      out.push({ employeeId, date: iso });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  const loadBundle = useCallback(async (opts?: { preserveActionMessage?: boolean }) => {
    setLoading(true);
    setError(null);
    if (!opts?.preserveActionMessage) {
      setActionMsg(null);
      setActionDebugPayload(null);
      setActionAlertSeverity("info");
    }
    const { year, month } = viewState;
    const { monthStart, monthEnd } = monthRangeIso(year, month);

    const failLabels: string[] = [];

    try {
    const [s0, s1, s2, s3, s4, s5] = await Promise.allSettled([
      fetchJson<{ schedules: ScheduleSummary[] }>("/api/schedules"),
      fetchJson<{ employees: EmployeeJson[] }>("/api/employees"),
      fetchJson<{ shiftProfiles: ShiftProfileJson[] }>("/api/shift-profiles"),
      fetchJson<{ staffingRequirements: StaffingJson[] }>("/api/staffing-requirements"),
      fetchJson<{ maxSolveTimeSeconds?: number }>("/api/facility/rules"),
      fetchJson<{ markings: { id: string; code: string; label: string; color: string }[] }>("/api/shift-markings"),
    ]);

    if (s4.status === "fulfilled" && s4.value.maxSolveTimeSeconds != null) {
      setSolveTimeDraft(String(s4.value.maxSolveTimeSeconds));
    }

    if (s1.status === "fulfilled") {
      setEmployees(s1.value.employees ?? []);
    } else {
      failLabels.push("Mitarbeiter");
      setEmployees([]);
    }

    if (s2.status === "fulfilled") {
      const profMap: Record<string, ShiftProfileJson> = {};
      for (const p of s2.value.shiftProfiles) {
        profMap[p.id] = p;
      }
      setProfilesById(profMap);
    } else {
      failLabels.push("Schichtprofile");
      setProfilesById({});
    }

    if (s3.status === "fulfilled") {
      setStaffing(s3.value.staffingRequirements);
    } else {
      failLabels.push("Personalbedarf");
      setStaffing([]);
    }

    if (s5.status === "fulfilled") {
      setShiftMarkings(s5.value.markings);
    } else {
      setShiftMarkings([]);
    }

    if (s0.status === "fulfilled") {
      try {
        const listRes = s0.value;
        let picked = pickScheduleForMonth(listRes.schedules, monthStart, monthEnd);
        if (!picked) {
          const created = await fetchJson<{ schedule: ScheduleSummary }>("/api/schedules", {
            method: "POST",
            body: JSON.stringify({ periodStart: monthStart, periodEnd: monthEnd }),
          });
          picked = created.schedule;
        }

        const detail = await fetchJson<{
          schedule: ScheduleJson;
          assignments?: AssignmentJson[];
        }>(`/api/schedules/${picked.id}?include=assignments`);

        setSchedule(detail.schedule);
        setAssignments(detail.assignments ?? []);

        // Re-run validation on load so warnings reflect day-view edits
        try {
          const rv = await fetchJson<{ warnings: { message: string; count: number }[]; warningsByDay?: Record<string, string[]> }>(
            `/api/schedules/${picked.id}/revalidate`,
            { method: "POST" },
          );
          setSchedule((prev) =>
            prev ? { ...prev, warnings: rv.warnings } : prev,
          );
          setWarningsByDay(rv.warningsByDay ?? {});
        } catch {
          // Non-critical — keep the cached warnings
        }
      } catch {
        failLabels.push("Monatsplan");
        setSchedule(null);
        setAssignments([]);
      }
    } else {
      failLabels.push("Dienstpläne");
      setSchedule(null);
      setAssignments([]);
    }

    if (failLabels.length > 0) {
      const apiMsgFrom = (reason: unknown): string | null => {
        if (
          reason instanceof ApiError &&
          reason.body &&
          typeof reason.body === "object" &&
          reason.body !== null &&
          "error" in reason.body &&
          typeof (reason.body as { error: unknown }).error === "string"
        ) {
          return (reason.body as { error: string }).error;
        }
        return null;
      };
      const apiMsg =
        apiMsgFrom(s0.status === "rejected" ? s0.reason : null) ??
        apiMsgFrom(s1.status === "rejected" ? s1.reason : null) ??
        apiMsgFrom(s2.status === "rejected" ? s2.reason : null) ??
        apiMsgFrom(s3.status === "rejected" ? s3.reason : null);
      setError(
        apiMsg ??
          `Konnte nicht vollständig laden: ${failLabels.join(", ")}. Bitte „Erneut laden“ oder Seite aktualisieren.`,
      );
    } else {
      setError(null);
    }
    } finally {
      setLoading(false);
    }
  }, [viewState.year, viewState.month]);

  useEffect(() => {
    void loadBundle();
  }, [loadBundle]);

  // Auto-select first employee alphabetically when entering employee view without an id
  useEffect(() => {
    if (viewState.type === "employee" && !viewState.employeeId && sortedEmployees.length > 0) {
      setViewState({ ...viewState, employeeId: sortedEmployees[0]!.id });
    }
  }, [viewState.type, viewState.employeeId, sortedEmployees]);

  // Fetch employee-specific warnings when viewing an employee
  useEffect(() => {
    if (viewState.type !== "employee" || !viewState.employeeId || !schedule?.id) {
      setEmployeeWarnings([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/schedules/${schedule.id}/revalidate?employeeId=${encodeURIComponent(viewState.employeeId!)}`,
          { method: "POST" },
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setEmployeeWarnings(data.employeeWarnings ?? []);
      } catch {
        if (!cancelled) setEmployeeWarnings([]);
      }
    })();
    return () => { cancelled = true; };
  }, [viewState.type, viewState.employeeId, schedule?.id, assignments]);

  /** Lightweight refresh: re-fetch assignments + revalidate warnings. */
  const refreshAssignments = useCallback(async () => {
    if (!schedule) return;
    try {
      const [detail, rv] = await Promise.all([
        fetchJson<{
          schedule: ScheduleJson;
          assignments?: AssignmentJson[];
        }>(`/api/schedules/${schedule.id}?include=assignments`),
        fetchJson<{ warnings: { message: string; count: number }[] }>(
          `/api/schedules/${schedule.id}/revalidate`,
          { method: "POST" },
        ).catch(() => null),
      ]);
      setSchedule({ ...detail.schedule, warnings: rv?.warnings ?? detail.schedule.warnings });
      setAssignments(detail.assignments ?? []);
    } catch {
      // Fall back to full reload on error
      loadBundle();
    }
  }, [schedule, loadBundle]);

  const handlePrevious = () => {
    if (viewState.type === "month" || viewState.type === "employee") {
      const newMonth = viewState.month - 1;
      if (newMonth < 0) {
        setViewState({ ...viewState, year: viewState.year - 1, month: 11 });
      } else {
        setViewState({ ...viewState, month: newMonth });
      }
    } else if (viewState.type === "week" && viewState.weekStartDate) {
      const newStart = new Date(viewState.weekStartDate);
      newStart.setDate(newStart.getDate() - 7);
      setViewState({
        ...viewState,
        weekNumber: getWeekNumber(newStart),
        weekStartDate: newStart,
      });
    } else if (viewState.type === "day" && viewState.date) {
      const newDate = new Date(viewState.date);
      newDate.setDate(newDate.getDate() - 1);
      setViewState({ ...viewState, date: newDate });
    }
  };

  const handleNext = () => {
    if (viewState.type === "month" || viewState.type === "employee") {
      const newMonth = viewState.month + 1;
      if (newMonth > 11) {
        setViewState({ ...viewState, year: viewState.year + 1, month: 0 });
      } else {
        setViewState({ ...viewState, month: newMonth });
      }
    } else if (viewState.type === "week" && viewState.weekStartDate) {
      const newStart = new Date(viewState.weekStartDate);
      newStart.setDate(newStart.getDate() + 7);
      setViewState({
        ...viewState,
        weekNumber: getWeekNumber(newStart),
        weekStartDate: newStart,
      });
    } else if (viewState.type === "day" && viewState.date) {
      const newDate = new Date(viewState.date);
      newDate.setDate(newDate.getDate() + 1);
      setViewState({ ...viewState, date: newDate });
    }
  };

  const handleWeekClick = (weekNumber: number, startDate: Date) => {
    setViewState({
      ...viewState,
      type: "week",
      weekNumber,
      weekStartDate: startDate,
    });
  };

  const handleDayClick = (date: Date) => {
    setViewState({
      ...viewState,
      type: "day",
      date,
    });
  };

  const handleBackToMonth = () => {
    setViewState({
      type: "month",
      year: viewState.year,
      month: viewState.month,
    });
  };

  const handleBackToWeek = () => {
    if (viewState.date) {
      const monday = new Date(viewState.date);
      const day = monday.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      monday.setDate(monday.getDate() + diff);

      setViewState({
        ...viewState,
        type: "week",
        weekNumber: getWeekNumber(monday),
        weekStartDate: monday,
      });
    }
  };

  const handleEmployeeClick = (employeeId: string) => {
    setViewState({
      ...viewState,
      type: "employee",
      employeeId,
    });
  };

  const handleBackFromEmployee = () => {
    const prevType = viewState.date
      ? "day"
      : viewState.weekStartDate
        ? "week"
        : "month";
    setViewState({ ...viewState, type: prevType });
  };

  const getViewTitle = () => {
    if (viewState.type === "employee") {
      return `${MONTH_NAMES[viewState.month]} ${viewState.year}`;
    }
    if (viewState.type === "month") {
      return `${MONTH_NAMES[viewState.month]} ${viewState.year}`;
    }
    if (viewState.type === "week" && viewState.weekStartDate) {
      const endDate = new Date(viewState.weekStartDate);
      endDate.setDate(endDate.getDate() + 6);
      return `KW ${viewState.weekNumber} • ${viewState.weekStartDate.getDate()}.${viewState.weekStartDate.getMonth() + 1}. - ${endDate.getDate()}.${endDate.getMonth() + 1}.${endDate.getFullYear()}`;
    }
    if (viewState.type === "day" && viewState.date) {
      return viewState.date.toLocaleDateString("de-DE", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
    }
    return "";
  };

  const employeesById = Object.fromEntries(employees.map((e) => [e.id, e]));

  const shiftWishSet = useMemo(() => {
    const s = new Set<string>();
    if (schedule?.preGenWishes?.shiftWishes) {
      for (const w of schedule.preGenWishes.shiftWishes) {
        s.add(`${w.employeeId}|${w.date}`);
      }
    }
    return s;
  }, [schedule]);

  const freiWishSet = useMemo(() => {
    const s = new Set<string>();
    if (schedule?.preGenWishes?.freiDates) {
      for (const w of schedule.preGenWishes.freiDates) {
        s.add(`${w.employeeId}|${w.date}`);
      }
    }
    return s;
  }, [schedule]);


  const downloadExport = async (kind: "excel" | "pdf" | "employees-pdf" | "debug" | "score") => {
    if (!schedule) return;
    setExportBusy(true);
    setActionMsg(null);
    setActionDebugPayload(null);
    setActionAlertSeverity("info");
    try {
      const res = await fetch(`/api/schedules/${schedule.id}/export/${kind}`, {
        credentials: "include",
      });
      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setActionAlertSeverity("error");
        setActionMsg(data.error ?? "Export fehlgeschlagen.");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition");
      const m = cd?.match(/filename="([^"]+)"/);
      const fallbackMap: Record<string, string> = { excel: "dienstplan.xlsx", pdf: "dienstplan.pdf", "employees-pdf": "mitarbeiter_dienstplaene.pdf", debug: "debug.json", score: "qualitaetsbericht.txt" };
      const filename = m?.[1] ?? fallbackMap[kind];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setActionAlertSeverity("error");
      setActionMsg("Export fehlgeschlagen.");
    } finally {
      setExportBusy(false);
      setExportMenuEl(null);
    }
  };

  const onGenerate = async () => {
    if (!schedule) return;
    setPreGenOpen(false);
    setGenerateBusy(true);
    setGenProgress({ label: "Starte Generierung..." });
    setGenElapsed(0);
    setGenModalOpen(true);
    setGenCancelInFlight(false);
    setGenFinalState(null);
    setActionMsg(null);
    setActionDebugPayload(null);
    setActionAlertSeverity("info");

    // Start live timer (ticks every 100ms for smooth display)
    const timerStart = performance.now();
    genTimerRef.current = setInterval(() => {
      setGenElapsed(Math.floor((performance.now() - timerStart) / 1000));
    }, 1000);

    const manualPlacements: ManualPlacement[] = preGenEntries
      .filter((e) => e.type === "shift")
      .map((e) => {
        const prof = profilesById[e.shiftProfileId];
        return {
          employeeId: e.employeeId,
          date: e.date,
          stationNumber: e.stationNumber || undefined,
          shiftProfileId: e.shiftProfileId,
          shiftType: prof?.shiftType ?? "EARLY",
        };
      });
    const freiBlockedDates = preGenEntries
      .filter((e) => e.type === "frei")
      .flatMap((e) => expandDateRange(e.employeeId, e.dateFrom, e.dateTo));
    const absenceBlockedDates = preGenEntries
      .filter((e) => e.type === "absence")
      .flatMap((e) => expandDateRange(e.employeeId, e.dateFrom, e.dateTo));
    const blockedDates = [...freiBlockedDates, ...absenceBlockedDates];
    const absences = preGenEntries
      .filter((e) => e.type === "absence")
      .map((e) => ({
        employeeId: e.employeeId,
        type: e.absenceType,
        startDate: e.dateFrom,
        endDate: e.dateTo,
      }));
    const solveTimeVal = Number(solveTimeDraft);
    const plateauVal = Number(plateauSecondsDraft);
    const body: {
      manualPlacements?: ManualPlacement[];
      blockedDates?: { employeeId: string; date: string }[];
      absences?: { employeeId: string; type: string; startDate: string; endDate: string }[];
      maxSolveTimeSeconds?: number;
      raceCount?: number;
      strategy?: "PREFER_FULL_COVERAGE" | "PREFER_GAPS";
      timingMode?: "FIXED" | "PLATEAU";
      plateauSeconds?: number;
    } = {};
    if (manualPlacements.length > 0) body.manualPlacements = manualPlacements;
    if (blockedDates.length > 0) body.blockedDates = blockedDates;
    if (absences.length > 0) body.absences = absences;
    // FIXED mode → send the budget as maxSolveTimeSeconds (existing path).
    // PLATEAU mode → send timingMode + plateauSeconds; solver caps wall-time
    // internally at 30 min as safety. Frontend display switches accordingly.
    if (timingMode === "PLATEAU") {
      body.timingMode = "PLATEAU";
      if (plateauVal >= 5 && plateauVal <= 600) {
        body.plateauSeconds = Math.floor(plateauVal);
      }
    } else {
      if (solveTimeVal >= 5 && solveTimeVal <= 3600) body.maxSolveTimeSeconds = solveTimeVal;
    }
    const raceCountVal = (() => {
      const n = Number(raceCountDraft);
      if (!Number.isFinite(n)) return 1;
      return Math.max(1, Math.min(10, Math.floor(n)));
    })();
    const multiRun = raceCountVal > 1;
    if (multiRun) {
      body.raceCount = raceCountVal;
    }
    // Always send strategy explicitly (avoids server-side defaulting surprises).
    body.strategy = strategyDraft;

    // Reset progress indicators for this run
    setGenPhaseLabel(multiRun ? `Rennen 1 von ${raceCountVal}…` : null);
    setGenObjective(null);
    setGenGap(null);
    setGenRaceSlots([]);
    setGenBestSoFarVariant(null);
    // Race-start timer (for the live "since last improvement" counter).
    // Single-run sets this once here; multi-run also resets it on each
    // race_starting event below.
    setGenCurrentRaceStartMs(Date.now());
    setGenLastImprovementElapsed(null);

    try {
      const resp = await fetch(`/api/schedules/${schedule.id}/generate-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: GenerateScheduleResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(trimmed.slice(6));
            if (event.type === "progress") {
              // Mehrfach-Lauf race markers come from the API route.
              // Single-run generation doesn't emit any of these — the normal
              // indeterminate progress bar + generic label path handles it.
              if (event.stage === "race_starting") {
                // Reset the per-race timer so "Letzte Verbesserung vor Xs"
                // counts from this race's start, not from the gen start.
                setGenCurrentRaceStartMs(Date.now());
                setGenLastImprovementElapsed(null);
                // Initialize / update per-variant slot list. The server
                // sends the full `variantLabels` array on the first
                // race_starting event so we can show all upcoming runs as
                // "pending" right away.
                if (Array.isArray(event.variantLabels)) {
                  const labels = event.variantLabels as string[];
                  const current = event.currentVariant as string | undefined;
                  setGenRaceSlots((prev) => {
                    // First time we see the list → build full slot array.
                    if (prev.length === 0) {
                      return labels.map((v) => ({
                        variant: v,
                        label: `Rennen ${v}`,
                        objective: null,
                        solutions: null,
                        status: v === current ? "running" : "pending",
                        finalObjective: null,
                        gap: null,
                      }));
                    }
                    // Subsequent events → mark the newly-starting variant as
                    // running; leave earlier "done" / "failed" slots alone.
                    return prev.map((s) => {
                      if (s.variant === current) {
                        return { ...s, status: "running" };
                      }
                      return s;
                    });
                  });
                }
                // Trophy position — server tells us which variant currently
                // holds the best feasible objective.
                if (typeof event.bestSoFarVariant === "string") {
                  setGenBestSoFarVariant(event.bestSoFarVariant);
                } else if (event.bestSoFarVariant === null) {
                  setGenBestSoFarVariant(null);
                }
                const vIdx = typeof event.variantIndex === "number" ? event.variantIndex : 1;
                const vTotal = typeof event.totalVariants === "number" ? event.totalVariants : raceCountVal;
                const vCur = typeof event.currentVariant === "string" ? event.currentVariant : "?";
                setGenPhaseLabel(`Rennen ${vCur} (${vIdx}/${vTotal})…`);
                // Clear the legacy single-value live slot; per-variant slots
                // take over from here.
                setGenObjective(null);
              } else if (event.stage === "race_finished") {
                // Freeze the finished variant's objective and mark it done.
                const vCur = typeof event.currentVariant === "string" ? event.currentVariant : null;
                const finalObj =
                  typeof event.variantFinalObjective === "number"
                    ? event.variantFinalObjective
                    : null;
                const vStatus = event.variantStatus as string | undefined;
                if (vCur) {
                  setGenRaceSlots((prev) =>
                    prev.map((s) =>
                      s.variant === vCur
                        ? {
                            ...s,
                            status: vStatus === "ERROR" ? "failed" : "done",
                            finalObjective: finalObj,
                            objective: finalObj ?? s.objective,
                          }
                        : s,
                    ),
                  );
                }
                // Update trophy position after this race finishes.
                if (typeof event.bestSoFarVariant === "string") {
                  setGenBestSoFarVariant(event.bestSoFarVariant);
                } else if (event.bestSoFarVariant === null) {
                  setGenBestSoFarVariant(null);
                }
              } else if (event.stage === "runs_complete") {
                setGenPhaseLabel(event.label ?? "Alle Läufe abgeschlossen");
              }
              // Route live objective updates forwarded from the solver.
              // Events tagged with `variant` belong to a specific race
              // ("A".."J") → update the matching race slot. Un-tagged events
              // update the generic single-run live slot.
              const evVariant = typeof event.variant === "string" ? event.variant : null;
              if (evVariant) {
                setGenRaceSlots((prev) =>
                  prev.map((s) => {
                    if (s.variant !== evVariant) return s;
                    // Don't overwrite a frozen "done"/"failed" slot
                    if (s.status === "done" || s.status === "failed") return s;
                    return {
                      ...s,
                      objective:
                        typeof event.objective === "number" ? event.objective : s.objective,
                      solutions:
                        typeof event.solutions === "number" ? event.solutions : s.solutions,
                      gap:
                        typeof event.gap === "number" ? event.gap : s.gap,
                    };
                  }),
                );
              } else {
                // untagged → single-run live slot
                if (typeof event.objective === "number") {
                  setGenObjective(event.objective);
                }
                if (typeof event.gap === "number") {
                  setGenGap(event.gap);
                }
              }
              // lastImprovementElapsed is sent by the solver in every
              // progress event regardless of whether it's tagged with a
              // variant. Capture it for the live "Letzte Verbesserung
              // vor Xs" counter.
              if (typeof event.lastImprovementElapsed === "number") {
                setGenLastImprovementElapsed(event.lastImprovementElapsed);
              }
              setGenProgress({
                label: event.label ?? "",
                solutions: event.solutions,
                objective: event.objective,
              });
            } else if (event.type === "complete") {
              result = event.result;
              setGenProgress({ label: "Fertig!", done: true });
            } else if (event.type === "error") {
              throw new Error(event.error ?? "Generierung fehlgeschlagen.");
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      await loadBundle({ preserveActionMessage: true });

      if (result) {
        // Infeasibility banner: set on INFEASIBLE, clear on success
        if (result.infeasible) {
          setInfeasibleInfo({
            reason: result.infeasibleReason ?? null,
            preflightIssues: result.preflightIssues ?? [],
            manualPlacementCount: result.manualPlacementCount ?? 0,
          });
        } else {
          setInfeasibleInfo(null);
        }

        const msgParts: string[] = [];
        const manual = result.manualPlacementsApplied ?? 0;
        const auto = result.createdAssignments - manual;
        if (manual > 0) {
          msgParts.push(`${manual} manuelle + ${auto} automatische Zuweisungen.`);
        } else if (result.createdAssignments > 0) {
          msgParts.push(`${result.createdAssignments} Dienste eingetragen.`);
        } else {
          msgParts.push("Es wurden keine Dienste eingetragen.");
        }
        if (freiBlockedDates.length > 0) {
          const uniqueEmps = new Set(freiBlockedDates.map((b) => b.employeeId)).size;
          msgParts.push(`${freiBlockedDates.length} Frei-Tag(e) für ${uniqueEmps} MA berücksichtigt.`);
        }
        if (absences.length > 0) {
          const uniqueAbsEmps = new Set(absences.map((a) => a.employeeId)).size;
          msgParts.push(`${absences.length} Abwesenheit(en) für ${uniqueAbsEmps} MA berücksichtigt.`);
        }
        const warnCount = (result.warnings?.length ?? 0);
        const unmet = result.unmetStaffing?.length ?? 0;
        const totalIssues = warnCount + unmet;
        if (totalIssues > 0) {
          msgParts.push(`${totalIssues} Warnung(en) — siehe Seitenleiste.`);
        }
        const hasIssue = result.createdAssignments === 0 || totalIssues > 0;
        setActionAlertSeverity(hasIssue ? "warning" : "success");
        setActionMsg(msgParts.join(" "));
        setActionDebugPayload(null);
        if (totalIssues > 0) setWarningsOpen(true);
        // Mark final state for the modal. If the user hit Abbrechen and
        // the server still managed to save a best-so-far plan, frame it
        // as "cancelled-with-result" so the chip is informative.
        setGenFinalState({
          kind: genCancelInFlight ? "cancelled" : "success",
          message: msgParts.join(" "),
        });
      }
    } catch (e) {
      const errMsg =
        e instanceof Error ? e.message : "Generierung fehlgeschlagen (Netzwerk).";
      setActionAlertSeverity("error");
      setActionMsg(errMsg);
      setActionDebugPayload({ kind: "client", message: String(e) });
      console.error("Entwurf füllen — Fehler", e);
      setGenFinalState({
        kind: genCancelInFlight ? "cancelled" : "error",
        message: errMsg,
      });
    } finally {
      if (genTimerRef.current) {
        clearInterval(genTimerRef.current);
        genTimerRef.current = null;
      }
      setGenerateBusy(false);
      setGenCancelInFlight(false);
      // Modal stays open — the user dismisses it explicitly via the
      // "Schließen" button now visible in the dialog footer.
    }
  };

  /** Best-effort cancel: POSTs to the cancel endpoint, server forwards
   * the signal to the running solver. The SSE stream stays open so the
   * solver's best-so-far result still flows back through the normal
   * "complete" path. */
  const onCancelGeneration = async () => {
    if (!schedule || !generateBusy || genCancelInFlight) return;
    setGenCancelInFlight(true);
    try {
      const r = await fetch(
        `/api/schedules/${schedule.id}/cancel-generation`,
        { method: "POST" },
      );
      if (!r.ok) {
        // Don't reset cancel state — generation may still finish on its
        // own; we just couldn't deliver the cancel signal. Surface a
        // mild warning.
        console.warn("Cancel signal failed:", r.status);
      }
    } catch (e) {
      console.warn("Cancel POST error:", e);
    }
  };

  const currentMonthKey = `${viewState.year}-${String(viewState.month + 1).padStart(2, "0")}`;

  const onViewLogs = async () => {
    if (!schedule) return;
    setLogLoading(true);
    setLogContent(null);
    setLogDialogOpen(true);
    try {
      const res = await fetchJson<{ content: string | null }>(
        `/api/generate-logs?scheduleId=${schedule.id}`,
      );
      setLogContent(res.content);
    } catch {
      setLogContent(null);
    } finally {
      setLogLoading(false);
    }
  };

  const onViewScore = async () => {
    if (!schedule) return;
    setScoreLoading(true);
    setScoreContent(null);
    setScoreDialogOpen(true);
    try {
      const res = await fetch(`/api/schedules/${schedule.id}/export/score`, {
        credentials: "include",
      });
      if (!res.ok) {
        setScoreContent(null);
      } else {
        setScoreContent(await res.text());
      }
    } catch {
      setScoreContent(null);
    } finally {
      setScoreLoading(false);
    }
  };

  const onCleanAbsences = async () => {
    setAdminMenuEl(null);
    setCleanAbsencesBusy(true);
    setActionMsg(null);
    setActionAlertSeverity("info");
    try {
      const res = await fetchJson<{ deleted: number }>(
        "/api/admin/clean-absences",
        { method: "POST" },
      );
      setActionAlertSeverity("success");
      setActionMsg(
        res.deleted > 0
          ? `${res.deleted} Abwesenheitseinträge bereinigt.`
          : "Keine Abwesenheitseinträge vorhanden.",
      );
    } catch (e) {
      setActionAlertSeverity("error");
      setActionMsg(
        e instanceof ApiError
          ? ((e.body as { error?: string })?.error ?? "Bereinigung fehlgeschlagen.")
          : "Bereinigung fehlgeschlagen (Netzwerk).",
      );
    } finally {
      setCleanAbsencesBusy(false);
    }
  };

  const onClearSchedule = async () => {
    if (!schedule) return;
    setClearConfirmOpen(false);
    setClearBusy(true);
    setActionMsg(null);
    setActionDebugPayload(null);
    setActionAlertSeverity("info");
    try {
      const res = await fetchJson<{ deletedAssignments: number }>(
        `/api/schedules/${schedule.id}/clear`,
        { method: "POST" },
      );
      await loadBundle({ preserveActionMessage: true });
      setActionAlertSeverity("success");
      setActionMsg(
        res.deletedAssignments > 0
          ? `${res.deletedAssignments} Zuweisungen gelöscht. Dienstplan zurückgesetzt.`
          : "Keine Zuweisungen vorhanden.",
      );
      setWarningsOpen(false);
    } catch (e) {
      setActionAlertSeverity("error");
      if (e instanceof ApiError) {
        const msg =
          e.body &&
          typeof e.body === "object" &&
          e.body !== null &&
          "error" in e.body &&
          typeof (e.body as { error: unknown }).error === "string"
            ? (e.body as { error: string }).error
            : "Leeren fehlgeschlagen.";
        setActionMsg(msg);
      } else {
        setActionMsg("Leeren fehlgeschlagen (Netzwerk).");
      }
    } finally {
      setClearBusy(false);
    }
  };

  /* ── Version management ── */

  const loadVersions = async () => {
    if (!schedule) return;
    setVersionsLoading(true);
    try {
      const data = await fetchJson<{ versions: ScheduleVersionSummary[]; currentVersionId: string | null }>(
        `/api/schedules/${schedule.id}/versions`,
      );
      setVersions(data.versions);
      setCurrentVersionId(data.currentVersionId);
    } catch {
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  };

  const openVersionsDrawer = () => {
    setVersionsOpen(true);
    void loadVersions();
  };

  const saveVersionManual = async () => {
    if (!schedule) return;
    setVersionBusy(true);
    try {
      await fetchJson(`/api/schedules/${schedule.id}/versions`, {
        method: "POST",
      });
      setActionAlertSeverity("success");
      setActionMsg("Version gespeichert.");
      void loadVersions();
    } catch {
      setActionAlertSeverity("error");
      setActionMsg("Version speichern fehlgeschlagen.");
    } finally {
      setVersionBusy(false);
    }
  };

  const restoreVersion = async (versionId: string) => {
    if (!schedule) return;
    setVersionBusy(true);
    try {
      const data = await fetchJson<{ restoredAssignments: number }>(
        `/api/schedules/${schedule.id}/versions/${versionId}/restore`,
        { method: "POST" },
      );
      setActionAlertSeverity("success");
      setActionMsg(`Version wiederhergestellt (${data.restoredAssignments} Zuweisungen).`);
      await loadBundle();
      void loadVersions();
    } catch {
      setActionAlertSeverity("error");
      setActionMsg("Wiederherstellung fehlgeschlagen.");
    } finally {
      setVersionBusy(false);
    }
  };

  const deleteVersion = async (versionId: string) => {
    if (!schedule) return;
    try {
      await fetchJson(`/api/schedules/${schedule.id}/versions/${versionId}`, {
        method: "DELETE",
      });
      void loadVersions();
    } catch {
      setActionAlertSeverity("error");
      setActionMsg("Version löschen fehlgeschlagen.");
    }
  };

  const startRenameVersion = (versionId: string, currentLabel: string) => {
    setRenamingVersionId(versionId);
    setRenameDraft(currentLabel);
  };

  const cancelRenameVersion = () => {
    setRenamingVersionId(null);
    setRenameDraft("");
  };

  const commitRenameVersion = async () => {
    if (!schedule || !renamingVersionId) return;
    const trimmed = renameDraft.trim();
    if (!trimmed) return;

    // Short-circuit: nothing changed
    const existing = versions.find((v) => v.id === renamingVersionId);
    if (existing && existing.label === trimmed) {
      cancelRenameVersion();
      return;
    }

    setRenameSaving(true);
    try {
      await fetchJson(`/api/schedules/${schedule.id}/versions/${renamingVersionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      // Optimistic local update to avoid a flash of the old label
      setVersions((prev) =>
        prev.map((v) => (v.id === renamingVersionId ? { ...v, label: trimmed } : v)),
      );
      cancelRenameVersion();
      void loadVersions();
    } catch {
      setActionAlertSeverity("error");
      setActionMsg("Umbenennen fehlgeschlagen.");
    } finally {
      setRenameSaving(false);
    }
  };

  const enterEditMode = () => {
    setEditedCells(new Map());
    setEditedShiftWishSet(new Set(shiftWishSet));
    setEditedFreiWishSet(new Set(freiWishSet));
    setEditedVirtualPlacements({ ...(schedule?.virtualPlacements ?? {}) });
    setEditMode(true);
  };

  const cancelEditMode = () => {
    setEditMode(false);
    setEditedCells(new Map());
    setEditedVirtualPlacements({});
  };

  const handleVirtualPlacementChange = (employeeId: string, placement: "1" | "2" | "3" | "NIGHT" | null) => {
    setEditedVirtualPlacements((prev) => {
      const next = { ...prev };
      if (placement === null) {
        delete next[employeeId];
      } else {
        next[employeeId] = placement;
      }
      return next;
    });
  };

  const handleCellChange = (employeeId: string, date: string, edit: Partial<CellEdit>) => {
    setEditedCells((prev) => {
      const next = new Map(prev);
      const key = `${employeeId}|${date}`;
      const existing = next.get(key) ?? {};
      next.set(key, { ...existing, ...edit });
      return next;
    });
  };

  const handleToggleWish = (employeeId: string, date: string, type: "shift" | "frei") => {
    const key = `${employeeId}|${date}`;
    if (type === "shift") {
      setEditedShiftWishSet((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
      setEditedFreiWishSet((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    } else {
      setEditedFreiWishSet((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
      setEditedShiftWishSet((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const onSaveEdits = async () => {
    if (!schedule) return;
    setEditSaving(true);
    setActionMsg(null);
    setActionDebugPayload(null);
    setActionAlertSeverity("info");

    // shiftProfileId is nullable: a row may be a pure absence marker (dayStatus
    // set, no shift). Per the agreed model, a shift and a dayStatus are mutually
    // exclusive on the same cell — applying one clears the other in the UI.
    const merged: { employeeId: string; date: string; shiftProfileId: string | null; markingRow2?: string | null; markingRow3?: string | null; dayStatus?: string | null; stationNumber?: number | null }[] = [];
    const seen = new Set<string>();

    for (const [key, cell] of editedCells) {
      seen.add(key);
      const [eid, date] = key.split("|");
      const original = assignments.find(a => a.employeeId === eid && a.date === date);
      const dayStatus = cell.dayStatus !== undefined ? cell.dayStatus : (original?.dayStatus ?? null);
      // When a dayStatus is in effect, drop any shift profile (status replaces shift).
      const pidRaw = cell.shiftProfileId !== undefined ? cell.shiftProfileId : original?.shiftProfileId;
      const pid = dayStatus ? null : (pidRaw ?? null);
      // Skip empty cells (no shift AND no status = nothing to persist → row is deleted).
      if (!pid && !dayStatus) continue;
      merged.push({
        employeeId: eid!,
        date: date!,
        shiftProfileId: pid,
        markingRow2: cell.markingRow2 !== undefined ? cell.markingRow2 : (original?.markingRow2 ?? null),
        markingRow3: cell.markingRow3 !== undefined ? cell.markingRow3 : (original?.markingRow3 ?? null),
        dayStatus,
        stationNumber: cell.stationNumber !== undefined ? cell.stationNumber : (original?.stationNumber ?? null),
      });
    }
    for (const a of assignments) {
      const key = `${a.employeeId}|${a.date}`;
      if (!seen.has(key)) {
        merged.push({
          employeeId: a.employeeId,
          date: a.date,
          shiftProfileId: a.shiftProfileId,
          markingRow2: a.markingRow2 ?? null,
          markingRow3: a.markingRow3 ?? null,
          dayStatus: a.dayStatus ?? null,
          stationNumber: a.stationNumber ?? null,
        });
      }
    }

    const preGenWishes = {
      shiftWishes: [...editedShiftWishSet].map((k) => {
        const [eid, date] = k.split("|");
        return { employeeId: eid!, date: date! };
      }),
      freiDates: [...editedFreiWishSet].map((k) => {
        const [eid, date] = k.split("|");
        return { employeeId: eid!, date: date! };
      }),
    };

    try {
      const res = await fetchJson<{ savedAssignments: number; warnings: { message: string; count: number }[] }>(
        `/api/schedules/${schedule.id}/edit`,
        {
          method: "POST",
          body: JSON.stringify({ assignments: merged, preGenWishes, virtualPlacements: editedVirtualPlacements }),
        },
      );
      await loadBundle({ preserveActionMessage: true });
      setEditMode(false);
      setEditedCells(new Map());
      setEditedVirtualPlacements({});
      const warnCount = res.warnings?.length ?? 0;
      if (warnCount > 0) {
        setActionAlertSeverity("warning");
        setActionMsg(`${res.savedAssignments} Zuweisungen gespeichert. ${warnCount} Regelverstoß(e) gefunden.`);
        setWarningsOpen(true);
      } else {
        setActionAlertSeverity("success");
        setActionMsg(`${res.savedAssignments} Zuweisungen gespeichert. Keine Regelverstöße.`);
      }
    } catch (e) {
      setActionAlertSeverity("error");
      if (e instanceof ApiError) {
        const msg =
          e.body && typeof e.body === "object" && e.body !== null && "error" in e.body
            ? (e.body as { error: string }).error
            : "Speichern fehlgeschlagen.";
        setActionMsg(msg);
      } else {
        setActionMsg("Speichern fehlgeschlagen (Netzwerk).");
      }
    } finally {
      setEditSaving(false);
    }
  };

  const allProfiles = useMemo(
    () =>
      Object.values(profilesById)
        .filter((p) => p.isActive)
        .sort((a, b) => {
          const typeOrder = ["EARLY", "LATE", "NIGHT", "BL"];
          const ta = typeOrder.indexOf(a.shiftType);
          const tb = typeOrder.indexOf(b.shiftType);
          if (ta !== tb) return ta - tb;
          return a.name.localeCompare(b.name);
        }),
    [profilesById],
  );

  const holidays = useMemo(() => {
    if (viewState.type !== "month" && viewState.type !== "employee") return new Map<string, string>();
    const start = new Date(Date.UTC(viewState.year, viewState.month, 1));
    const end = new Date(Date.UTC(viewState.year, viewState.month + 1, 0));
    return holidayDateMap(start, end);
  }, [viewState]);

  // In employee view, show only that employee's warnings; otherwise show all
  const displayWarnings = viewState.type === "employee"
    ? employeeWarnings
    : (schedule?.warnings ?? []);

  /* ── Severity-aware visuals (single source of truth: warningSeverity.ts) ── */
  const warnSeverity = useMemo(
    () => highestSeverity(displayWarnings),
    [displayWarnings],
  );
  const warnIconColor = warnSeverity ? SEVERITY_TOKENS[warnSeverity].main : undefined;
  /** Sum of raw violation counts (each card may represent N violations). */
  const totalWarningCount = useMemo(
    () => displayWarnings.reduce((sum, w) => sum + w.count, 0),
    [displayWarnings],
  );

  const addPreGenEntry = (type: "shift" | "frei" | "absence") => {
    const first = planningEmployees[0];
    if (!first || daysInMonth.length === 0) return;
    const firstDay = daysInMonth[0]!.iso;
    setPreGenEntries((prev) => [
      ...prev,
      {
        employeeId: first.id,
        type,
        date: firstDay,
        shiftProfileId: allProfiles[0]?.id ?? "",
        stationNumber: first.mainStation ?? first.assignedStations?.[0] ?? 1,
        dateFrom: firstDay,
        dateTo: firstDay,
        absenceType: "KRANK",
      },
    ]);
  };

  const savePreGenEntries = async () => {
    if (!schedule) return;
    setPreGenSaving(true);
    try {
      await fetchJson(`/api/schedules/${schedule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ savedEntries: preGenEntries }),
      });
      await loadBundle({ preserveActionMessage: true });
    } catch {
      // silently ignore
    } finally {
      setPreGenSaving(false);
    }
  };

  const deletePreGenEntries = async () => {
    if (!schedule) return;
    setPreGenSaving(true);
    try {
      await fetchJson(`/api/schedules/${schedule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ savedEntries: [] }),
      });
      setPreGenEntries([]);
      await loadBundle({ preserveActionMessage: true });
    } catch {
      // silently ignore
    } finally {
      setPreGenSaving(false);
    }
  };


  return (
    <MainLayout title="Monatplan">
      <Box sx={{ mb: 2 }}>
        <Breadcrumbs>
          <Link
            component="button"
            underline="hover"
            color={viewState.type === "month" ? "text.primary" : "inherit"}
            onClick={handleBackToMonth}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              cursor: "pointer",
            }}
          >
            <CalendarMonthIcon sx={{ fontSize: 18 }} />
            Monat
          </Link>
          {(viewState.type === "week" || viewState.type === "day" || (viewState.type === "employee" && viewState.weekStartDate)) && (
            <Link
              component="button"
              underline="hover"
              color={viewState.type === "week" ? "text.primary" : "inherit"}
              onClick={handleBackToWeek}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                cursor: "pointer",
              }}
            >
              <CalendarViewWeekIcon sx={{ fontSize: 18 }} />
              KW {viewState.weekNumber || getWeekNumber(viewState.date || new Date())}
            </Link>
          )}
          {((viewState.type === "day") || (viewState.type === "employee" && viewState.date)) && viewState.date && (
            <Link
              component="button"
              underline="hover"
              color={viewState.type === "day" ? "text.primary" : "inherit"}
              onClick={() => setViewState({ ...viewState, type: "day" })}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                cursor: "pointer",
              }}
            >
              <TodayIcon sx={{ fontSize: 18 }} />
              {viewState.date.getDate()}.{viewState.date.getMonth() + 1}.
            </Link>
          )}
          {viewState.type === "employee" && viewState.employeeId && (
            <Typography
              color="text.primary"
              sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
            >
              <PersonIcon sx={{ fontSize: 18 }} />
              {(() => {
                const emp = employeesById[viewState.employeeId];
                return emp ? `${emp.firstName} ${emp.lastName}` : "Mitarbeiter";
              })()}
            </Typography>
          )}
        </Breadcrumbs>
      </Box>

      {/* ── Toolbar ── */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0.75,
          mb: 2.5,
        }}
      >
        {/* Row 1: Month nav + view toggle */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            px: 2,
            py: 0.5,
            bgcolor: "grey.50",
            border: 1,
            borderColor: "grey.200",
            borderRadius: "10px",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <IconButton
              onClick={handlePrevious}
              disabled={loading || editMode}
              size="small"
              sx={{ color: "text.secondary" }}
            >
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <Typography
              sx={{
                minWidth: 200,
                textAlign: "center",
                fontWeight: 600,
                fontSize: "0.9rem",
                userSelect: "none",
              }}
            >
              {getViewTitle()}
            </Typography>
            <IconButton
              onClick={handleNext}
              disabled={loading || editMode}
              size="small"
              sx={{ color: "text.secondary" }}
            >
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Box>

          {viewState.type === "employee" && sortedEmployees.length > 0 && (
            <>
              <Divider orientation="vertical" flexItem />
              <Autocomplete
                size="small"
                options={sortedEmployees}
                getOptionLabel={(e) => `${e.lastName} ${e.firstName}`}
                value={
                  viewState.employeeId
                    ? sortedEmployees.find((e) => e.id === viewState.employeeId) ?? undefined
                    : undefined
                }
                onChange={(_, emp) => {
                  if (emp) setViewState({ ...viewState, employeeId: emp.id });
                }}
                disableClearable
                sx={{ minWidth: { xs: 160, sm: 220 } }}
                renderInput={(inputProps) => (
                  <TextField {...inputProps} label="Mitarbeiter" />
                )}
              />
            </>
          )}

          {viewState.type === "month" && (
            <>
              <Divider orientation="vertical" flexItem />
              <ToggleButtonGroup
                value={monthViewMode}
                exclusive
                onChange={(_, value) => value && setMonthViewMode(value)}
                size="small"
                disabled={editMode}
                sx={{
                  "& .MuiToggleButton-root": {
                    px: 1.5,
                    py: 0.4,
                    fontSize: "0.72rem",
                    border: "none",
                    borderRadius: "6px !important",
                    color: "text.secondary",
                    "&.Mui-selected": {
                      bgcolor: "primary.main",
                      color: "primary.contrastText",
                      "&:hover": { bgcolor: "primary.dark" },
                    },
                    "&:hover": { bgcolor: "action.hover" },
                  },
                  bgcolor: "background.paper",
                  borderRadius: "7px",
                  p: 0.3,
                  gap: 0.3,
                  border: "none",
                  "& .MuiToggleButtonGroup-grouped": { border: "none" },
                }}
              >
                <ToggleButton value="table">
                  <TableChartIcon sx={{ fontSize: 15, mr: 0.5 }} />
                  Dienstplan
                </ToggleButton>
                <ToggleButton value="overview">
                  <GridViewIcon sx={{ fontSize: 15, mr: 0.5 }} />
                  Übersicht
                </ToggleButton>
              </ToggleButtonGroup>
            </>
          )}
        </Box>

        {/* Row 2: Tool icons with labels (month view only) */}
        {viewState.type === "month" && (
          <Box
            sx={{
              display: "flex",
              alignItems: "flex-start",
              gap: 0,
              px: 1.5,
              py: 0.5,
              bgcolor: "grey.50",
              border: 1,
              borderColor: "grey.200",
              borderRadius: "10px",
              width: { xs: "100%", md: "auto" },
            }}
          >
            {!editMode ? (
              <>
                {/* Labeled icon button helper — vertical stack */}
                <Box
                  component="button"
                  onClick={() => {
                    const saved = schedule?.preGenWishes?.savedEntries;
                    if (saved && Array.isArray(saved) && saved.length > 0) {
                      setPreGenEntries(saved as PreGenEntry[]);
                    } else {
                      setPreGenEntries([]);
                    }
                    setPreGenOpen(true);
                  }}
                  disabled={loading || !schedule || generateBusy}
                  sx={{
                    all: "unset",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.25,
                    px: { xs: 0.75, md: 1.5 },
                    py: 0.75,
                    borderRadius: "8px",
                    cursor: "pointer",
                    color: "text.secondary",
                    transition: "background-color 0.15s",
                    "&:hover:not(:disabled)": { bgcolor: "action.hover" },
                    "&:disabled": { opacity: 0.38, cursor: "default" },
                  }}
                >
                  {generateBusy ? <CircularProgress size={20} /> : <AutoAwesomeIcon sx={{ fontSize: 20 }} />}
                  <Typography sx={{ fontSize: "0.62rem", lineHeight: 1.2, color: "inherit" }}>
                    Generieren
                  </Typography>
                </Box>

                <Box
                  component="button"
                  onClick={enterEditMode}
                  disabled={
                    loading || !schedule || generateBusy ||
                    (assignments.length > 0 && (viewState.type !== "month" || monthViewMode !== "table"))
                  }
                  sx={{
                    all: "unset",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.25,
                    px: { xs: 0.75, md: 1.5 },
                    py: 0.75,
                    borderRadius: "8px",
                    cursor: "pointer",
                    color: "text.secondary",
                    transition: "background-color 0.15s",
                    "&:hover:not(:disabled)": { bgcolor: "action.hover" },
                    "&:disabled": { opacity: 0.38, cursor: "default" },
                  }}
                >
                  {assignments.length === 0 ? <DrawIcon sx={{ fontSize: 20 }} /> : <EditIcon sx={{ fontSize: 20 }} />}
                  <Typography sx={{ fontSize: "0.62rem", lineHeight: 1.2, color: "inherit" }}>
                    {assignments.length === 0 ? "Erstellen" : "Bearbeiten"}
                  </Typography>
                </Box>

                <Box
                  component="button"
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => setExportMenuEl(e.currentTarget)}
                  disabled={loading || !schedule || exportBusy || assignments.length === 0}
                  sx={{
                    all: "unset",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.25,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: "8px",
                    cursor: "pointer",
                    color: "text.secondary",
                    transition: "background-color 0.15s",
                    "&:hover:not(:disabled)": { bgcolor: "action.hover" },
                    "&:disabled": { opacity: 0.38, cursor: "default" },
                  }}
                >
                  {exportBusy ? <CircularProgress size={20} /> : <DownloadIcon sx={{ fontSize: 20 }} />}
                  <Typography sx={{ fontSize: "0.62rem", lineHeight: 1.2, color: "inherit" }}>
                    Export
                  </Typography>
                </Box>
                <Menu
                  anchorEl={exportMenuEl}
                  open={Boolean(exportMenuEl)}
                  onClose={() => setExportMenuEl(null)}
                >
                  <MenuItem onClick={() => void downloadExport("pdf")} disabled={exportBusy}>
                    Monatsplan (Stationen)
                  </MenuItem>
                  <MenuItem onClick={() => void downloadExport("employees-pdf")} disabled={exportBusy}>
                    Mitarbeiter-Dienstpläne
                  </MenuItem>
                </Menu>

                <Box
                  component="button"
                  onClick={openVersionsDrawer}
                  disabled={!schedule}
                  sx={{
                    all: "unset",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.25,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: "8px",
                    cursor: "pointer",
                    color: "text.secondary",
                    transition: "background-color 0.15s",
                    "&:hover:not(:disabled)": { bgcolor: "action.hover" },
                    "&:disabled": { opacity: 0.38, cursor: "default" },
                  }}
                >
                  <HistoryIcon sx={{ fontSize: 20 }} />
                  <Typography sx={{ fontSize: "0.62rem", lineHeight: 1.2, color: "inherit" }}>
                    Versionen
                  </Typography>
                </Box>

                <Box
                  component="button"
                  onClick={() => setClearConfirmOpen(true)}
                  disabled={loading || !schedule || clearBusy || assignments.length === 0}
                  sx={{
                    all: "unset",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.25,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: "8px",
                    cursor: "pointer",
                    color: "error.light",
                    transition: "background-color 0.15s",
                    "&:hover:not(:disabled)": { bgcolor: "action.hover" },
                    "&:disabled": { opacity: 0.38, cursor: "default" },
                  }}
                >
                  {clearBusy ? <CircularProgress size={20} /> : <DeleteSweepIcon sx={{ fontSize: 20 }} />}
                  <Typography sx={{ fontSize: "0.62rem", lineHeight: 1.2, color: "inherit" }}>
                    Leeren
                  </Typography>
                </Box>

                {isAdmin && (
                  <>
                    <Box
                      component="button"
                      onClick={(e: React.MouseEvent<HTMLButtonElement>) => setAdminMenuEl(e.currentTarget)}
                      disabled={loading || !schedule}
                      sx={{
                        all: "unset",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 0.25,
                        px: 1.5,
                        py: 0.75,
                        borderRadius: "8px",
                        cursor: "pointer",
                        color: "text.secondary",
                        transition: "background-color 0.15s",
                        "&:hover:not(:disabled)": { bgcolor: "action.hover" },
                        "&:disabled": { opacity: 0.38, cursor: "default" },
                      }}
                    >
                      <AdminPanelSettingsIcon sx={{ fontSize: 20 }} />
                      <Typography sx={{ fontSize: "0.62rem", lineHeight: 1.2, color: "inherit" }}>
                        Admin
                      </Typography>
                    </Box>
                    <Menu
                      anchorEl={adminMenuEl}
                      open={Boolean(adminMenuEl)}
                      onClose={() => setAdminMenuEl(null)}
                    >
                      <MenuItem onClick={() => { setAdminMenuEl(null); void onViewLogs(); }}>
                        <ListItemIcon><DescriptionIcon fontSize="small" /></ListItemIcon>
                        <ListItemText>Generator-Protokoll</ListItemText>
                      </MenuItem>
                      <MenuItem onClick={() => { setAdminMenuEl(null); void onViewScore(); }}>
                        <ListItemIcon><DescriptionIcon fontSize="small" /></ListItemIcon>
                        <ListItemText>Qualitätsbericht</ListItemText>
                      </MenuItem>
                      <MenuItem onClick={() => { setAdminMenuEl(null); void downloadExport("debug"); }}>
                        <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon>
                        <ListItemText>Debug JSON</ListItemText>
                      </MenuItem>
                      <Divider />
                      <MenuItem onClick={() => void onCleanAbsences()} disabled={cleanAbsencesBusy}>
                        <ListItemIcon><CleaningServicesIcon fontSize="small" /></ListItemIcon>
                        <ListItemText>Abwesenheiten bereinigen</ListItemText>
                      </MenuItem>
                    </Menu>
                  </>
                )}

                {displayWarnings.length > 0 && (
                  <Box
                    component="button"
                    onClick={() => setWarningsOpen((p) => !p)}
                    sx={{
                      all: "unset",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 0.25,
                      px: 1.5,
                      py: 0.75,
                      borderRadius: "8px",
                      cursor: "pointer",
                      color: warnIconColor ?? "warning.main",
                      transition: "background-color 0.15s",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <Badge
                      badgeContent={totalWarningCount}
                      max={9999}
                      sx={{
                        "& .MuiBadge-badge": {
                          bgcolor: warnIconColor ?? "warning.main",
                          color: "#fff",
                        },
                      }}
                    >
                      <WarningAmberIcon sx={{ fontSize: 20 }} />
                    </Badge>
                    <Typography sx={{ fontSize: "0.62rem", lineHeight: 1.2, color: "inherit" }}>
                      Warnungen
                    </Typography>
                  </Box>
                )}
              </>
            ) : (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 0.5 }}>
                <Button
                  size="small"
                  onClick={cancelEditMode}
                  disabled={editSaving}
                  sx={{
                    textTransform: "none",
                    fontWeight: 500,
                    fontSize: "0.8rem",
                    color: "text.secondary",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  Abbrechen
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  startIcon={editSaving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
                  disabled={editSaving}
                  onClick={() => void onSaveEdits()}
                  sx={{
                    textTransform: "none",
                    fontWeight: 600,
                    fontSize: "0.8rem",
                    borderRadius: "6px",
                    boxShadow: "none",
                    "&:hover": { boxShadow: "none" },
                  }}
                >
                  Speichern
                </Button>
              </Box>
            )}
          </Box>
        )}
      </Box>

      {actionMsg && (
        <Alert
          severity={actionAlertSeverity}
          sx={{ mb: 2 }}
          onClose={() => {
            setActionMsg(null);
            setActionDebugPayload(null);
            setActionAlertSeverity("info");
          }}
        >
          <Typography component="span" variant="body2">
            {actionMsg}
          </Typography>
          {actionAlertSeverity === "error" && actionDebugPayload != null && (
            <Box
              component="pre"
              sx={{
                mt: 1.5,
                mb: 0,
                p: 1,
                borderRadius: 1,
                bgcolor: "action.hover",
                fontSize: "0.7rem",
                lineHeight: 1.4,
                overflow: "auto",
                maxHeight: 240,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {JSON.stringify(actionDebugPayload, null, 2)}
            </Box>
          )}
        </Alert>
      )}
      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => void loadBundle()}>
              Erneut laden
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {editMode && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            py: 1,
            px: 2,
            mb: 2,
            bgcolor: "primary.main",
            color: "primary.contrastText",
            borderRadius: 1,
            fontWeight: 600,
            fontSize: "0.875rem",
            letterSpacing: 0.5,
          }}
        >
          <EditIcon sx={{ fontSize: 18 }} />
          Bearbeitungsmodus — Änderungen werden erst beim Speichern übernommen
        </Box>
      )}

      {infeasibleInfo && (
        <Alert
          severity="error"
          variant="outlined"
          onClose={() => setInfeasibleInfo(null)}
          sx={{ mb: 2, alignItems: "flex-start" }}
          action={
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Button
                size="small"
                variant="outlined"
                color="error"
                onClick={() => setPreGenOpen(true)}
              >
                Vorgaben öffnen
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                onClick={() => void onViewLogs()}
              >
                Protokoll anzeigen
              </Button>
              <IconButton
                size="small"
                onClick={() => setInfeasibleInfo(null)}
                aria-label="Schließen"
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          }
        >
          <AlertTitle sx={{ fontWeight: 700 }}>
            Generator: Keine zulässige Lösung (INFEASIBLE)
          </AlertTitle>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Der Solver konnte mit den aktuellen Vorgaben ({infeasibleInfo.manualPlacementCount} manuelle
            Einträge) und den Besetzungs-/Ruhezeit-Regeln keinen gültigen Dienstplan erzeugen.
            Es wurden <strong>keine Dienste eingetragen</strong>.
          </Typography>
          {infeasibleInfo.preflightIssues.length > 0 ? (
            <>
              <Typography variant="body2" sx={{ fontWeight: 600, mt: 1 }}>
                Mögliche Ursachen (Vorab-Prüfung):
              </Typography>
              <Box component="ul" sx={{ my: 0.5, pl: 3 }}>
                {infeasibleInfo.preflightIssues.slice(0, 8).map((issue, i) => (
                  <li key={i}>
                    <Typography variant="body2">{issue}</Typography>
                  </li>
                ))}
                {infeasibleInfo.preflightIssues.length > 8 && (
                  <li>
                    <Typography variant="body2" color="text.secondary">
                      … und {infeasibleInfo.preflightIssues.length - 8} weitere — siehe Protokoll.
                    </Typography>
                  </li>
                )}
              </Box>
            </>
          ) : (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Keine offensichtlichen Konflikte in den Vorgaben erkannt. Bitte prüfen Sie:
              Personalbesetzungs-Regeln, Abwesenheiten, Wochenend-/Ruhetage-Regeln, Mini-Job-Stundenobergrenzen.
              Details im Protokoll.
            </Typography>
          )}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {viewState.type === "month" && monthViewMode === "table" && (
            <MonthTableView
              year={viewState.year}
              monthIndex={viewState.month}
              assignments={assignments}
              employees={employees}
              profilesById={profilesById}
              onDayClick={handleDayClick}
              onEmployeeClick={handleEmployeeClick}
              shiftWishSet={editMode ? editedShiftWishSet : shiftWishSet}
              freiWishSet={editMode ? editedFreiWishSet : freiWishSet}
              editMode={editMode}
              editedCells={editedCells}
              onCellChange={handleCellChange}
              shiftProfiles={allProfiles}
              onToggleWish={handleToggleWish}
              holidayMap={holidays}
              warningsByDay={warningsByDay}
              staffingRequirements={staffing}
              shiftMarkings={shiftMarkings}
              virtualPlacements={schedule?.virtualPlacements ?? {}}
              editedVirtualPlacements={editedVirtualPlacements}
              onVirtualPlacementChange={handleVirtualPlacementChange}
            />
          )}

          {viewState.type === "month" && monthViewMode === "overview" && (
            <MonthView
              year={viewState.year}
              monthIndex={viewState.month}
              assignments={assignments}
              employees={employees}
              profilesById={profilesById}
              staffing={staffing}
              onWeekClick={handleWeekClick}
              onDayClick={handleDayClick}
              holidayMap={holidays}
            />
          )}

          {viewState.type === "week" && viewState.weekStartDate && (
            <WeekView
              weekStartDate={viewState.weekStartDate}
              assignments={assignments}
              employees={employees}
              profilesById={profilesById}
              onDayClick={handleDayClick}
              onEmployeeClick={handleEmployeeClick}
              shiftWishSet={shiftWishSet}
              freiWishSet={freiWishSet}
            />
          )}

          {viewState.type === "day" && viewState.date && (
            <DayView
              date={viewState.date}
              assignments={assignments}
              employeesById={employeesById}
              profilesById={profilesById}
              staffing={staffing}
              onEmployeeClick={handleEmployeeClick}
              shiftWishSet={shiftWishSet}
              freiWishSet={freiWishSet}
              scheduleId={schedule?.id}
              onAssignmentChange={refreshAssignments}
            />
          )}

          {viewState.type === "employee" && viewState.employeeId && employeesById[viewState.employeeId] && (
            <EmployeeView
              year={viewState.year}
              monthIndex={viewState.month}
              employee={employeesById[viewState.employeeId]}
              assignments={assignments}
              profilesById={profilesById}
              shiftWishSet={editMode ? editedShiftWishSet : shiftWishSet}
              freiWishSet={editMode ? editedFreiWishSet : freiWishSet}
              onDayClick={handleDayClick}
              holidayMap={holidays}
              editMode={editMode}
              editedCells={editedCells}
              onCellChange={handleCellChange}
              shiftProfiles={allProfiles}
              editSaving={editSaving}
              onEnterEditMode={enterEditMode}
              onCancelEditMode={cancelEditMode}
              onSaveEdits={() => void onSaveEdits()}
              employeeWarnings={employeeWarnings}
              onWarningsClick={() => setWarningsOpen(true)}
            />
          )}
        </>
      )}

      {/* Clear schedule confirmation */}
      <Dialog open={clearConfirmOpen} onClose={() => setClearConfirmOpen(false)}>
        <DialogTitle>Dienstplan leeren?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Alle Zuweisungen für {MONTH_NAMES[viewState.month]} {viewState.year} werden
            unwiderruflich gelöscht.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearConfirmOpen(false)}>Abbrechen</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void onClearSchedule()}
          >
            Leeren
          </Button>
        </DialogActions>
      </Dialog>

      {/* Pre-generation modal with manual placements & frei wishes */}
      <Dialog
        open={preGenOpen}
        onClose={() => !generateBusy && setPreGenOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Dienstplan generieren</DialogTitle>
        <DialogContent>
          {/* Header: tabs + saved-count chip */}
          <Box
            sx={{
              borderBottom: 1,
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mb: 2,
            }}
          >
            <Tabs
              value={preGenTab}
              onChange={(_, v: "wishes" | "settings") => setPreGenTab(v)}
              sx={{
                minHeight: 40,
                "& .MuiTab-root": {
                  textTransform: "none",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  minHeight: 40,
                  py: 0.75,
                },
              }}
            >
              <Tab
                value="settings"
                icon={<TuneIcon sx={{ fontSize: 18 }} />}
                iconPosition="start"
                label="Generator-Einstellungen"
              />
              <Tab
                value="wishes"
                icon={<EventAvailableIcon sx={{ fontSize: 18 }} />}
                iconPosition="start"
                label={
                  preGenEntries.length > 0
                    ? `Wünsche & Abwesenheiten (${preGenEntries.length})`
                    : "Wünsche & Abwesenheiten"
                }
              />
            </Tabs>

            {preGenTab === "wishes" && schedule?.preGenWishes?.savedEntries?.length ? (
              <Tooltip title="Gespeicherte Vorgaben werden bei jedem Lauf wieder geladen.">
                <Chip
                  size="small"
                  icon={<CheckCircleIcon sx={{ fontSize: 16 }} />}
                  label={`${schedule.preGenWishes.savedEntries.length} gespeichert`}
                  color="success"
                  variant="outlined"
                  sx={{ mr: 1, fontWeight: 600 }}
                />
              </Tooltip>
            ) : null}
          </Box>

          {/* ──────────────────── TAB 1: Wünsche & Abwesenheiten ──────────────────── */}
          {preGenTab === "wishes" && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Fügen Sie optional Dienstwünsche oder Frei-Wünsche hinzu. Diese
                werden als feste Vorgaben behandelt — der Generator plant den Rest
                um diese Vorgaben herum.
              </Typography>

              {preGenEntries.length > 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 2 }}>
                  {preGenEntries.map((entry, idx) => {
                    const stripe =
                      entry.type === "shift"   ? "#2e7d32" :
                      entry.type === "frei"    ? "#1565c0" :
                                                 "#c62828";
                    const tint =
                      entry.type === "shift"   ? "rgba(46,125,50,0.04)" :
                      entry.type === "frei"    ? "rgba(21,101,192,0.04)" :
                                                 "rgba(198,40,40,0.04)";
                    const TypeIcon =
                      entry.type === "shift"   ? EventAvailableIcon :
                      entry.type === "frei"    ? EventBusyIcon :
                                                 PersonOffIcon;
                    return (
                      <Box
                        key={idx}
                        sx={{
                          display: "flex",
                          gap: 1,
                          alignItems: "center",
                          flexWrap: "wrap",
                          p: 1.25,
                          pl: 1.5,
                          borderRadius: 1,
                          bgcolor: tint,
                          border: "1px solid",
                          borderColor: "divider",
                          borderLeft: `4px solid ${stripe}`,
                        }}
                      >
                        <TypeIcon sx={{ color: stripe, fontSize: 18, flexShrink: 0 }} />

                        <Autocomplete
                          size="small"
                          options={planningEmployees}
                          value={planningEmployees.find((e) => e.id === entry.employeeId) ?? undefined}
                          onChange={(_, val) => {
                            if (val) updateEntry(idx, { employeeId: val.id });
                          }}
                          getOptionLabel={(e) => `${e.lastName}, ${e.firstName}`}
                          isOptionEqualToValue={(o, v) => o.id === v.id}
                          renderInput={(params) => (
                            <TextField {...params} label="Mitarbeiter" />
                          )}
                          sx={{ minWidth: 200, flex: 1 }}
                          disableClearable
                        />
                        <TextField
                          select
                          size="small"
                          label="Typ"
                          value={entry.type}
                          onChange={(e) => {
                            const newType = e.target.value as "shift" | "frei" | "absence";
                            updateEntry(idx, { type: newType });
                          }}
                          sx={{ minWidth: 150 }}
                          SelectProps={{ native: true }}
                        >
                          <option value="shift">Dienstwunsch</option>
                          <option value="frei">Frei-Wunsch</option>
                          <option value="absence">Abwesenheit</option>
                        </TextField>

                        {entry.type === "shift" ? (
                          <>
                            <TextField
                              select
                              size="small"
                              label="Tag"
                              value={entry.date}
                              onChange={(e) => updateEntry(idx, { date: e.target.value })}
                              sx={{ minWidth: 110 }}
                              SelectProps={{ native: true }}
                            >
                              {daysInMonth.map((d) => (
                                <option key={d.iso} value={d.iso}>
                                  {d.label}
                                </option>
                              ))}
                            </TextField>
                            <TextField
                              select
                              size="small"
                              label="Schichtprofil"
                              value={entry.shiftProfileId}
                              onChange={(e) => updateEntry(idx, { shiftProfileId: e.target.value })}
                              sx={{ minWidth: 130 }}
                              SelectProps={{ native: true }}
                            >
                              {allProfiles.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </TextField>
                            <TextField
                              select
                              size="small"
                              label="Station"
                              value={entry.stationNumber}
                              onChange={(e) => updateEntry(idx, { stationNumber: Number(e.target.value) })}
                              sx={{ minWidth: 90 }}
                              SelectProps={{ native: true }}
                            >
                              <option value={0}>Egal</option>
                              <option value={1}>Station 1</option>
                              <option value={2}>Station 2</option>
                              <option value={3}>Station 3</option>
                            </TextField>
                          </>
                        ) : entry.type === "absence" ? (
                          <>
                            <TextField
                              select
                              size="small"
                              label="Art"
                              value={entry.absenceType}
                              onChange={(e) => updateEntry(idx, { absenceType: e.target.value as "KRANK" | "URLAUB" })}
                              sx={{ minWidth: 110 }}
                              SelectProps={{ native: true }}
                            >
                              <option value="KRANK">Krank</option>
                              <option value="URLAUB">Urlaub</option>
                            </TextField>
                            <TextField
                              select
                              size="small"
                              label="Von"
                              value={entry.dateFrom}
                              onChange={(e) => {
                                const from = e.target.value;
                                const patch: Partial<PreGenEntry> = { dateFrom: from };
                                if (from > entry.dateTo) patch.dateTo = from;
                                updateEntry(idx, patch);
                              }}
                              sx={{ minWidth: 110 }}
                              SelectProps={{ native: true }}
                            >
                              {daysInMonth.map((d) => (
                                <option key={d.iso} value={d.iso}>
                                  {d.label}
                                </option>
                              ))}
                            </TextField>
                            <TextField
                              select
                              size="small"
                              label="Bis"
                              value={entry.dateTo}
                              onChange={(e) => {
                                const to = e.target.value;
                                const patch: Partial<PreGenEntry> = { dateTo: to };
                                if (to < entry.dateFrom) patch.dateFrom = to;
                                updateEntry(idx, patch);
                              }}
                              sx={{ minWidth: 110 }}
                              SelectProps={{ native: true }}
                            >
                              {daysInMonth.map((d) => (
                                <option key={d.iso} value={d.iso}>
                                  {d.label}
                                </option>
                              ))}
                            </TextField>
                          </>
                        ) : (
                          <>
                            <TextField
                              select
                              size="small"
                              label="Von"
                              value={entry.dateFrom}
                              onChange={(e) => {
                                const from = e.target.value;
                                const patch: Partial<PreGenEntry> = { dateFrom: from };
                                if (from > entry.dateTo) patch.dateTo = from;
                                updateEntry(idx, patch);
                              }}
                              sx={{ minWidth: 110 }}
                              SelectProps={{ native: true }}
                            >
                              {daysInMonth.map((d) => (
                                <option key={d.iso} value={d.iso}>
                                  {d.label}
                                </option>
                              ))}
                            </TextField>
                            <TextField
                              select
                              size="small"
                              label="Bis"
                              value={entry.dateTo}
                              onChange={(e) => {
                                const to = e.target.value;
                                const patch: Partial<PreGenEntry> = { dateTo: to };
                                if (to < entry.dateFrom) patch.dateFrom = to;
                                updateEntry(idx, patch);
                              }}
                              sx={{ minWidth: 110 }}
                              SelectProps={{ native: true }}
                            >
                              {daysInMonth.map((d) => (
                                <option key={d.iso} value={d.iso}>
                                  {d.label}
                                </option>
                              ))}
                            </TextField>
                          </>
                        )}

                        <Tooltip title="Eintrag entfernen" arrow>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => removeEntry(idx)}
                            sx={{ ml: "auto" }}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    );
                  })}
                </Box>
              )}

              {/* Add buttons — colored to match each entry's left-stripe */}
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<EventAvailableIcon />}
                  onClick={() => addPreGenEntry("shift")}
                  disabled={planningEmployees.length === 0}
                  sx={{
                    textTransform: "none",
                    color: "#2e7d32",
                    borderColor: "rgba(46,125,50,0.5)",
                    "&:hover": { borderColor: "#2e7d32", bgcolor: "rgba(46,125,50,0.04)" },
                  }}
                >
                  Dienstwunsch
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<EventBusyIcon />}
                  onClick={() => addPreGenEntry("frei")}
                  disabled={planningEmployees.length === 0}
                  sx={{
                    textTransform: "none",
                    color: "#1565c0",
                    borderColor: "rgba(21,101,192,0.5)",
                    "&:hover": { borderColor: "#1565c0", bgcolor: "rgba(21,101,192,0.04)" },
                  }}
                >
                  Frei-Wunsch
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<PersonOffIcon />}
                  onClick={() => addPreGenEntry("absence")}
                  disabled={planningEmployees.length === 0}
                  sx={{
                    textTransform: "none",
                    color: "#c62828",
                    borderColor: "rgba(198,40,40,0.5)",
                    "&:hover": { borderColor: "#c62828", bgcolor: "rgba(198,40,40,0.04)" },
                  }}
                >
                  Abwesenheit
                </Button>
              </Stack>

              {/* Save / Delete bar */}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  mt: 2,
                  pt: 1.5,
                  borderTop: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Button
                  size="small"
                  variant="contained"
                  startIcon={preGenSaving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
                  onClick={() => void savePreGenEntries()}
                  disabled={preGenSaving || preGenEntries.length === 0}
                  sx={{ textTransform: "none" }}
                >
                  Vorgaben speichern
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteSweepIcon />}
                  onClick={() => void deletePreGenEntries()}
                  disabled={preGenSaving || !(schedule?.preGenWishes?.savedEntries?.length)}
                  sx={{ textTransform: "none" }}
                >
                  Gespeicherte löschen
                </Button>
              </Box>
            </Box>
          )}

          {/* ──────────────────── TAB 2: Generator-Einstellungen ──────────────────── */}
          {preGenTab === "settings" && (
            <Stack spacing={3}>
              {/* Solver-Zeit & Anzahl Läufe */}
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
                  Solver-Zeit & Anzahl Läufe
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
                  Wie lange darf der Solver suchen? Mehr Zeit = bessere Lösung,
                  aber längere Wartezeit.
                </Typography>
                <ToggleButtonGroup
                  value={timingMode}
                  exclusive
                  onChange={(_, v) => {
                    if (v === "FIXED" || v === "PLATEAU") setTimingMode(v);
                  }}
                  size="small"
                  fullWidth
                  sx={{
                    mb: 1.5,
                    "& .MuiToggleButton-root": {
                      textTransform: "none",
                      fontWeight: 600,
                      gap: 0.75,
                      py: 1,
                      borderColor: "divider",
                    },
                    "& .MuiToggleButton-root.Mui-selected": {
                      bgcolor: (t) => t.palette.primary.main,
                      color: "#fff",
                      borderColor: (t) => t.palette.primary.main,
                      "&:hover": { bgcolor: (t) => t.palette.primary.dark },
                    },
                  }}
                >
                  <ToggleButton value="FIXED">
                    <TimerIcon sx={{ fontSize: 18 }} />
                    Festes Zeitlimit
                  </ToggleButton>
                  <ToggleButton value="PLATEAU">
                    <TrendingFlatIcon sx={{ fontSize: 18 }} />
                    Plateau-Erkennung (Test)
                  </ToggleButton>
                </ToggleButtonGroup>

                {timingMode === "FIXED" ? (
                  <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        Jeder Lauf läuft genau die angegebene Anzahl Sekunden.
                        Bei mehreren Läufen wird der Plan mit dem besten
                        Objective übernommen.
                      </Typography>
                      {(() => {
                        const sec = Number(solveTimeDraft);
                        const n = Math.max(1, Math.min(10, Math.floor(Number(raceCountDraft) || 1)));
                        const total = Number.isFinite(sec) && sec > 0 ? sec * n : null;
                        return total != null ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block", mt: 0.5, fontVariantNumeric: "tabular-nums" }}
                          >
                            ≈ {total}s gesamt ({sec}s × {n} {n === 1 ? "Lauf" : "Läufe"})
                          </Typography>
                        ) : null;
                      })()}
                    </Box>
                    <TextField
                      size="small"
                      type="number"
                      label="Sek."
                      value={solveTimeDraft}
                      onChange={(e) => setSolveTimeDraft(e.target.value)}
                      inputProps={{ min: 5, max: 3600, step: 5 }}
                      sx={{ width: 110 }}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Läufe"
                      value={raceCountDraft}
                      onChange={(e) => setRaceCountDraft(e.target.value)}
                      inputProps={{ min: 1, max: 10, step: 1 }}
                      sx={{ width: 90 }}
                    />
                  </Box>
                ) : (
                  <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        Jeder Lauf endet, sobald für die angegebene Sekunden-Zahl
                        keine bessere Lösung mehr gefunden wurde. Gesamtdauer
                        hängt davon ab, wie schnell die Suche konvergiert
                        (Hard-Cap intern: 30 Min. pro Lauf).
                      </Typography>
                    </Box>
                    <TextField
                      size="small"
                      type="number"
                      label="Plateau-Sek."
                      value={plateauSecondsDraft}
                      onChange={(e) => setPlateauSecondsDraft(e.target.value)}
                      inputProps={{ min: 5, max: 600, step: 5 }}
                      sx={{ width: 130 }}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Läufe"
                      value={raceCountDraft}
                      onChange={(e) => setRaceCountDraft(e.target.value)}
                      inputProps={{ min: 1, max: 10, step: 1 }}
                      sx={{ width: 90 }}
                    />
                  </Box>
                )}
              </Box>

              {/* Strategie bei Engpässen */}
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
                  Strategie bei Engpässen
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
                  Wie soll der Solver mit knappen Personalsituationen umgehen?
                </Typography>
                <ToggleButtonGroup
                  value={strategyDraft}
                  exclusive
                  onChange={(_, v) => {
                    if (v === "PREFER_FULL_COVERAGE" || v === "PREFER_GAPS") {
                      setStrategyDraft(v);
                    }
                  }}
                  size="small"
                  fullWidth
                  sx={{
                    mb: 1,
                    "& .MuiToggleButton-root": {
                      textTransform: "none",
                      fontWeight: 600,
                      gap: 0.75,
                      py: 1,
                      borderColor: "divider",
                    },
                    // The two strategies pull in opposite directions, so each
                    // active state gets its own colour — green for "fill everything"
                    // (the optimistic / preferred default) and amber for "leave gaps".
                    "& .MuiToggleButton-root[value='PREFER_FULL_COVERAGE'].Mui-selected": {
                      bgcolor: "#2e7d32",
                      color: "#fff",
                      borderColor: "#2e7d32",
                      "&:hover": { bgcolor: "#1b5e20" },
                    },
                    "& .MuiToggleButton-root[value='PREFER_GAPS'].Mui-selected": {
                      bgcolor: "#ed6c02",
                      color: "#fff",
                      borderColor: "#ed6c02",
                      "&:hover": { bgcolor: "#c95a02" },
                    },
                  }}
                >
                  <ToggleButton value="PREFER_FULL_COVERAGE">
                    <DoneAllIcon sx={{ fontSize: 18 }} />
                    Vollabdeckung anstreben
                  </ToggleButton>
                  <ToggleButton value="PREFER_GAPS">
                    <CropFreeIcon sx={{ fontSize: 18 }} />
                    Lieber Slot leer lassen
                  </ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  {strategyDraft === "PREFER_FULL_COVERAGE"
                    ? "Standard. Der Solver füllt jeden Pflicht-Slot — auch mit Überstunden oder im Notfall durch Brechen weicher Regeln (Wechsel-Wochenenden, max. Tage in Folge, Ruhe nach 6+ Tagen)."
                    : "Der Solver lässt Slots lieber unbesetzt als Überstunden zu vergeben oder Regeln zu brechen. Sie füllen die Lücken anschließend von Hand."}
                </Typography>
              </Box>
            </Stack>
          )}
        
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreGenOpen(false)}>Abbrechen</Button>
          <Button
            variant="contained"
            startIcon={<AutoAwesomeIcon />}
            onClick={() => void onGenerate()}
            disabled={generateBusy}
          >
            Generieren
          </Button>
        </DialogActions>
      </Dialog>

      {/* Generation progress modal */}
      <Dialog open={genModalOpen} maxWidth="sm" fullWidth>
        <DialogTitle>
          Dienstplan wird generiert
          {genRaceSlots.length > 1 ? (
            <Chip
              label={`Mehrfach-Lauf (${genRaceSlots.length}×)`}
              size="small"
              color="info"
              sx={{ ml: 1, verticalAlign: "middle" }}
            />
          ) : null}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2 }}>
            <LinearProgress
              variant={genProgress.done ? "determinate" : "indeterminate"}
              value={genProgress.done ? 100 : undefined}
              sx={{ height: 6, borderRadius: 1, mb: 2 }}
            />
            {genRaceSlots.length > 0 && genPhaseLabel ? (
              <Typography
                variant="body2"
                color="info.main"
                sx={{ fontWeight: 500, mb: 0.5 }}
              >
                {genPhaseLabel}
              </Typography>
            ) : null}
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <Typography variant="body2" color="text.secondary">
                {/* In a Mehrfach-Lauf we switch to the stacked per-variant
                    display below — the single-line "Aktueller Wert" would
                    otherwise oscillate as different races report. */}
                {genRaceSlots.length > 0
                  ? ""
                  : genProgress.solutions != null && genProgress.solutions > 0
                    ? `Suche beste Lösung…${genProgress.objective != null ? ` Aktueller Wert: ${genProgress.objective.toFixed(0)}` : ""}${genGap != null ? ` · Lücke ${genGap.toFixed(1)}%` : ""}`
                    : genProgress.label}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums", ml: 2, whiteSpace: "nowrap" }}>
                {(() => {
                  // Live "since last improvement" counter: race-relative.
                  // Computed from genCurrentRaceStartMs (browser-side
                  // wall-clock) minus genLastImprovementElapsed (sent by
                  // the solver). Re-renders ~10×/s because genElapsed ticks.
                  let sinceImprovementStr = "";
                  if (
                    genCurrentRaceStartMs != null &&
                    genLastImprovementElapsed != null
                  ) {
                    const sinceSec = Math.max(
                      0,
                      (Date.now() - genCurrentRaceStartMs) / 1000 -
                        genLastImprovementElapsed,
                    );
                    sinceImprovementStr = ` · Verbesserung vor ${sinceSec.toFixed(0)}s`;
                  }
                  if (timingMode === "PLATEAU") {
                    return `${genElapsed}s · Plateau ${plateauSecondsDraft}s${sinceImprovementStr}`;
                  }
                  const sec = Number(solveTimeDraft) || 0;
                  const n = Math.max(
                    1,
                    Math.min(10, Math.floor(Number(raceCountDraft) || 1)),
                  );
                  return `${genElapsed}/${sec * n}s${sinceImprovementStr}`;
                })()}
              </Typography>
            </Box>
            {/* Mehrfach-Lauf — stacked per-variant live display.
                One row per race, each with its own live objective, a neutral
                status label, and a floating 🏆 trophy in the first column on
                the row for the best-so-far variant (driven by
                genBestSoFarVariant from server-sent bestSoFarVariant). */}
            {genRaceSlots.length > 0 ? (
              <Box
                sx={{
                  mt: 1,
                  p: 1,
                  borderRadius: 1,
                  backgroundColor: "grey.50",
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                }}
              >
                {genRaceSlots.map((slot) => {
                  const liveVal = slot.finalObjective ?? slot.objective;
                  const hasVal = typeof liveVal === "number";
                  const marker =
                    slot.status === "pending"
                      ? "wartet"
                      : slot.status === "failed"
                        ? "Fehler"
                        : slot.status === "done"
                          ? "fertig"
                          : "läuft";
                  const isBest = slot.variant === genBestSoFarVariant;
                  return (
                    <Box
                      key={slot.variant}
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "24px 120px 1fr auto",
                        alignItems: "baseline",
                        gap: 1,
                        py: 0.25,
                        opacity: slot.status === "pending" ? 0.5 : 1,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.95rem",
                          textAlign: "center",
                          lineHeight: 1,
                        }}
                        aria-label={isBest ? "Bester Lauf" : undefined}
                        title={isBest ? "Bester Lauf (niedrigstes Objective)" : undefined}
                      >
                        {isBest ? "🏆" : ""}
                      </span>
                      <span style={{ fontWeight: slot.status === "running" ? 600 : 400 }}>
                        {slot.label}:
                      </span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {hasVal ? liveVal!.toLocaleString("de-DE") : "—"}
                        {slot.status === "running" &&
                        slot.solutions != null &&
                        slot.solutions > 0
                          ? ` (Lsg. #${slot.solutions})`
                          : ""}
                        {slot.gap != null
                          ? ` · Lücke ${slot.gap.toFixed(1)}%`
                          : ""}
                      </span>
                      <span
                        style={{
                          fontSize: "0.72rem",
                          color:
                            slot.status === "failed"
                              ? "#c62828"
                              : slot.status === "done"
                                ? "#2e7d32"
                                : "#666",
                        }}
                      >
                        {marker}
                      </span>
                    </Box>
                  );
                })}
              </Box>
            ) : null}

            {/* Final-state summary card. Shown once generation has ended
                (success / cancelled-with-result / error). Modal stays
                open after this so the planner can read the result before
                explicitly closing. */}
            {genFinalState ? (
              <Alert
                severity={
                  genFinalState.kind === "success"
                    ? "success"
                    : genFinalState.kind === "cancelled"
                      ? "warning"
                      : "error"
                }
                sx={{ mt: 2 }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {genFinalState.kind === "success"
                    ? "Plan erstellt"
                    : genFinalState.kind === "cancelled"
                      ? "Abgebrochen — bestes Zwischenergebnis übernommen"
                      : "Fehlgeschlagen"}
                </Typography>
                <Typography variant="body2">{genFinalState.message}</Typography>
                {genFinalState.kind !== "error" ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 0.5 }}
                  >
                    Plan ist gespeichert. Sie können das Fenster jetzt schließen.
                  </Typography>
                ) : null}
              </Alert>
            ) : null}
          </Box>
        </DialogContent>
        <DialogActions>
          {generateBusy ? (
            <Button
              onClick={() => void onCancelGeneration()}
              color="warning"
              disabled={genCancelInFlight}
            >
              {genCancelInFlight ? "Abbruch läuft…" : "Abbrechen"}
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={() => setGenModalOpen(false)}
              autoFocus
            >
              Schließen
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Generation logs dialog */}
      <Dialog
        open={logDialogOpen}
        onClose={() => setLogDialogOpen(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <DescriptionIcon color="primary" />
            Generator-Protokoll — {MONTH_NAMES[viewState.month]} {viewState.year}
          </Box>
          <IconButton size="small" onClick={() => setLogDialogOpen(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {logLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
              <CircularProgress />
            </Box>
          ) : logContent ? (
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1.5,
                bgcolor: "grey.50",
                borderRadius: 1,
                fontSize: "0.75rem",
                lineHeight: 1.5,
                overflow: "auto",
                maxHeight: "60vh",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "monospace",
              }}
            >
              {logContent}
            </Box>
          ) : (
            <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
              Kein Protokoll für {MONTH_NAMES[viewState.month]} {viewState.year} vorhanden.
              Generieren Sie zuerst einen Dienstplan.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLogDialogOpen(false)}>Schließen</Button>
        </DialogActions>
      </Dialog>

      {/* Score report modal */}
      <Dialog
        open={scoreDialogOpen}
        onClose={() => setScoreDialogOpen(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <DescriptionIcon color="primary" />
            Qualitätsbericht — {MONTH_NAMES[viewState.month]} {viewState.year}
          </Box>
          <IconButton size="small" onClick={() => setScoreDialogOpen(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {scoreLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
              <CircularProgress />
            </Box>
          ) : scoreContent ? (
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1.5,
                bgcolor: "grey.50",
                borderRadius: 1,
                fontSize: "0.75rem",
                lineHeight: 1.5,
                overflow: "auto",
                maxHeight: "60vh",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "monospace",
              }}
            >
              {scoreContent}
            </Box>
          ) : (
            <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
              Kein Qualitätsbericht vorhanden.
              Generieren Sie zuerst einen Dienstplan.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScoreDialogOpen(false)}>Schließen</Button>
        </DialogActions>
      </Dialog>

      {/* Warnings sidebar (severity-tiered) */}
      <WarningsDrawer
        open={warningsOpen}
        onClose={() => setWarningsOpen(false)}
        title={
          viewState.type === "employee" && viewState.employeeId && employeesById[viewState.employeeId]
            ? `Warnungen — ${employeesById[viewState.employeeId].firstName} ${employeesById[viewState.employeeId].lastName}`
            : "Warnungen"
        }
        emptyText={
          viewState.type === "employee"
            ? "Keine Warnungen für diesen Mitarbeiter."
            : "Keine Warnungen für diesen Monat."
        }
        warnings={displayWarnings}
      />

      {/* Versions sidebar */}
      <Drawer
        anchor="right"
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        variant="temporary"
        PaperProps={{
          sx: { width: { xs: "100%", sm: 400 }, p: 0, display: "flex", flexDirection: "column" },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 1.5,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <HistoryIcon color="primary" />
            <Typography variant="h6" sx={{ fontSize: "1rem" }}>
              Versionsverlauf
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={versionBusy ? <CircularProgress size={14} /> : <BookmarkIcon />}
              disabled={loading || !schedule || assignments.length === 0 || versionBusy}
              onClick={() => void saveVersionManual()}
              sx={{ textTransform: "none", fontSize: "0.78rem", borderRadius: "6px" }}
            >
              Speichern
            </Button>
            <IconButton size="small" onClick={() => setVersionsOpen(false)}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>
        <Divider />
        <Box sx={{ p: 2, overflow: "auto", flex: 1 }}>
          {versionsLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          ) : versions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Keine Versionen vorhanden. Versionen werden automatisch vor
              Neugenerierung und Leeren erstellt.
            </Typography>
          ) : (
            versions.map((v) => {
              const date = new Date(v.createdAt);
              const dateStr = date.toLocaleDateString("de-DE", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });
              // Extract score summary if available
              let scoreSummary = "";
              if (v.scoreReport) {
                try {
                  const scoreData = JSON.parse(v.scoreReport);
                  if (scoreData?.overall_score != null) {
                    scoreSummary = `Score: ${scoreData.overall_score}%`;
                  }
                } catch { /* ignore */ }
              }
              const isCurrent = v.id === currentVersionId;
              return (
                <Box
                  key={v.id}
                  sx={{
                    mb: 1.5,
                    p: 1.5,
                    border: isCurrent ? "2px solid" : "1px solid",
                    borderColor: isCurrent ? "primary.main" : "divider",
                    borderRadius: 1,
                    bgcolor: isCurrent ? "primary.50" : undefined,
                    "&:hover": { bgcolor: isCurrent ? "primary.100" : "action.hover" },
                  }}
                >
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 0.5 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flex: 1, minWidth: 0 }}>
                      {renamingVersionId === v.id ? (
                        <>
                          <TextField
                            size="small"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void commitRenameVersion();
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelRenameVersion();
                              }
                            }}
                            autoFocus
                            disabled={renameSaving}
                            inputProps={{ maxLength: 200 }}
                            sx={{
                              flex: 1,
                              "& .MuiInputBase-input": { fontSize: "0.85rem", py: 0.5 },
                            }}
                          />
                          <IconButton
                            size="small"
                            color="primary"
                            disabled={renameSaving || !renameDraft.trim()}
                            onClick={() => void commitRenameVersion()}
                          >
                            {renameSaving ? <CircularProgress size={14} /> : <SaveIcon fontSize="small" />}
                          </IconButton>
                          <IconButton
                            size="small"
                            disabled={renameSaving}
                            onClick={cancelRenameVersion}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </>
                      ) : (
                        <>
                          <Typography
                            variant="subtitle2"
                            sx={{
                              fontWeight: 600,
                              fontSize: "0.85rem",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={v.label}
                          >
                            {v.label}
                          </Typography>
                          {isCurrent && (
                            <Chip
                              size="small"
                              label="Aktuell"
                              color="primary"
                              sx={{ fontSize: "0.7rem", height: 20, fontWeight: 600 }}
                            />
                          )}
                          <Tooltip title="Umbenennen">
                            <span>
                              <IconButton
                                size="small"
                                disabled={versionBusy}
                                onClick={() => startRenameVersion(v.id, v.label)}
                                sx={{ p: 0.25 }}
                              >
                                <EditIcon sx={{ fontSize: "0.9rem" }} />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </>
                      )}
                    </Box>
                    {renamingVersionId !== v.id && (
                      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap", ml: 1 }}>
                        {dateStr}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1, flexWrap: "wrap" }}>
                    <Chip
                      size="small"
                      label={`${v.assignmentCount} Zuweisungen`}
                      variant="outlined"
                      sx={{ fontSize: "0.75rem", height: 22 }}
                    />
                    {v.warningCount != null && (
                      <Chip
                        size="small"
                        label={`${v.warningCount} ${v.warningCount === 1 ? "Warnung" : "Warnungen"}`}
                        color={v.warningCount === 0 ? "success" : v.warningCount < 5 ? "warning" : "error"}
                        variant="outlined"
                        icon={<WarningAmberIcon sx={{ fontSize: "0.9rem !important" }} />}
                        sx={{ fontSize: "0.75rem", height: 22 }}
                      />
                    )}
                    {scoreSummary && (
                      <Chip
                        size="small"
                        label={scoreSummary}
                        color="primary"
                        variant="outlined"
                        sx={{ fontSize: "0.75rem", height: 22 }}
                      />
                    )}
                  </Box>
                  <Box sx={{ display: "flex", gap: 0.5, justifyContent: "flex-end" }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<RestoreIcon />}
                      disabled={versionBusy || isCurrent || renamingVersionId === v.id}
                      onClick={() => void restoreVersion(v.id)}
                      sx={{ fontSize: "0.75rem", textTransform: "none" }}
                    >
                      Wiederherstellen
                    </Button>
                    <IconButton
                      size="small"
                      color="error"
                      disabled={versionBusy || renamingVersionId === v.id}
                      onClick={() => void deleteVersion(v.id)}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              );
            })
          )}
        </Box>
      </Drawer>
    </MainLayout>
  );
}
