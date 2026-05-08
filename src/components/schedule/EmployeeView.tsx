"use client";

import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  alpha,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import WbSunnyIcon from "@mui/icons-material/WbSunny";
import WbTwilightIcon from "@mui/icons-material/WbTwilight";
import NightsStayIcon from "@mui/icons-material/NightsStay";
import EditIcon from "@mui/icons-material/Edit";
import SaveIcon from "@mui/icons-material/Save";
import CloseIcon from "@mui/icons-material/Close";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import type { AssignmentJson, EmployeeJson, ShiftProfileJson } from "@/lib/schedule/scheduleTypes";
import { formatHours } from "@/lib/schedule/viewUtils";
import { localIsoFromParts } from "@/lib/schedule/monthSchedule";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";
import QualificationPills from "@/components/schedule/QualificationPills";
import { computeSollHours, isWorkingDayIso } from "@/lib/holidays";

/* ──────────────────────── types ──────────────────────── */

export type EmployeeEditCell = {
  shiftProfileId?: string | null;
  dayStatus?: string | null;
  markingRow2?: string | null;
  markingRow3?: string | null;
  stationNumber?: number | null;
};

/* ──────────────────────── props ──────────────────────── */

interface EmployeeViewProps {
  year: number;
  monthIndex: number;
  employee: EmployeeJson;
  assignments: AssignmentJson[];
  profilesById: Record<string, ShiftProfileJson>;
  onDayClick?: (date: Date) => void;
  shiftWishSet?: Set<string>;
  freiWishSet?: Set<string>;
  holidayMap?: Map<string, string>;
  /* edit mode */
  editMode?: boolean;
  editedCells?: Map<string, EmployeeEditCell>;
  onCellChange?: (employeeId: string, date: string, edit: Partial<EmployeeEditCell>) => void;
  shiftProfiles?: ShiftProfileJson[];
  editSaving?: boolean;
  onEnterEditMode?: () => void;
  onCancelEditMode?: () => void;
  onSaveEdits?: () => void;
  /* employee-specific warnings */
  employeeWarnings?: { message: string; count: number }[];
  onWarningsClick?: () => void;
}

/* ──────────────────────── constants ──────────────────────── */

const SHIFT_ACCENT: Record<string, string> = {
  EARLY: "#f59e0b",
  LATE: "#3b82f6",
  NIGHT: "#6366f1",
};

const STATION_COLORS: Record<number, { main: string; light: string }> = {
  1: { main: "#1565c0", light: "#e3f2fd" },
  2: { main: "#2e7d32", light: "#e8f5e9" },
  3: { main: "#e65100", light: "#fff3e0" },
};

const NIGHT_STATION_COLOR = { main: "#7e57c2", light: "#ede7f6" };

const WEEKDAYS_DE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

const WISH_SHIFT_BG = "#e8f5e9";
const WISH_FREI_BG = "#e3f2fd";
const WEEKEND_BG = "#f8f9fa";
const HOLIDAY_BG = "#fff5f5";
const EDIT_CHANGED_BORDER = "2px dashed #ff9800";

const EMP_STATUS_MAP: Record<string, string> = {
  KRANK: "K", LANGZEITKRANK: "LZ", MUTTERSCHUTZ: "MS", URLAUB: "U", KUR: "KU",
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  U: { bg: "#e3f2fd", color: "#1565c0" },
  K: { bg: "#ffebee", color: "#c62828" },
  LZ: { bg: "#fce4ec", color: "#ad1457" },
  MS: { bg: "#f3e5f5", color: "#7b1fa2" },
  KU: { bg: "#fff3e0", color: "#e65100" },
  X: { bg: "#f5f5f5", color: "#9e9e9e" },
};

const STATUS_CODES = [
  { code: "U", label: "Urlaub" },
  { code: "K", label: "Krank" },
  { code: "SCH", label: "Schule" },
  { code: "MS", label: "Mutterschutz" },
  { code: "LZ", label: "Langzeitkrank" },
  { code: "KU", label: "Kur" },
] as const;

const STATUS_LABEL_MAP: Record<string, string> = Object.fromEntries(
  STATUS_CODES.map(({ code, label }) => [code, label]),
);

const MARKING_CODES = ["FO", "PA", "E", "BD"] as const;

/* ──────────────────────── helpers ──────────────────────── */

function shiftIcon(shiftType: string) {
  switch (shiftType) {
    case "EARLY":
      return <WbSunnyIcon sx={{ fontSize: 15 }} />;
    case "LATE":
      return <WbTwilightIcon sx={{ fontSize: 15 }} />;
    case "NIGHT":
      return <NightsStayIcon sx={{ fontSize: 15 }} />;
    default:
      return null;
  }
}

function paidHours(profile: ShiftProfileJson): number {
  const [sh, sm] = profile.startTime.split(":").map(Number);
  const [eh, em] = profile.endTime.split(":").map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return Math.max(0, (endMin - startMin - profile.breakMinutes) / 60);
}

// Hour formatter shared across views (see lib/schedule/viewUtils.ts).
// Local alias preserved so existing call sites don't change.
const fmtHours = formatHours;

const FULL_TIME_DAILY_HOURS = 8;
const ABSENCE_STATUS_CODES = new Set(["K", "U"]);

function stationColorForAssignment(
  stationNumber: number | null | undefined,
  shiftType: string | undefined,
): { main: string; light: string } {
  if (shiftType === "NIGHT") return NIGHT_STATION_COLOR;
  if (stationNumber != null && STATION_COLORS[stationNumber]) {
    return STATION_COLORS[stationNumber];
  }
  return { main: "#78909c", light: "#eceff1" };
}

/* ──────────────────────── component ──────────────────────── */

export default function EmployeeView({
  year,
  monthIndex,
  employee,
  assignments,
  profilesById,
  onDayClick,
  shiftWishSet,
  freiWishSet,
  holidayMap,
  editMode,
  editedCells,
  onCellChange,
  shiftProfiles,
  editSaving,
  onEnterEditMode,
  onCancelEditMode,
  onSaveEdits,
  employeeWarnings,
  onWarningsClick,
}: EmployeeViewProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const empWarnings = employeeWarnings ?? [];
  const empWarningCount = empWarnings.reduce((sum, w) => sum + w.count, 0);

  /* ── calendar days ── */
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const days = useMemo(
    () =>
      Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const iso = localIsoFromParts(year, monthIndex, day);
        const dateObj = new Date(year, monthIndex, day);
        const dow = dateObj.getDay();
        return { day, iso, dateObj, dow, weekday: WEEKDAYS_DE[dow] };
      }),
    [year, monthIndex, daysInMonth],
  );

  /* ── assignments grouped by date ── */
  const assignmentsByDate = useMemo(() => {
    const map = new Map<string, AssignmentJson[]>();
    for (const a of assignments) {
      if (a.employeeId !== employee.id) continue;
      const list = map.get(a.date) ?? [];
      list.push(a);
      map.set(a.date, list);
    }
    return map;
  }, [assignments, employee.id]);

  /* ── running totals ── */
  const runningTotals = useMemo(() => {
    const totals: number[] = [];
    let cumulative = 0;
    for (const { iso } of days) {
      const dayAssignments = assignmentsByDate.get(iso) ?? [];
      for (const a of dayAssignments) {
        if (a.dayStatus || !a.shiftProfileId) continue;
        const p = profilesById[a.shiftProfileId];
        if (p) cumulative += paidHours(p);
      }
      totals.push(cumulative);
    }
    return totals;
  }, [days, assignmentsByDate, profilesById]);

  /* ── totals ── */
  const { totalHours, workingDays } = useMemo(() => {
    let hours = 0;
    let wDays = 0;
    for (const [, dayAssignments] of assignmentsByDate) {
      wDays++;
      for (const a of dayAssignments) {
        if (a.dayStatus || !a.shiftProfileId) continue;
        const p = profilesById[a.shiftProfileId];
        if (p) hours += paidHours(p);
      }
    }
    return { totalHours: hours, workingDays: wDays };
  }, [assignmentsByDate, profilesById]);

  /* ── count K/U absence WORKING days (exclude weekends + holidays) ── */
  const absenceWorkDayCount = useMemo(() => {
    let count = 0;
    for (const [dateIso, dayAssignments] of assignmentsByDate) {
      for (const a of dayAssignments) {
        if (a.dayStatus && ABSENCE_STATUS_CODES.has(a.dayStatus) && isWorkingDayIso(dateIso)) {
          count++;
        }
      }
    }
    return count;
  }, [assignmentsByDate]);

  /* ── Absence hours: working days of K/U count as "worked" ── */
  const absenceHours = useMemo(() => {
    const pct = employee.targetHoursPercent ?? 100;
    return absenceWorkDayCount * 8 * (pct / 100);
  }, [absenceWorkDayCount, employee.targetHoursPercent]);

  /* ── Ist hours = actual shifts + absence hours ── */
  const istHours = totalHours + absenceHours;

  /* ── Soll hours (holiday-aware, NO absence reduction) ── */
  const target = useMemo(() => {
    const pct = employee.targetHoursPercent;
    if (pct != null && pct > 0) {
      return computeSollHours(year, monthIndex, pct);
    } else if (employee.targetHours != null) {
      const soll = computeSollHours(year, monthIndex, 100);
      if (soll != null) {
        if (employee.targetHoursPeriod === "WEEKLY") {
          return (employee.targetHours / 5) * (soll / 8);
        } else {
          return employee.targetHours * ((soll / 8) / 21.75);
        }
      }
    }
    return computeSollHours(year, monthIndex, pct);
  }, [employee.targetHours, employee.targetHoursPercent, employee.targetHoursPeriod, year, monthIndex]);

  const delta = target != null ? istHours - target : null;
  const tags = employee.qualificationTags ?? [];

  let hoursColor: string;
  if (target == null) {
    hoursColor = theme.palette.text.secondary;
  } else if (istHours < target - 4 || istHours > target + 16) {
    hoursColor = theme.palette.error.main;
  } else if (istHours > target + 8) {
    hoursColor = theme.palette.warning.main;
  } else {
    hoursColor = theme.palette.success.main;
  }

  const initials = `${employee.firstName.charAt(0)}${employee.lastName.charAt(0)}`;

  /* ── edit mode: menu state ── */
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuIso, setMenuIso] = useState<string | null>(null);
  const [menuType, setMenuType] = useState<"shift" | "marking2" | "marking3" | "station">("shift");

  const sortedProfiles = useMemo(() => {
    if (!shiftProfiles) return [];
    return [...shiftProfiles]
      .filter((p) => p.isActive)
      .sort((a, b) => {
        const order = ["EARLY", "LATE", "NIGHT", "BL"];
        return order.indexOf(a.shiftType) - order.indexOf(b.shiftType);
      });
  }, [shiftProfiles]);

  const profilesByType = useMemo(() => {
    const map: Record<string, ShiftProfileJson[]> = {};
    for (const p of sortedProfiles) {
      (map[p.shiftType] ??= []).push(p);
    }
    return map;
  }, [sortedProfiles]);

  const openShiftMenu = (ev: React.MouseEvent<HTMLElement>, iso: string) => {
    ev.stopPropagation();
    setMenuIso(iso);
    setMenuType("shift");
    setMenuAnchor(ev.currentTarget);
  };

  const openMarkingMenu = (ev: React.MouseEvent<HTMLElement>, iso: string, row: "marking2" | "marking3") => {
    ev.stopPropagation();
    setMenuIso(iso);
    setMenuType(row);
    setMenuAnchor(ev.currentTarget);
  };

  const openStationMenu = (ev: React.MouseEvent<HTMLElement>, iso: string) => {
    ev.stopPropagation();
    setMenuIso(iso);
    setMenuType("station");
    setMenuAnchor(ev.currentTarget);
  };

  const handleMenuSelect = (value: string | null) => {
    if (!menuIso || !onCellChange) return;
    if (menuType === "shift") {
      if (value === null) {
        onCellChange(employee.id, menuIso, { shiftProfileId: null, dayStatus: null });
      } else if (STATUS_CODES.some((s) => s.code === value)) {
        onCellChange(employee.id, menuIso, { shiftProfileId: null, dayStatus: value });
      } else {
        onCellChange(employee.id, menuIso, { shiftProfileId: value, dayStatus: null });
      }
    } else if (menuType === "marking2") {
      onCellChange(employee.id, menuIso, { markingRow2: value });
    } else if (menuType === "marking3") {
      onCellChange(employee.id, menuIso, { markingRow3: value });
    } else if (menuType === "station") {
      onCellChange(employee.id, menuIso, { stationNumber: value != null ? Number(value) : null });
    }
    setMenuAnchor(null);
    setMenuIso(null);
  };

  /* Helper: resolve what's displayed for a day (merges edits over real data) */
  function getEffectiveDay(iso: string): {
    shiftProfileId: string | null;
    dayStatus: string | null;
    markingRow2: string | null;
    markingRow3: string | null;
    stationNumber: number | null;
  } {
    const cellKey = `${employee.id}|${iso}`;
    const edit = editedCells?.get(cellKey);
    const original = (assignmentsByDate.get(iso) ?? [])[0] ?? null;

    const pid = edit?.shiftProfileId !== undefined
      ? edit.shiftProfileId
      : (original?.shiftProfileId ?? null);
    const status = edit?.dayStatus !== undefined
      ? edit.dayStatus
      : (original?.dayStatus ?? null);
    const m2 = edit?.markingRow2 !== undefined
      ? edit.markingRow2
      : (original?.markingRow2 ?? null);
    const m3 = edit?.markingRow3 !== undefined
      ? edit.markingRow3
      : (original?.markingRow3 ?? null);
    const stn = edit?.stationNumber !== undefined
      ? edit.stationNumber
      : (original?.stationNumber ?? null);

    return { shiftProfileId: pid, dayStatus: status, markingRow2: m2, markingRow3: m3, stationNumber: stn };
  }

  return (
    <Box>
      {/* Employee header card */}
      <Card variant="outlined" sx={{ mb: 2, borderRadius: 2, overflow: "hidden" }}>
        <CardContent sx={{ py: 2 }}>
          <Box sx={{ display: "flex", alignItems: { xs: "flex-start", sm: "center" }, flexDirection: { xs: "column", sm: "row" }, gap: { xs: 1.5, sm: 2 }, flexWrap: "wrap" }}>
            <Box
              sx={{
                width: { xs: 40, sm: 48 },
                height: { xs: 40, sm: 48 },
                borderRadius: "50%",
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                color: theme.palette.primary.main,
                fontWeight: 700,
                fontSize: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {initials}
            </Box>
            <Box sx={{ flex: 1, minWidth: { xs: 140, sm: 160, md: 180 } }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.3, fontSize: { xs: "1rem", sm: "1.25rem" } }}>
                  {employee.lastName}, {employee.firstName}
                </Typography>
                <QualificationPills qualifications={employee.qualifications} tags={tags} />
              </Box>
              <Typography variant="body2" color="text.secondary">
                {employee.targetHoursPercent ?? 100}% · Station {employee.assignedStations?.length ? employee.assignedStations.join("+") : "alle"} · Soll: {target != null ? `${fmtHours(target)}h` : "n/a"}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
              <Chip
                label={`${workingDays} Arbeitstage`}
                size="small"
                variant="outlined"
              />
              <Chip
                label={
                  target != null
                    ? `${fmtHours(istHours)} / ${fmtHours(target)} Std`
                    : `${fmtHours(istHours)} Std`
                }
                size="small"
                sx={{ fontWeight: 600, color: hoursColor, borderColor: hoursColor }}
                variant="outlined"
              />
              {delta != null && (
                <Chip
                  label={`${delta >= 0 ? "+" : ""}${fmtHours(delta)}h`}
                  size="small"
                  sx={{
                    fontWeight: 700,
                    bgcolor: alpha(hoursColor, 0.1),
                    color: hoursColor,
                  }}
                />
              )}
            </Box>
          </Box>
          {target != null && target > 0 && (
            <Box sx={{ mt: 1.5, display: "flex", alignItems: "center", gap: 1.5 }}>
              <LinearProgress
                variant="determinate"
                value={Math.min(Math.round((istHours / target) * 100), 100)}
                sx={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  bgcolor: alpha(hoursColor, 0.12),
                  "& .MuiLinearProgress-bar": { bgcolor: hoursColor, borderRadius: 3 },
                }}
              />
              <Typography variant="caption" sx={{ fontWeight: 700, color: hoursColor, minWidth: 40, textAlign: "right" }}>
                {target > 0 ? `${Math.round((istHours / target) * 100)}%` : ""}
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Edit mode toolbar */}
      {onEnterEditMode && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
          {!editMode ? (
            <Button
              variant="outlined"
              size="small"
              startIcon={<EditIcon />}
              onClick={onEnterEditMode}
            >
              Bearbeiten
            </Button>
          ) : (
            <>
              <Button
                variant="outlined"
                size="small"
                onClick={onCancelEditMode}
                disabled={editSaving}
              >
                Abbrechen
              </Button>
              <Button
                variant="contained"
                size="small"
                color="primary"
                startIcon={editSaving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                disabled={editSaving}
                onClick={onSaveEdits}
              >
                Speichern
              </Button>
            </>
          )}

          {/* Employee warnings */}
          <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.5 }}>
            {empWarningCount > 0 ? (
              <Chip
                icon={<WarningAmberIcon sx={{ fontSize: 16 }} />}
                label={`${empWarningCount} Warnung${empWarningCount > 1 ? "en" : ""}`}
                size="small"
                color="warning"
                variant="outlined"
                onClick={onWarningsClick}
                sx={{ cursor: onWarningsClick ? "pointer" : "default" }}
              />
            ) : (
              <Chip
                icon={<CheckCircleOutlineIcon sx={{ fontSize: 16 }} />}
                label="Keine Warnungen"
                size="small"
                color="success"
                variant="outlined"
              />
            )}
          </Box>
        </Box>
      )}

      {/* Vertical calendar */}
      <TableContainer
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          maxHeight: "65vh",
          overflow: "auto",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, width: { xs: 32, sm: 42 }, bgcolor: "background.paper", fontSize: { xs: "0.7rem", sm: "0.8rem" }, px: { xs: 0.5, sm: 1 } }}>
                Tag
              </TableCell>
              <TableCell sx={{ fontWeight: 700, width: { xs: 28, sm: 36 }, bgcolor: "background.paper", fontSize: { xs: "0.7rem", sm: "0.8rem" }, px: { xs: 0.5, sm: 1 }, display: { xs: "none", sm: "table-cell" } }}>
                WT
              </TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: "background.paper", fontSize: { xs: "0.7rem", sm: "0.8rem" }, px: { xs: 0.5, sm: 1 } }}>
                Schicht
              </TableCell>
              <TableCell sx={{ fontWeight: 700, width: { xs: 36, sm: 56 }, bgcolor: "background.paper", fontSize: { xs: "0.7rem", sm: "0.8rem" }, px: { xs: 0.5, sm: 1 } }} align="center">
                St.
              </TableCell>
              <TableCell sx={{ fontWeight: 700, width: { xs: 60, sm: 100 }, bgcolor: "background.paper", fontSize: { xs: "0.7rem", sm: "0.8rem" }, px: { xs: 0.5, sm: 1 }, display: { xs: "none", sm: "table-cell" } }} align="center">
                Uhrzeit
              </TableCell>
              <TableCell sx={{ fontWeight: 700, width: { xs: 40, sm: 65 }, bgcolor: "background.paper", fontSize: { xs: "0.7rem", sm: "0.8rem" }, px: { xs: 0.5, sm: 1 } }} align="right">
                Std
              </TableCell>
              <TableCell sx={{ fontWeight: 700, width: { xs: 40, sm: 65 }, bgcolor: "background.paper", fontSize: { xs: "0.7rem", sm: "0.8rem" }, px: { xs: 0.5, sm: 1 } }} align="right">
                Kum.
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {days.map(({ day, iso, dateObj, dow, weekday }, dayIdx) => {
              const isWeekend = dow === 0 || dow === 6;
              const holidayName = holidayMap?.get(iso);
              const isHoliday = !!holidayName;
              const wishKey = `${employee.id}|${iso}`;
              const isToday = (() => {
                const t = new Date();
                return t.getFullYear() === year && t.getMonth() === monthIndex && t.getDate() === day;
              })();
              const cellKey = `${employee.id}|${iso}`;
              const isChanged = editMode && editedCells?.has(cellKey);

              // In edit mode, use effective (merged) data
              const effective = editMode ? getEffectiveDay(iso) : null;

              // Base row background
              let rowBg: string | undefined;
              if (isHoliday) rowBg = HOLIDAY_BG;
              else if (isWeekend) rowBg = WEEKEND_BG;

              // Employee global status (KRANK, URLAUB etc.) — full-row override
              const statusCode = EMP_STATUS_MAP[employee.status ?? ""] ?? null;
              if (employee.status && employee.status !== "ACTIVE" && statusCode) {
                const sc = STATUS_COLORS[statusCode] ?? STATUS_COLORS.X;
                return (
                  <TableRow key={iso} sx={{ bgcolor: sc.bg, ...(isToday && { borderLeft: `3px solid ${theme.palette.primary.main}` }) }}>
                    <TableCell sx={{ fontWeight: isToday ? 700 : 500 }}>{day}.</TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ color: isWeekend ? theme.palette.error.main : "text.secondary", fontWeight: isWeekend ? 600 : 400 }}>
                        {weekday}
                      </Typography>
                    </TableCell>
                    <TableCell colSpan={3}>
                      <Typography variant="body2" sx={{ color: sc.color, fontWeight: 600 }}>{statusCode}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color="text.disabled">—</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color="text.disabled">—</Typography>
                    </TableCell>
                  </TableRow>
                );
              }

              const dayAssignments = assignmentsByDate.get(iso) ?? [];

              // Check for assignment-level absence status (K/U from generation)
              const absAssignment = !editMode && dayAssignments.find(a => a.dayStatus && ABSENCE_STATUS_CODES.has(a.dayStatus));
              if (absAssignment) {
                const sc = STATUS_COLORS[absAssignment.dayStatus!] ?? STATUS_COLORS.X;
                return (
                  <TableRow key={iso} sx={{ bgcolor: sc.bg, ...(isToday && { borderLeft: `3px solid ${theme.palette.primary.main}` }) }}>
                    <TableCell sx={{ fontWeight: isToday ? 700 : 500 }}>{day}.</TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ color: isWeekend || isHoliday ? theme.palette.error.main : "text.secondary", fontWeight: isWeekend || isHoliday ? 600 : 400 }}>
                        {weekday}
                      </Typography>
                    </TableCell>
                    <Tooltip title={STATUS_LABEL_MAP[absAssignment.dayStatus!] ?? absAssignment.dayStatus} arrow>
                      <TableCell colSpan={3}>
                        <Typography variant="body2" sx={{ color: sc.color, fontWeight: 600 }}>{absAssignment.dayStatus}</Typography>
                      </TableCell>
                    </Tooltip>
                    <TableCell align="right">
                      <Typography variant="body2" color="text.disabled">—</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color="text.disabled">{fmtHours(runningTotals[dayIdx])}h</Typography>
                    </TableCell>
                  </TableRow>
                );
              }

              const isFreiWish = freiWishSet?.has(wishKey);
              const isShiftWish = shiftWishSet?.has(wishKey) && dayAssignments.length > 0;

              if (isFreiWish && !rowBg) rowBg = WISH_FREI_BG;
              if (isShiftWish && !rowBg) rowBg = WISH_SHIFT_BG;

              const isFree = dayAssignments.length === 0 && !(editMode && effective?.shiftProfileId);

              // --- EDIT MODE: day status set via edit ---
              if (editMode && effective?.dayStatus && !effective?.shiftProfileId) {
                const sc = STATUS_COLORS[effective.dayStatus] ?? STATUS_COLORS.X;
                return (
                  <TableRow
                    key={iso}
                    sx={{
                      bgcolor: sc.bg,
                      ...(isToday && { borderLeft: `3px solid ${theme.palette.primary.main}` }),
                      ...(isChanged && { outline: EDIT_CHANGED_BORDER, outlineOffset: -2 }),
                    }}
                  >
                    <TableCell sx={{ fontWeight: isToday ? 700 : 500 }}>{day}.</TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ color: isWeekend || isHoliday ? theme.palette.error.main : "text.secondary", fontWeight: isWeekend || isHoliday ? 600 : 400 }}>
                        {weekday}
                      </Typography>
                    </TableCell>
                    <TableCell colSpan={3}>
                      <Chip
                        label={effective.dayStatus}
                        size="small"
                        sx={{
                          bgcolor: sc.bg,
                          color: sc.color,
                          fontWeight: 600,
                          cursor: editMode ? "pointer" : "default",
                        }}
                        onClick={(ev) => editMode && openShiftMenu(ev as unknown as React.MouseEvent<HTMLElement>, iso)}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color="text.disabled">—</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color="text.disabled">{fmtHours(runningTotals[dayIdx])}h</Typography>
                    </TableCell>
                  </TableRow>
                );
              }

              // --- FREE DAY ---
              if (isFree) {
                return (
                  <Tooltip key={iso} title={holidayName ?? (isFreiWish ? "Frei-Wunsch" : "")} arrow disableHoverListener={!isHoliday && !isFreiWish}>
                    <TableRow
                      onClick={() => {
                        if (!editMode) onDayClick?.(dateObj);
                      }}
                      sx={{
                        cursor: !editMode && onDayClick ? "pointer" : "default",
                        bgcolor: rowBg,
                        ...(isToday && { borderLeft: `3px solid ${theme.palette.primary.main}` }),
                        ...(isHoliday && { borderLeft: `3px solid ${theme.palette.error.light}` }),
                        ...(isChanged && { outline: EDIT_CHANGED_BORDER, outlineOffset: -2 }),
                      }}
                    >
                      <TableCell sx={{ fontWeight: isToday ? 700 : 500, color: isHoliday ? theme.palette.error.main : undefined }}>
                        {day}.
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="caption"
                          sx={{
                            color: isWeekend || isHoliday ? theme.palette.error.main : "text.secondary",
                            fontWeight: isWeekend || isHoliday ? 600 : 400,
                          }}
                        >
                          {weekday}
                        </Typography>
                      </TableCell>
                      <TableCell colSpan={3}>
                        {editMode ? (
                          <Chip
                            icon={<AddCircleOutlineIcon sx={{ fontSize: 16 }} />}
                            label="Schicht zuweisen"
                            size="small"
                            variant="outlined"
                            sx={{ cursor: "pointer", borderStyle: "dashed", color: "text.secondary" }}
                            onClick={(ev) => openShiftMenu(ev as unknown as React.MouseEvent<HTMLElement>, iso)}
                          />
                        ) : (
                          <Typography
                            variant="body2"
                            sx={{
                              color: isFreiWish ? "#1565c0" : STATUS_COLORS.X.color,
                              fontStyle: isFreiWish ? "italic" : "normal",
                              fontSize: "0.8rem",
                              fontWeight: isFreiWish ? 600 : 500,
                            }}
                          >
                            {isFreiWish ? "Frei (Wunsch)" : "X"}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" color="text.disabled">—</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" color="text.disabled">
                          {fmtHours(runningTotals[dayIdx])}h
                        </Typography>
                      </TableCell>
                    </TableRow>
                  </Tooltip>
                );
              }

              // --- ASSIGNED DAY ---
              // In edit mode show only effective first assignment; in read mode show all
              const renderAssignments = editMode
                ? [{ ...((dayAssignments[0] as AssignmentJson | undefined) ?? { id: "__edit__", date: iso, shiftProfileId: effective!.shiftProfileId!, employeeId: employee.id, scheduleId: "" }), ...(effective ?? {}) }]
                : dayAssignments;

              return renderAssignments.map((a, aIdx) => {
                const profId = editMode ? (effective?.shiftProfileId ?? a.shiftProfileId) : a.shiftProfileId;
                const prof = profId ? profilesById[profId] : undefined;
                const accent = SHIFT_ACCENT[prof?.shiftType ?? ""] ?? theme.palette.grey[500];
                const hours = prof ? paidHours(prof) : 0;
                const rawStation = editMode ? (effective?.stationNumber ?? a.stationNumber) : a.stationNumber;
                const stationNum = rawStation ?? employee.mainStation ?? (employee.assignedStations?.length === 1 ? employee.assignedStations[0] : null);
                const isNight = prof?.shiftType === "NIGHT";
                const stColor = stationColorForAssignment(isNight ? null : stationNum, prof?.shiftType);
                const m2 = editMode ? effective?.markingRow2 : a.markingRow2;
                const m3 = editMode ? effective?.markingRow3 : a.markingRow3;

                return (
                  <Tooltip key={a.id ?? `${iso}-${aIdx}`} title={holidayName ?? (isShiftWish ? "Dienstwunsch" : "")} arrow disableHoverListener={!isHoliday && !isShiftWish}>
                    <TableRow
                      onClick={() => {
                        if (!editMode) onDayClick?.(dateObj);
                      }}
                      sx={{
                        cursor: !editMode && onDayClick ? "pointer" : "default",
                        bgcolor: rowBg,
                        ...(isToday && { borderLeft: `3px solid ${theme.palette.primary.main}` }),
                        ...(isHoliday && !isToday && { borderLeft: `3px solid ${theme.palette.error.light}` }),
                        ...(aIdx > 0 && { "& td": { borderTop: "none", pt: 0 } }),
                        ...(isChanged && { outline: EDIT_CHANGED_BORDER, outlineOffset: -2 }),
                      }}
                    >
                      {aIdx === 0 ? (
                        <>
                          <TableCell
                            rowSpan={renderAssignments.length}
                            sx={{
                              fontWeight: isToday ? 700 : 500,
                              verticalAlign: "top",
                              color: isHoliday ? theme.palette.error.main : undefined,
                            }}
                          >
                            {day}.
                          </TableCell>
                          <TableCell rowSpan={renderAssignments.length} sx={{ verticalAlign: "top" }}>
                            <Typography
                              variant="caption"
                              sx={{
                                color: isWeekend || isHoliday ? theme.palette.error.main : "text.secondary",
                                fontWeight: isWeekend || isHoliday ? 600 : 400,
                              }}
                            >
                              {weekday}
                            </Typography>
                          </TableCell>
                        </>
                      ) : null}

                      {/* Schicht cell with pills */}
                      <TableCell>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                          {/* Main shift pill */}
                          <Box
                            sx={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 0.5,
                              px: 1,
                              py: 0.25,
                              borderRadius: 1,
                              bgcolor: alpha(accent, 0.08),
                              borderLeft: `3px solid ${accent}`,
                              cursor: editMode ? "pointer" : "inherit",
                              "&:hover": editMode ? { bgcolor: alpha(accent, 0.16) } : undefined,
                            }}
                            onClick={(ev) => editMode && openShiftMenu(ev, iso)}
                          >
                            <Box sx={{ color: accent, display: "flex" }}>{shiftIcon(prof?.shiftType ?? "")}</Box>
                            <Typography variant="body2" fontWeight={600} sx={{ color: accent }}>
                              {prof?.name ?? "?"}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {prof ? shiftTypeLabel(prof.shiftType) : ""}
                            </Typography>
                          </Box>

                          {/* Marking pills */}
                          {m2 ? (
                            <Chip
                              label={m2}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: "0.65rem",
                                fontWeight: 600,
                                bgcolor: alpha(theme.palette.info.main, 0.08),
                                color: theme.palette.info.dark,
                                cursor: editMode ? "pointer" : "default",
                              }}
                              onClick={(ev) => editMode && openMarkingMenu(ev as unknown as React.MouseEvent<HTMLElement>, iso, "marking2")}
                              {...(editMode ? { onDelete: () => onCellChange?.(employee.id, iso, { markingRow2: null }) } : {})}
                              deleteIcon={editMode ? <CloseIcon sx={{ fontSize: 14 }} /> : undefined}
                            />
                          ) : editMode ? (
                            <Chip
                              icon={<AddCircleOutlineIcon sx={{ fontSize: 14 }} />}
                              label="M2"
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.6rem", borderStyle: "dashed", cursor: "pointer", opacity: 0.5 }}
                              onClick={(ev) => openMarkingMenu(ev as unknown as React.MouseEvent<HTMLElement>, iso, "marking2")}
                            />
                          ) : null}

                          {m3 ? (
                            <Chip
                              label={m3}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: "0.65rem",
                                fontWeight: 600,
                                bgcolor: alpha(theme.palette.secondary.main, 0.08),
                                color: theme.palette.secondary.dark,
                                cursor: editMode ? "pointer" : "default",
                              }}
                              onClick={(ev) => editMode && openMarkingMenu(ev as unknown as React.MouseEvent<HTMLElement>, iso, "marking3")}
                              {...(editMode ? { onDelete: () => onCellChange?.(employee.id, iso, { markingRow3: null }) } : {})}
                              deleteIcon={editMode ? <CloseIcon sx={{ fontSize: 14 }} /> : undefined}
                            />
                          ) : editMode ? (
                            <Chip
                              icon={<AddCircleOutlineIcon sx={{ fontSize: 14 }} />}
                              label="M3"
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.6rem", borderStyle: "dashed", cursor: "pointer", opacity: 0.5 }}
                              onClick={(ev) => openMarkingMenu(ev as unknown as React.MouseEvent<HTMLElement>, iso, "marking3")}
                            />
                          ) : null}

                          {/* Remove button in edit mode */}
                          {editMode && (
                            <IconButton
                              size="small"
                              sx={{ p: 0.25, ml: 0.5 }}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                onCellChange?.(employee.id, iso, { shiftProfileId: null, dayStatus: null, markingRow2: null, markingRow3: null });
                              }}
                            >
                              <RemoveCircleOutlineIcon sx={{ fontSize: 16, color: "text.disabled" }} />
                            </IconButton>
                          )}
                        </Box>
                      </TableCell>

                      {/* Station */}
                      <TableCell align="center">
                        <Box
                          onClick={(ev) => {
                            if (editMode && !isNight) openStationMenu(ev, iso);
                          }}
                          sx={{
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            bgcolor: stColor.light,
                            color: stColor.main,
                            fontWeight: 700,
                            fontSize: "0.85rem",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            border: `1.5px solid ${alpha(stColor.main, 0.3)}`,
                            cursor: editMode && !isNight ? "pointer" : "default",
                            "&:hover": editMode && !isNight ? { boxShadow: `0 0 0 2px ${alpha(stColor.main, 0.25)}` } : undefined,
                          }}
                        >
                          {isNight ? "N" : (stationNum ?? "–")}
                        </Box>
                      </TableCell>

                      {/* Uhrzeit */}
                      <TableCell align="center">
                        <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8rem" }}>
                          {prof ? `${prof.startTime}\u2013${prof.endTime}` : "—"}
                        </Typography>
                      </TableCell>

                      {/* Stunden */}
                      <TableCell align="right">
                        <Typography variant="body2" fontWeight={500} sx={{ color: accent }}>
                          {fmtHours(hours)}h
                        </Typography>
                      </TableCell>

                      {/* Kumulativ */}
                      {aIdx === 0 && (
                        <TableCell align="right" rowSpan={renderAssignments.length}>
                          <Typography variant="body2" color="text.secondary" fontWeight={500}>
                            {fmtHours(runningTotals[dayIdx])}h
                          </Typography>
                        </TableCell>
                      )}
                    </TableRow>
                  </Tooltip>
                );
              });
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* ── Shift / Status Menu ── */}
      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor && menuType === "shift"}
        onClose={() => setMenuAnchor(null)}
        slotProps={{ paper: { sx: { maxHeight: 400, minWidth: 200 } } }}
      >
        {Object.entries(profilesByType).map(([type, profiles]) => [
          <ListSubheader key={`hdr-${type}`} sx={{ lineHeight: "28px", fontWeight: 700 }}>
            {shiftTypeLabel(type)}
          </ListSubheader>,
          ...profiles.map((p) => (
            <MenuItem key={p.id} onClick={() => handleMenuSelect(p.id)} dense>
              <ListItemIcon sx={{ minWidth: 28 }}>
                {shiftIcon(p.shiftType)}
              </ListItemIcon>
              <ListItemText primary={p.name} secondary={`${p.startTime}–${p.endTime}`} />
            </MenuItem>
          )),
        ])}
        <Divider />
        <ListSubheader sx={{ lineHeight: "28px", fontWeight: 700 }}>Status</ListSubheader>
        {STATUS_CODES.map(({ code, label }) => (
          <MenuItem key={code} onClick={() => handleMenuSelect(code)} dense>
            <ListItemIcon sx={{ minWidth: 28 }}>
              <Box sx={{ width: 14, height: 14, borderRadius: "50%", bgcolor: STATUS_COLORS[code]?.bg, border: `1px solid ${STATUS_COLORS[code]?.color}` }} />
            </ListItemIcon>
            <ListItemText primary={`${code} – ${label}`} />
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => handleMenuSelect(null)} dense>
          <ListItemIcon sx={{ minWidth: 28 }}>
            <RemoveCircleOutlineIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText primary="Entfernen" sx={{ color: "error.main" }} />
        </MenuItem>
      </Menu>

      {/* ── Marking Menu ── */}
      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor && (menuType === "marking2" || menuType === "marking3")}
        onClose={() => setMenuAnchor(null)}
        slotProps={{ paper: { sx: { minWidth: 120 } } }}
      >
        {MARKING_CODES.map((code) => (
          <MenuItem key={code} onClick={() => handleMenuSelect(code)} dense>
            <ListItemText primary={code} />
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => handleMenuSelect(null)} dense>
          <ListItemIcon sx={{ minWidth: 28 }}>
            <RemoveCircleOutlineIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText primary="Entfernen" sx={{ color: "error.main" }} />
        </MenuItem>
      </Menu>

      {/* ── Station Menu ── */}
      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor && menuType === "station"}
        onClose={() => setMenuAnchor(null)}
        slotProps={{ paper: { sx: { minWidth: 140 } } }}
      >
        {[1, 2, 3].map((stn) => {
          const sc = STATION_COLORS[stn] ?? { main: "#78909c", light: "#eceff1" };
          return (
            <MenuItem key={stn} onClick={() => handleMenuSelect(String(stn))} dense>
              <ListItemIcon sx={{ minWidth: 32 }}>
                <Box
                  sx={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    bgcolor: sc.light,
                    color: sc.main,
                    fontWeight: 700,
                    fontSize: "0.75rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `1.5px solid ${alpha(sc.main, 0.3)}`,
                  }}
                >
                  {stn}
                </Box>
              </ListItemIcon>
              <ListItemText primary={`Station ${stn}`} />
            </MenuItem>
          );
        })}
      </Menu>
    </Box>
  );
}
