"use client";

import { useCallback, useEffect, useState } from "react";
import MainLayout from "@/components/layout/MainLayout";
import MonthView from "@/components/schedule/MonthView";
import MonthTableView from "@/components/schedule/MonthTableView";
import WeekView from "@/components/schedule/WeekView";
import DayView from "@/components/schedule/DayView";
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
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import PublishIcon from "@mui/icons-material/Publish";
import DownloadIcon from "@mui/icons-material/Download";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import CalendarViewWeekIcon from "@mui/icons-material/CalendarViewWeek";
import TodayIcon from "@mui/icons-material/Today";
import TableChartIcon from "@mui/icons-material/TableChart";
import GridViewIcon from "@mui/icons-material/GridView";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
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
import { getWeekNumber } from "@/lib/schedule/viewUtils";

type GenerateScheduleResponse = {
  createdAssignments: number;
  unmetStaffing: { date: string; shiftType: string; requested: number; assigned: number }[];
  warnings: string[];
};

type ViewType = "month" | "week" | "day";
type MonthViewMode = "table" | "overview";

interface ViewState {
  type: ViewType;
  year: number;
  month: number;
  weekNumber?: number;
  weekStartDate?: Date;
  date?: Date;
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

  const handlePrevious = () => {
    if (viewState.type === "month") {
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
    if (viewState.type === "month") {
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

  const getViewTitle = () => {
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

  const downloadExport = async (kind: "excel" | "pdf") => {
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
      const fallback = kind === "excel" ? "dienstplan.xlsx" : "dienstplan.pdf";
      const filename = m?.[1] ?? fallback;
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
    setGenerateBusy(true);
    setActionMsg(null);
    setActionDebugPayload(null);
    setActionAlertSeverity("info");
    try {
      const res = await fetchJson<GenerateScheduleResponse>(
        `/api/schedules/${schedule.id}/generate`,
        { method: "POST" },
      );
      await loadBundle({ preserveActionMessage: true });

      const parts: string[] = [];
      if (res.createdAssignments > 0) {
        parts.push(`${res.createdAssignments} Dienste eingetragen.`);
      } else {
        parts.push("Es wurden keine Dienste eingetragen.");
      }
      for (const w of res.warnings ?? []) {
        if (w.trim()) parts.push(w.trim());
      }
      const unmet = res.unmetStaffing?.length ?? 0;
      if (unmet > 0) {
        parts.push(`${unmet} Bedarfsslots nur teilweise oder gar nicht besetzt.`);
      }

      const hasIssue =
        res.createdAssignments === 0 ||
        (res.warnings?.length ?? 0) > 0 ||
        unmet > 0;
      setActionAlertSeverity(hasIssue ? "warning" : "success");
      setActionMsg(parts.join(" "));
      setActionDebugPayload(null);
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
            : "Generierung fehlgeschlagen.";
        setActionMsg(msg);
        const raw = e.body;
        const details =
          raw &&
          typeof raw === "object" &&
          raw !== null &&
          "details" in raw
            ? (raw as { details: unknown }).details
            : undefined;
        setActionDebugPayload(
          details !== undefined
            ? { httpStatus: e.status, details }
            : { httpStatus: e.status, responseBody: raw },
        );
        console.error("Entwurf füllen — API-Fehler", e.status, raw);
      } else {
        setActionMsg("Generierung fehlgeschlagen (Netzwerk).");
        setActionDebugPayload({ kind: "client", message: String(e) });
        console.error("Entwurf füllen — Client/Netzwerk", e);
      }
    } finally {
      setGenerateBusy(false);
    }
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
          {(viewState.type === "week" || viewState.type === "day") && (
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
          {viewState.type === "day" && viewState.date && (
            <Typography
              color="text.primary"
              sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
            >
              <TodayIcon sx={{ fontSize: 18 }} />
              {viewState.date.getDate()}.{viewState.date.getMonth() + 1}.
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
          <>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              disabled={loading || !schedule || exportBusy}
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
            </Menu>
          </>
          <Button
            variant="outlined"
            startIcon={<AutoAwesomeIcon />}
            disabled={loading || !schedule || generateBusy}
            onClick={() => void onGenerate()}
          >
            {generateBusy ? <CircularProgress size={20} /> : "Entwurf füllen"}
          </Button>
          <Button
            variant="contained"
            startIcon={<PublishIcon />}
            disabled={loading || !schedule || schedule.status !== "DRAFT" || publishBusy}
            onClick={() => void onPublish()}
          >
            {publishBusy ? <CircularProgress size={20} color="inherit" /> : "Veröffentlichen"}
          </Button>
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
            />
          )}

          {viewState.type === "month" && monthViewMode === "overview" && (
            <MonthView
              year={viewState.year}
              monthIndex={viewState.month}
              assignments={assignments}
              profilesById={profilesById}
              staffing={staffing}
              onWeekClick={handleWeekClick}
              onDayClick={handleDayClick}
            />
          )}

          {viewState.type === "week" && viewState.weekStartDate && (
            <WeekView
              weekStartDate={viewState.weekStartDate}
              assignments={assignments}
              employees={employees}
              profilesById={profilesById}
              onDayClick={handleDayClick}
            />
          )}

          {viewState.type === "day" && viewState.date && (
            <DayView
              date={viewState.date}
              assignments={assignments}
              employeesById={employeesById}
              profilesById={profilesById}
            />
          )}
        </>
      ) : null}
    </MainLayout>
  );
}
