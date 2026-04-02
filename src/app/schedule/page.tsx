"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MainLayout from "@/components/layout/MainLayout";
import MonthView from "@/components/schedule/MonthView";
import MonthTableView, { type CellEdit } from "@/components/schedule/MonthTableView";
import WeekView from "@/components/schedule/WeekView";
import DayView from "@/components/schedule/DayView";
import EmployeeView from "@/components/schedule/EmployeeView";
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
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import PublishIcon from "@mui/icons-material/Publish";
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

type GenerateScheduleResponse = {
  createdAssignments: number;
  manualPlacementsApplied?: number;
  unmetStaffing: { date: string; shiftType: string; requested: number; assigned: number }[];
  warnings: string[];
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
  type: "shift" | "frei";
  date: string;
  shiftProfileId: string;
  stationNumber: number;
  dateFrom: string;
  dateTo: string;
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

export default function SchedulePage() {
  const today = new Date();
  const [viewState, setViewState] = useState<ViewState>({
    type: "month",
    year: today.getFullYear(),
    month: today.getMonth(),
  });
  const [monthViewMode, setMonthViewMode] = useState<MonthViewMode>("table");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleJson | null>(null);
  const [assignments, setAssignments] = useState<AssignmentJson[]>([]);
  const [employees, setEmployees] = useState<EmployeeJson[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, ShiftProfileJson>>({});
  const [staffing, setStaffing] = useState<StaffingJson[]>([]);
  const [publishBusy, setPublishBusy] = useState(false);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionDebugPayload, setActionDebugPayload] = useState<unknown>(null);
  const [actionAlertSeverity, setActionAlertSeverity] = useState<
    "info" | "success" | "warning" | "error"
  >("info");
  const [exportMenuEl, setExportMenuEl] = useState<null | HTMLElement>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [genProgress, setGenProgress] = useState<GenProgress>({ label: "" });
  const [genModalOpen, setGenModalOpen] = useState(false);
  const [genElapsed, setGenElapsed] = useState(0);
  const genTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [preGenOpen, setPreGenOpen] = useState(false);
  const [preGenEntries, setPreGenEntries] = useState<PreGenEntry[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [editedCells, setEditedCells] = useState<Map<string, CellEdit>>(new Map());
  const [editedShiftWishSet, setEditedShiftWishSet] = useState<Set<string>>(new Set());
  const [editedFreiWishSet, setEditedFreiWishSet] = useState<Set<string>>(new Set());
  const [editSaving, setEditSaving] = useState(false);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [logContent, setLogContent] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [scoreDialogOpen, setScoreDialogOpen] = useState(false);
  const [scoreContent, setScoreContent] = useState<string | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);

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
      [...employees].sort((a, b) =>
        `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, "de"),
      ),
    [employees],
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
    const [s0, s1, s2, s3] = await Promise.allSettled([
      fetchJson<{ schedules: ScheduleSummary[] }>("/api/schedules"),
      fetchJson<{ employees: EmployeeJson[] }>("/api/employees"),
      fetchJson<{ shiftProfiles: ShiftProfileJson[] }>("/api/shift-profiles"),
      fetchJson<{ staffingRequirements: StaffingJson[] }>("/api/staffing-requirements"),
    ]);

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
          const rv = await fetchJson<{ warnings: string[] }>(
            `/api/schedules/${picked.id}/revalidate`,
            { method: "POST" },
          );
          setSchedule((prev) =>
            prev ? { ...prev, warnings: rv.warnings } : prev,
          );
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

  /** Lightweight refresh: re-fetch assignments + revalidate warnings. */
  const refreshAssignments = useCallback(async () => {
    if (!schedule) return;
    try {
      const [detail, rv] = await Promise.all([
        fetchJson<{
          schedule: ScheduleJson;
          assignments?: AssignmentJson[];
        }>(`/api/schedules/${schedule.id}?include=assignments`),
        fetchJson<{ warnings: string[] }>(
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
    if (viewState.type === "employee" && viewState.employeeId) {
      const emp = employeesById[viewState.employeeId];
      return emp
        ? `${emp.firstName} ${emp.lastName}`
        : "Mitarbeiter";
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

  const onPublish = async () => {
    if (!schedule) return;
    setPublishBusy(true);
    setActionMsg(null);
    setActionDebugPayload(null);
    setActionAlertSeverity("info");
    try {
      const res = await fetchJson<{ alreadyPublished?: boolean }>(
        `/api/schedules/${schedule.id}/publish`,
        { method: "POST" },
      );
      await loadBundle({ preserveActionMessage: true });
      setActionAlertSeverity("success");
      setActionMsg(
        res.alreadyPublished === true
          ? "War bereits veröffentlicht."
          : "Dienstplan veröffentlicht.",
      );
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
            : "Veröffentlichen fehlgeschlagen.";
        setActionMsg(msg);
      } else {
        setActionMsg("Veröffentlichen fehlgeschlagen (Netzwerk).");
      }
    } finally {
      setPublishBusy(false);
    }
  };

  const downloadExport = async (kind: "excel" | "pdf" | "debug" | "score") => {
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
      const fallbackMap = { excel: "dienstplan.xlsx", pdf: "dienstplan.pdf", debug: "debug.json", score: "qualitaetsbericht.txt" };
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
    const blockedDates = preGenEntries
      .filter((e) => e.type === "frei")
      .flatMap((e) => expandDateRange(e.employeeId, e.dateFrom, e.dateTo));
    const body: {
      manualPlacements?: ManualPlacement[];
      blockedDates?: { employeeId: string; date: string }[];
    } = {};
    if (manualPlacements.length > 0) body.manualPlacements = manualPlacements;
    if (blockedDates.length > 0) body.blockedDates = blockedDates;

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
        if (blockedDates.length > 0) {
          const uniqueEmps = new Set(blockedDates.map((b) => b.employeeId)).size;
          msgParts.push(`${blockedDates.length} Frei-Tag(e) für ${uniqueEmps} MA berücksichtigt.`);
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
      }
    } catch (e) {
      setActionAlertSeverity("error");
      setActionMsg(e instanceof Error ? e.message : "Generierung fehlgeschlagen (Netzwerk).");
      setActionDebugPayload({ kind: "client", message: String(e) });
      console.error("Entwurf füllen — Fehler", e);
    } finally {
      if (genTimerRef.current) {
        clearInterval(genTimerRef.current);
        genTimerRef.current = null;
      }
      setGenerateBusy(false);
      setTimeout(() => setGenModalOpen(false), 800);
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

  const enterEditMode = () => {
    setEditedCells(new Map());
    setEditedShiftWishSet(new Set(shiftWishSet));
    setEditedFreiWishSet(new Set(freiWishSet));
    setEditMode(true);
  };

  const cancelEditMode = () => {
    setEditMode(false);
    setEditedCells(new Map());
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

    const merged: { employeeId: string; date: string; shiftProfileId: string; markingRow2?: string | null; markingRow3?: string | null; dayStatus?: string | null }[] = [];
    const seen = new Set<string>();

    for (const [key, cell] of editedCells) {
      seen.add(key);
      const [eid, date] = key.split("|");
      const original = assignments.find(a => a.employeeId === eid && a.date === date);
      const pid = cell.shiftProfileId !== undefined ? cell.shiftProfileId : original?.shiftProfileId;
      if (pid) {
        merged.push({
          employeeId: eid!,
          date: date!,
          shiftProfileId: pid,
          markingRow2: cell.markingRow2 !== undefined ? cell.markingRow2 : (original?.markingRow2 ?? null),
          markingRow3: cell.markingRow3 !== undefined ? cell.markingRow3 : (original?.markingRow3 ?? null),
          dayStatus: cell.dayStatus !== undefined ? cell.dayStatus : (original?.dayStatus ?? null),
        });
      }
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
      const res = await fetchJson<{ savedAssignments: number; warnings: string[] }>(
        `/api/schedules/${schedule.id}/edit`,
        {
          method: "POST",
          body: JSON.stringify({ assignments: merged, preGenWishes }),
        },
      );
      await loadBundle({ preserveActionMessage: true });
      setEditMode(false);
      setEditedCells(new Map());
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
    if (viewState.type !== "month") return new Map<string, string>();
    const start = new Date(Date.UTC(viewState.year, viewState.month, 1));
    const end = new Date(Date.UTC(viewState.year, viewState.month + 1, 0));
    return holidayDateMap(start, end);
  }, [viewState]);

  const addPreGenEntry = (type: "shift" | "frei") => {
    const first = sortedEmployees[0];
    if (!first || daysInMonth.length === 0) return;
    const firstDay = daysInMonth[0]!.iso;
    setPreGenEntries((prev) => [
      ...prev,
      {
        employeeId: first.id,
        type,
        date: firstDay,
        shiftProfileId: allProfiles[0]?.id ?? "",
        stationNumber: first.assignedStations?.[0] ?? 1,
        dateFrom: firstDay,
        dateTo: firstDay,
      },
    ]);
  };

  const statusChip =
    schedule?.status === "PUBLISHED" ? (
      <Chip label="VERÖFFENTLICHT" color="success" size="small" />
    ) : (
      <Chip label="ENTWURF" color="warning" size="small" />
    );

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

      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
          flexWrap: "wrap",
          gap: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton onClick={handlePrevious} disabled={loading}>
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="h6" sx={{ minWidth: 280, textAlign: "center" }}>
            {getViewTitle()}
          </Typography>
          <IconButton onClick={handleNext} disabled={loading}>
            <ChevronRightIcon />
          </IconButton>
          {schedule && statusChip}
        </Box>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          {viewState.type === "month" && (
            <>
              <ToggleButtonGroup
                value={monthViewMode}
                exclusive
                onChange={(_, value) => value && setMonthViewMode(value)}
                size="small"
                sx={{
                  "& .MuiToggleButton-root": {
                    px: 1.5,
                    py: 0.5,
                    fontSize: "0.75rem",
                  },
                }}
              >
                <ToggleButton value="table">
                  <TableChartIcon sx={{ fontSize: 18, mr: 0.5 }} />
                  Dienstplan
                </ToggleButton>
                <ToggleButton value="overview">
                  <GridViewIcon sx={{ fontSize: 18, mr: 0.5 }} />
                  Besetzungsübersicht
                </ToggleButton>
              </ToggleButtonGroup>
              <Box sx={{ width: 1, height: 24, bgcolor: "divider", mx: 1 }} />
            </>
          )}
          {viewState.type === "month" && (
            <>
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                disabled={loading || !schedule || exportBusy || editMode}
                onClick={(e) => setExportMenuEl(e.currentTarget)}
              >
                {exportBusy ? <CircularProgress size={20} /> : "Export"}
              </Button>
              <Menu
                anchorEl={exportMenuEl}
                open={Boolean(exportMenuEl)}
                onClose={() => setExportMenuEl(null)}
              >
                <MenuItem
                  onClick={() => void downloadExport("excel")}
                  disabled={exportBusy}
                >
                  Excel (.xlsx)
                </MenuItem>
                <MenuItem
                  onClick={() => void downloadExport("pdf")}
                  disabled={exportBusy}
                >
                  PDF
                </MenuItem>
                <MenuItem
                  onClick={() => { setExportMenuEl(null); void onViewScore(); }}
                  disabled={exportBusy}
                >
                  Qualitätsbericht
                </MenuItem>
                <MenuItem
                  onClick={() => void downloadExport("debug")}
                  disabled={exportBusy}
                >
                  Debug JSON
                </MenuItem>
              </Menu>
              <Tooltip title="Generator-Protokoll anzeigen">
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<DescriptionIcon />}
                  disabled={loading || !schedule || editMode}
                  onClick={() => void onViewLogs()}
                >
                  Logs
                </Button>
              </Tooltip>
              <Button
                variant="outlined"
                startIcon={<AutoAwesomeIcon />}
                disabled={loading || !schedule || generateBusy || editMode}
                onClick={() => {
                  setPreGenEntries([]);
                  setPreGenOpen(true);
                }}
              >
                {generateBusy ? <CircularProgress size={20} /> : "Entwurf füllen"}
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteSweepIcon />}
                disabled={loading || !schedule || clearBusy || assignments.length === 0 || editMode}
                onClick={() => setClearConfirmOpen(true)}
              >
                {clearBusy ? <CircularProgress size={20} /> : "Leeren"}
              </Button>
              {!editMode ? (
                <Button
                  variant="outlined"
                  startIcon={<EditIcon />}
                  disabled={
                    loading || !schedule || assignments.length === 0 ||
                    viewState.type !== "month" || monthViewMode !== "table"
                  }
                  onClick={enterEditMode}
                >
                  Bearbeiten
                </Button>
              ) : (
                <>
                  <Button
                    variant="outlined"
                    onClick={cancelEditMode}
                    disabled={editSaving}
                  >
                    Abbrechen
                  </Button>
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={editSaving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
                    disabled={editSaving}
                    onClick={() => void onSaveEdits()}
                  >
                    Speichern
                  </Button>
                </>
              )}
            </>
          )}
          <Button
            variant="contained"
            startIcon={<PublishIcon />}
            disabled={loading || !schedule || schedule.status !== "DRAFT" || publishBusy || editMode}
            onClick={() => void onPublish()}
          >
            {publishBusy ? <CircularProgress size={20} color="inherit" /> : "Veröffentlichen"}
          </Button>
          {(schedule?.warnings?.length ?? 0) > 0 && (
            <Tooltip title="Warnungen anzeigen">
              <IconButton
                color="warning"
                onClick={() => setWarningsOpen((p) => !p)}
              >
                <Badge
                  badgeContent={schedule?.warnings?.length ?? 0}
                  color="warning"
                >
                  <WarningAmberIcon />
                </Badge>
              </IconButton>
            </Tooltip>
          )}
        </Box>
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

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : schedule ? (
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
              shiftWishSet={shiftWishSet}
              freiWishSet={freiWishSet}
              onDayClick={handleDayClick}
            />
          )}
        </>
      ) : null}

      {/* Clear schedule confirmation */}
      <Dialog open={clearConfirmOpen} onClose={() => setClearConfirmOpen(false)}>
        <DialogTitle>Dienstplan leeren?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Alle Zuweisungen für {MONTH_NAMES[viewState.month]} {viewState.year} werden
            unwiderruflich gelöscht. Der Plan wird auf Entwurf zurückgesetzt.
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
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Fügen Sie optional Dienstwünsche oder Frei-Wünsche hinzu. Diese
            werden als feste Vorgaben behandelt — der Generator plant den Rest
            um diese Vorgaben herum.
          </Typography>

          <Divider sx={{ mb: 2 }} />

          {preGenEntries.length > 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 2 }}>
              {preGenEntries.map((entry, idx) => (
                <Box
                  key={idx}
                  sx={{
                    display: "flex",
                    gap: 1,
                    alignItems: "center",
                    flexWrap: "wrap",
                    p: 1.5,
                    borderRadius: 1,
                    bgcolor: entry.type === "frei" ? "action.hover" : "transparent",
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <Autocomplete
                    size="small"
                    options={sortedEmployees}
                    value={sortedEmployees.find((e) => e.id === entry.employeeId) ?? undefined}
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
                      const newType = e.target.value as "shift" | "frei";
                      updateEntry(idx, { type: newType });
                    }}
                    sx={{ minWidth: 130 }}
                    SelectProps={{ native: true }}
                  >
                    <option value="shift">Dienstwunsch</option>
                    <option value="frei">Frei-Wunsch</option>
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

                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => removeEntry(idx)}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}

          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => addPreGenEntry("shift")}
              disabled={sortedEmployees.length === 0}
            >
              Dienstwunsch
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="secondary"
              startIcon={<AddIcon />}
              onClick={() => addPreGenEntry("frei")}
              disabled={sortedEmployees.length === 0}
            >
              Frei-Wunsch
            </Button>
          </Box>
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
        <DialogTitle>Dienstplan wird generiert</DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2 }}>
            <LinearProgress
              variant={genProgress.done ? "determinate" : "indeterminate"}
              value={genProgress.done ? 100 : undefined}
              sx={{ height: 6, borderRadius: 1, mb: 2 }}
            />
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <Typography variant="body2" color="text.secondary">
                {genProgress.label}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums", ml: 2, whiteSpace: "nowrap" }}>
                {genElapsed}s
              </Typography>
            </Box>
            {genProgress.solutions != null && genProgress.solutions > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                Suche beste Lösung…
                {genProgress.objective != null ? ` Aktueller Wert: ${genProgress.objective.toFixed(0)}` : ""}
              </Typography>
            )}
          </Box>
        </DialogContent>
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

      {/* Warnings sidebar */}
      <Drawer
        anchor="right"
        open={warningsOpen}
        onClose={() => setWarningsOpen(false)}
        variant="temporary"
        PaperProps={{
          sx: { width: { xs: "100%", sm: 380 }, p: 0 },
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
            <WarningAmberIcon color="warning" />
            <Typography variant="h6" sx={{ fontSize: "1rem" }}>
              Warnungen
            </Typography>
          </Box>
          <IconButton size="small" onClick={() => setWarningsOpen(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        <Divider />
        <Box sx={{ p: 2, overflow: "auto", flex: 1 }}>
          {(schedule?.warnings?.length ?? 0) === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Keine Warnungen für diesen Monat.
            </Typography>
          ) : (
            schedule?.warnings?.map((w, i) => (
              <Alert
                key={i}
                severity="warning"
                sx={{ mb: 1, fontSize: "0.8rem", "& .MuiAlert-message": { py: 0.5 } }}
              >
                {w}
              </Alert>
            ))
          )}
        </Box>
      </Drawer>
    </MainLayout>
  );
}
