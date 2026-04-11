"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  alpha,
  Box,
  Chip,
  Divider,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import { localIsoFromParts } from "@/lib/schedule/monthSchedule";
import type { AssignmentJson, EmployeeJson, ShiftProfileJson, StaffingJson } from "@/lib/schedule/scheduleTypes";
import QualificationPills from "@/components/schedule/QualificationPills";
import { monthlyWorkingDaysWithHolidays, isWorkingDayIso } from "@/lib/holidays";

/* ──────────────────────── exported type ──────────────────────── */

export type CellEdit = {
  shiftProfileId?: string | null;
  dayStatus?: string | null;
  markingRow2?: string | null;
  markingRow3?: string | null;
  stationNumber?: number | null;
};

/* ──────────────────────── props ──────────────────────── */

interface MonthTableViewProps {
  year: number;
  monthIndex: number;
  assignments: AssignmentJson[];
  employees: EmployeeJson[];
  profilesById: Record<string, ShiftProfileJson>;
  onDayClick: (date: Date) => void;
  onEmployeeClick?: (employeeId: string) => void;
  shiftWishSet?: Set<string>;
  freiWishSet?: Set<string>;
  editMode?: boolean;
  editedCells?: Map<string, CellEdit>;
  onCellChange?: (employeeId: string, date: string, edit: Partial<CellEdit>) => void;
  shiftProfiles?: ShiftProfileJson[];
  onToggleWish?: (employeeId: string, date: string, type: "shift" | "frei") => void;
  holidayMap?: Map<string, string>;
  warningsByDay?: Record<string, string[]>;
  staffingRequirements?: StaffingJson[];
}

/* ──────────────────────── helpers ──────────────────────── */

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function paidHoursForShift(profile: ShiftProfileJson): number {
  const [sh, sm] = profile.startTime.split(":").map(Number);
  const [eh, em] = profile.endTime.split(":").map(Number);
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return Math.max(0, (endMin - startMin - profile.breakMinutes) / 60);
}

function formatHours(h: number): string {
  return h % 1 === 0 ? String(h) : h.toFixed(1);
}

const FULL_TIME_DAILY_HOURS = 8;
const ABSENCE_STATUS_CODES = new Set(["K", "U"]);

/* Station / night color palette (matches EmployeeView) */
const STATION_COLORS: Record<number, { main: string; light: string }> = {
  1: { main: "#1565c0", light: "#e3f2fd" },
  2: { main: "#2e7d32", light: "#e8f5e9" },
  3: { main: "#e65100", light: "#fff3e0" },
};
const NIGHT_COLOR = { main: "#7e57c2", light: "#ede7f6" };

function workingDaysInMonth(year: number, monthIndex: number): number {
  return monthlyWorkingDaysWithHolidays(year, monthIndex);
}

function monthlyTargetForMonth(
  employee: EmployeeJson,
  year: number,
  monthIndex: number,
): number | null {
  if (employee.targetHours == null) return null;
  const wd = workingDaysInMonth(year, monthIndex);
  if (employee.targetHoursPercent != null && employee.targetHoursPercent > 0) {
    return (employee.targetHoursPercent / 100) * FULL_TIME_DAILY_HOURS * wd;
  }
  if (employee.targetHoursPeriod === "WEEKLY") {
    return (employee.targetHours / 5) * wd;
  }
  const AVG_WORKING_DAYS_PER_MONTH = 21.75;
  return employee.targetHours * (wd / AVG_WORKING_DAYS_PER_MONTH);
}

/* ──────────────────────── constants ──────────────────────── */

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  U: { bg: "#e3f2fd", color: "#1565c0" },
  K: { bg: "#ffebee", color: "#c62828" },
  LZ: { bg: "#fce4ec", color: "#ad1457" },
  MS: { bg: "#f3e5f5", color: "#7b1fa2" },
  KU: { bg: "#fff3e0", color: "#e65100" },
  SCH: { bg: "#e8eaf6", color: "#283593" },
  X: { bg: "#f5f5f5", color: "#9e9e9e" },
};

const WISH_SHIFT_BG = "#e8f5e9";
const WISH_FREI_BG = "#e3f2fd";
const EDIT_CHANGED_BORDER = "2px dashed #ff9800";
const SELECTED_BORDER = "2px solid #1976d2";
const SELECTED_BG = "rgba(25, 118, 210, 0.08)";
const ROW_HEIGHT = 56;
const NAME_COL_WIDTH = 300;

const MARKING_CODES = ["FO", "PA", "E", "BD"] as const;

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

const SHIFT_TYPE_ORDER = ["EARLY", "LATE", "NIGHT"];
const SHIFT_TYPE_LABELS: Record<string, string> = {
  EARLY: "Früh",
  LATE: "Spät",
  NIGHT: "Nacht",
};

const EMP_STATUS_MAP: Record<string, string> = {
  KRANK: "K",
  LANGZEITKRANK: "LZ",
  MUTTERSCHUTZ: "MS",
  URLAUB: "U",
  KUR: "KU",
};

/* ──────────────────────── grouping / sorting ──────────────────────── */

function groupEmployeesByStation(
  employees: EmployeeJson[],
  _assignments: AssignmentJson[],
): Record<number, EmployeeJson[]> {
  const grouped: Record<number, EmployeeJson[]> = { 1: [], 2: [], 3: [] };

  for (const emp of employees) {
    const main = emp.mainStation;
    if (main != null && main >= 1 && main <= 3) {
      // Employee appears only in their main station table
      grouped[main]!.push(emp);
    }
    // Employees without mainStation don't appear in any station table
    // (they go to "Nicht eingeplant" unless night-only)
  }
  return grouped;
}

function getNightEmployees(
  employees: EmployeeJson[],
  assignments: AssignmentJson[],
  profilesById: Record<string, ShiftProfileJson>,
): EmployeeJson[] {
  const nightEmpIds = new Set<string>();
  for (const a of assignments) {
    const profile = profilesById[a.shiftProfileId];
    if (profile?.shiftType === "NIGHT") {
      nightEmpIds.add(a.employeeId);
    }
  }
  return employees.filter((e) => nightEmpIds.has(e.id));
}

/** Best (lowest) qualification sortOrder for an employee; 9999 if none. */
function bestQualSortOrder(emp: EmployeeJson): number {
  if (!emp.qualifications || emp.qualifications.length === 0) return 9999;
  return Math.min(...emp.qualifications.map((q) => q.sortOrder));
}

function sortEmployees(emps: EmployeeJson[]): EmployeeJson[] {
  return [...emps].sort((a, b) => {
    const qa = bestQualSortOrder(a);
    const qb = bestQualSortOrder(b);
    if (qa !== qb) return qa - qb;
    const ln = a.lastName.localeCompare(b.lastName, "de");
    return ln !== 0 ? ln : a.firstName.localeCompare(b.firstName, "de");
  });
}

/* ──────────────────────── cell display ──────────────────────── */

type CellDisplay = {
  row1: string;
  row2: string;
  row3: string;
  isStatus: boolean;
  statusCode?: string;
  /** Night indicator: shows "N" circle in full cell */
  crossIndicator?: { label: string; main: string; light: string };
  /** Cross-station badge: split cell — left badge + right shift info */
  crossStationBadge?: { label: string; main: string; light: string };
};

function getCellDisplay(
  empId: string,
  iso: string,
  byEmpDay: Map<string, AssignmentJson>,
  editedCells: Map<string, CellEdit> | undefined,
  profilesById: Record<string, ShiftProfileJson>,
  employeesById: Record<string, EmployeeJson>,
): CellDisplay {
  const emp = employeesById[empId];
  if (emp?.status && emp.status !== "ACTIVE" && EMP_STATUS_MAP[emp.status]) {
    const code = EMP_STATUS_MAP[emp.status]!;
    return { row1: code, row2: "", row3: "", isStatus: true, statusCode: code };
  }

  const key = `${empId}|${iso}`;
  const edit = editedCells?.get(key);

  if (edit?.dayStatus) {
    return {
      row1: edit.dayStatus,
      row2: edit.markingRow2 ?? "",
      row3: edit.markingRow3 ?? "",
      isStatus: true,
      statusCode: edit.dayStatus,
    };
  }

  const assignment = byEmpDay.get(key);
  if (assignment) {
    const effectiveProfileId =
      edit?.shiftProfileId !== undefined
        ? edit.shiftProfileId
        : assignment.shiftProfileId;
    const profileName = effectiveProfileId
      ? (profilesById[effectiveProfileId]?.name ?? "?")
      : "X";

    if (assignment.dayStatus) {
      return {
        row1: assignment.dayStatus,
        row2:
          edit?.markingRow2 !== undefined
            ? (edit.markingRow2 ?? "")
            : (assignment.markingRow2 ?? ""),
        row3:
          edit?.markingRow3 !== undefined
            ? (edit.markingRow3 ?? "")
            : (assignment.markingRow3 ?? ""),
        isStatus: true,
        statusCode: assignment.dayStatus,
      };
    }

    return {
      row1: profileName,
      row2:
        edit?.markingRow2 !== undefined
          ? (edit.markingRow2 ?? "")
          : (assignment.markingRow2 ?? ""),
      row3:
        edit?.markingRow3 !== undefined
          ? (edit.markingRow3 ?? "")
          : (assignment.markingRow3 ?? ""),
      isStatus: !effectiveProfileId,
      statusCode: effectiveProfileId ? undefined : "X",
    };
  }

  if (edit?.shiftProfileId) {
    return {
      row1: profilesById[edit.shiftProfileId]?.name ?? "?",
      row2: edit.markingRow2 ?? "",
      row3: edit.markingRow3 ?? "",
      isStatus: false,
    };
  }

  return { row1: "X", row2: "", row3: "", isStatus: true, statusCode: "X" };
}

/* ══════════════════════════════════════════════════════════════ */
/*                        COMPONENT                              */
/* ══════════════════════════════════════════════════════════════ */

export default function MonthTableView({
  year,
  monthIndex,
  assignments,
  employees,
  profilesById,
  onDayClick,
  onEmployeeClick,
  shiftWishSet,
  freiWishSet,
  editMode,
  editedCells,
  onCellChange,
  shiftProfiles,
  onToggleWish,
  holidayMap,
  warningsByDay,
  staffingRequirements,
}: MonthTableViewProps) {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuCell, setMenuCell] = useState<{ empId: string; iso: string } | null>(null);
  const [menuRow, setMenuRow] = useState<1 | 2 | 3>(1);
  const [ctxAnchor, setCtxAnchor] = useState<{
    el: HTMLElement;
    empId: string;
    iso: string;
  } | null>(null);

  /* ── Multi-cell selection state ── */
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [lastClickedCell, setLastClickedCell] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workDays = workingDaysInMonth(year, monthIndex);

  const dayCols = useMemo(() => {
    const d = daysInMonth(year, monthIndex);
    return Array.from({ length: d }, (_, i) =>
      localIsoFromParts(year, monthIndex, i + 1),
    );
  }, [year, monthIndex]);

  const byEmpDay = useMemo(() => {
    const m = new Map<string, AssignmentJson>();
    for (const a of assignments) m.set(`${a.employeeId}|${a.date}`, a);
    return m;
  }, [assignments]);

  const employeesById = useMemo(
    () => Object.fromEntries(employees.map((e) => [e.id, e])),
    [employees],
  );

  const stationGroups = useMemo(
    () => groupEmployeesByStation(employees, assignments),
    [employees, assignments],
  );

  const nightEmployees = useMemo(
    () => getNightEmployees(employees, assignments, profilesById),
    [employees, assignments, profilesById],
  );

  const profilesByType = useMemo(() => {
    const grouped = new Map<string, ShiftProfileJson[]>();
    for (const p of shiftProfiles ?? []) {
      const arr = grouped.get(p.shiftType) ?? [];
      arr.push(p);
      grouped.set(p.shiftType, arr);
    }
    return grouped;
  }, [shiftProfiles]);

  // Count K/U absence WORKING days per employee (exclude weekends + holidays)
  const empAbsenceWorkDays = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assignments) {
      if (a.dayStatus && ABSENCE_STATUS_CODES.has(a.dayStatus) && isWorkingDayIso(a.date)) {
        counts.set(a.employeeId, (counts.get(a.employeeId) ?? 0) + 1);
      }
    }
    return counts;
  }, [assignments]);

  const empPlannedHours = useMemo(() => {
    const hours = new Map<string, number>();
    const editedKeys = new Set<string>();

    if (editMode && editedCells) {
      for (const [key, edit] of editedCells) {
        editedKeys.add(key);
        if (edit.dayStatus) continue;
        const eid = key.split("|")[0]!;
        let pid: string | null = null;
        if (edit.shiftProfileId !== undefined) {
          pid = edit.shiftProfileId ?? null;
        } else {
          const assignment = byEmpDay.get(key);
          if (assignment && !assignment.dayStatus) pid = assignment.shiftProfileId;
        }
        if (pid) {
          const p = profilesById[pid];
          if (p) hours.set(eid, (hours.get(eid) ?? 0) + paidHoursForShift(p));
        }
      }
    }

    for (const a of assignments) {
      const key = `${a.employeeId}|${a.date}`;
      if (editedKeys.has(key)) continue;
      if (a.dayStatus) continue;
      const p = profilesById[a.shiftProfileId];
      if (!p) continue;
      hours.set(a.employeeId, (hours.get(a.employeeId) ?? 0) + paidHoursForShift(p));
    }

    return hours;
  }, [assignments, editMode, editedCells, byEmpDay, profilesById]);

  /* ── Live staffing counters (edit mode) ── */
  const liveStaffing = useMemo(() => {
    if (!editMode || !staffingRequirements?.length) return null;
    // Build effective shift type per emp+date considering edits
    const effectiveShift = (empId: string, iso: string): { shiftType: string; stationNumbers: number[] } | null => {
      const key = `${empId}|${iso}`;
      const edit = editedCells?.get(key);
      if (edit?.dayStatus) return null; // status = not a real shift
      const assignment = byEmpDay.get(key);
      let pid: string | null = null;
      if (edit?.shiftProfileId !== undefined) {
        pid = edit.shiftProfileId ?? null;
      } else if (assignment && !assignment.dayStatus) {
        pid = assignment.shiftProfileId;
      }
      if (!pid) return null;
      const profile = profilesById[pid];
      if (!profile) return null;
      const emp = employeesById[empId];
      const stNum = edit?.stationNumber ?? assignment?.stationNumber ?? emp?.mainStation;
      return { shiftType: profile.shiftType, stationNumbers: stNum != null ? [stNum] : (emp?.assignedStations ?? []) };
    };

    // Count per iso -> shiftType -> station
    const counts = new Map<string, Map<string, Map<number, number>>>();
    for (const iso of dayCols) {
      const byType = new Map<string, Map<number, number>>();
      counts.set(iso, byType);
      for (const emp of employees) {
        const s = effectiveShift(emp.id, iso);
        if (!s) continue;
        let byStation = byType.get(s.shiftType);
        if (!byStation) { byStation = new Map(); byType.set(s.shiftType, byStation); }
        for (const st of s.stationNumbers) {
          byStation.set(st, (byStation.get(st) ?? 0) + 1);
        }
        // Count facility-wide (station 0)
        byStation.set(0, (byStation.get(0) ?? 0) + 1);
      }
    }
    return counts;
  }, [editMode, staffingRequirements, editedCells, byEmpDay, profilesById, employeesById, dayCols, employees]);

  /* ── Selection helpers ── */
  const allEmployeeIds = useMemo(() => employees.map(e => e.id), [employees]);

  const getCellsBetween = useCallback((cellA: string, cellB: string): string[] => {
    const [empA, isoA] = cellA.split("|");
    const [empB, isoB] = cellB.split("|");
    const idxA = allEmployeeIds.indexOf(empA!);
    const idxB = allEmployeeIds.indexOf(empB!);
    const dayA = dayCols.indexOf(isoA!);
    const dayB = dayCols.indexOf(isoB!);
    const minEmp = Math.min(idxA, idxB);
    const maxEmp = Math.max(idxA, idxB);
    const minDay = Math.min(dayA, dayB);
    const maxDay = Math.max(dayA, dayB);
    const cells: string[] = [];
    for (let e = minEmp; e <= maxEmp; e++) {
      for (let d = minDay; d <= maxDay; d++) {
        cells.push(`${allEmployeeIds[e]}|${dayCols[d]}`);
      }
    }
    return cells;
  }, [allEmployeeIds, dayCols]);

  const handleCellClick = useCallback((empId: string, iso: string, ev: React.MouseEvent) => {
    if (!editMode) return;
    const key = `${empId}|${iso}`;

    // Modifier keys fire immediately (no double-click ambiguity)
    if (ev.shiftKey && lastClickedCell) {
      if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
      const range = getCellsBetween(lastClickedCell, key);
      setSelectedCells(new Set(range));
      return;
    }

    if (ev.ctrlKey || ev.metaKey) {
      if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
      setSelectedCells(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
      setLastClickedCell(key);
      return;
    }

    // Plain click: debounce to distinguish from double-click
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      if (selectedCells.size === 1 && selectedCells.has(key)) {
        setSelectedCells(new Set());
        setLastClickedCell(null);
      } else {
        setSelectedCells(new Set([key]));
        setLastClickedCell(key);
      }
    }, 200);
  }, [editMode, lastClickedCell, selectedCells, getCellsBetween]);

  const handleCellMouseDown = useCallback((empId: string, iso: string, ev: React.MouseEvent) => {
    if (!editMode || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.button !== 0) return;
    dragStartRef.current = `${empId}|${iso}`;
    setIsDragging(false);
  }, [editMode]);

  const handleCellMouseEnter = useCallback((empId: string, iso: string) => {
    if (!editMode || !dragStartRef.current) return;
    setIsDragging(true);
    const range = getCellsBetween(dragStartRef.current, `${empId}|${iso}`);
    setSelectedCells(new Set(range));
  }, [editMode, getCellsBetween]);

  const handleMouseUp = useCallback(() => {
    dragStartRef.current = null;
    setIsDragging(false);
  }, []);

  const applyToSelected = useCallback((edit: Partial<CellEdit>) => {
    if (!onCellChange) return;
    for (const key of selectedCells) {
      const [eid, date] = key.split("|");
      onCellChange(eid!, date!, edit);
    }
    setSelectedCells(new Set());
    setLastClickedCell(null);
  }, [selectedCells, onCellChange]);

  /* ──── menu helpers ──── */

  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuCell(null);
  };
  const closeCtx = () => setCtxAnchor(null);

  /* ──── section renderer ──── */

  type SectionFilter = "none" | "night-only" | { station: number };

  const renderSection = (
    title: string,
    sectionEmployees: EmployeeJson[],
    filter: SectionFilter = "none",
  ) => {
    // Filter: for station sections, keep employees who have any assignment (they are already
    // grouped by mainStation). Exclude completely unassigned (they appear in "Nicht eingeplant").
    let filtered = sectionEmployees;
    const assignedEmpIds = new Set(assignments.map((a) => a.employeeId));
    const hasEdits = editMode && editedCells && editedCells.size > 0;
    if (typeof filter === "object" && "station" in filter) {
      // In edit mode, show all employees in their station (even without assignments yet)
      if (!editMode) {
        filtered = sectionEmployees.filter((emp) => assignedEmpIds.has(emp.id));
      }
    } else if (filter === "night-only") {
      // Already filtered by getNightEmployees
      // In edit mode on empty schedule, skip night section (no assignments to detect night from)
      if (editMode && assignments.length === 0 && !hasEdits) return null;
    }
    if (filtered.length === 0) return null;
    const sorted = sortEmployees(filtered);

    const sectionBg =
      filter === "night-only"
        ? NIGHT_COLOR.light
        : typeof filter === "object" && "station" in filter
          ? STATION_COLORS[filter.station]?.light ?? "grey.100"
          : "grey.100";

    return (
      <Box key={title} sx={{ mb: 2 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell
                sx={{
                  width: NAME_COL_WIDTH,
                  minWidth: NAME_COL_WIDTH,
                  maxWidth: NAME_COL_WIDTH,
                  fontWeight: 700,
                  position: "sticky",
                  left: 0,
                  zIndex: 3,
                  bgcolor: sectionBg,
                  fontSize: "0.875rem",
                }}
              >
                {title}
              </TableCell>
              <TableCell
                align="center"
                sx={{
                  minWidth: 72,
                  fontWeight: 600,
                  position: "sticky",
                  left: NAME_COL_WIDTH,
                  zIndex: 3,
                  bgcolor: sectionBg,
                  borderRight: 1,
                  borderColor: "divider",
                }}
              >
                <Tooltip title="Geplante Stunden / Soll-Stunden" arrow>
                  <span>Std</span>
                </Tooltip>
              </TableCell>
              {dayCols.map((iso) => {
                const [y, m, d] = iso.split("-").map(Number);
                const wd = new Date(y!, m! - 1, d!).toLocaleDateString("de-DE", {
                  weekday: "short",
                });
                const hName = holidayMap?.get(iso);
                const dayWarnings = warningsByDay?.[iso];
                const hasWarning = dayWarnings && dayWarnings.length > 0;

                // Live staffing counters for this day + station section
                let staffingLabel: React.ReactNode = null;
                if (editMode && liveStaffing && typeof filter === "object" && "station" in filter) {
                  const dayData = liveStaffing.get(iso);
                  const stationNum = filter.station;
                  // Show EARLY+LATE counts for the station
                  const earlyCount = dayData?.get("EARLY")?.get(stationNum) ?? 0;
                  const lateCount = dayData?.get("LATE")?.get(stationNum) ?? 0;
                  const earlyReq = staffingRequirements?.find(s => s.shiftType === "EARLY" && s.stationNumber === stationNum && !s.isFacilityWide);
                  const lateReq = staffingRequirements?.find(s => s.shiftType === "LATE" && s.stationNumber === stationNum && !s.isFacilityWide);
                  const earlyMin = earlyReq?.minTotalCount ?? 0;
                  const lateMin = lateReq?.minTotalCount ?? 0;
                  staffingLabel = (
                    <Box sx={{ display: "flex", gap: 0.3, justifyContent: "center", mt: "1px" }}>
                      <Typography variant="caption" sx={{
                        fontSize: 9, fontWeight: 700, lineHeight: 1,
                        color: earlyCount >= earlyMin ? "success.main" : "error.main",
                      }}>
                        F{earlyCount}
                      </Typography>
                      <Typography variant="caption" sx={{
                        fontSize: 9, fontWeight: 700, lineHeight: 1,
                        color: lateCount >= lateMin ? "success.main" : "error.main",
                      }}>
                        S{lateCount}
                      </Typography>
                    </Box>
                  );
                } else if (editMode && liveStaffing && filter === "night-only") {
                  const dayData = liveStaffing.get(iso);
                  const nightCount = dayData?.get("NIGHT")?.get(0) ?? 0; // facility-wide
                  const nightReq = staffingRequirements?.find(s => s.shiftType === "NIGHT" && s.isFacilityWide);
                  const nightMin = nightReq?.minTotalCount ?? 0;
                  staffingLabel = (
                    <Typography variant="caption" sx={{
                      fontSize: 9, fontWeight: 700, lineHeight: 1, mt: "1px",
                      color: nightCount >= nightMin ? "success.main" : "error.main",
                    }}>
                      N{nightCount}
                    </Typography>
                  );
                }

                const inner = (
                  <>
                    <Typography variant="caption" display="block" color="text.secondary">
                      {wd}
                    </Typography>
                    {d}
                    {staffingLabel}
                    {hasWarning && (
                      <WarningAmberIcon
                        sx={{
                          display: "block",
                          mx: "auto",
                          fontSize: 14,
                          color: "#ed6c02",
                          mt: "1px",
                        }}
                      />
                    )}
                  </>
                );

                const tooltipLines: string[] = [];
                if (hName) tooltipLines.push(hName);
                if (hasWarning) tooltipLines.push(...dayWarnings);

                return (
                  <TableCell
                    key={iso}
                    align="center"
                    sx={{
                      minWidth: 52,
                      fontWeight: 600,
                      cursor: "pointer",
                      zIndex: 2,
                      bgcolor: hName ? "#fff0f0" : sectionBg,
                      "&:hover": { bgcolor: hName ? "#ffe0e0" : "action.hover" },
                    }}
                    onClick={() => onDayClick(new Date(y!, m! - 1, d!))}
                  >
                    {tooltipLines.length > 0 ? (
                      <Tooltip
                        title={
                          <Box sx={{ whiteSpace: "pre-line", fontSize: 12 }}>
                            {tooltipLines.map((line, i) => (
                              <Box
                                key={i}
                                sx={i === 0 && hName ? { fontWeight: 600, mb: 0.5 } : undefined}
                              >
                                {i > 0 && !hName ? "" : ""}{line}
                              </Box>
                            ))}
                          </Box>
                        }
                        arrow
                      >
                        <Box>{inner}</Box>
                      </Tooltip>
                    ) : (
                      inner
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>

          <TableBody>
            {sorted.map((emp) => {
              const basePlanned = empPlannedHours.get(emp.id) ?? 0;
              const target = monthlyTargetForMonth(emp, year, monthIndex);
              const tags = emp.qualificationTags ?? [];
              const contractPct = emp.targetHoursPercent ?? 100;
              const absWorkDays = empAbsenceWorkDays.get(emp.id) ?? 0;
              const absenceHours = absWorkDays * 8 * (contractPct / 100);
              const planned = basePlanned + absenceHours;

              let hoursColor: string;
              if (target == null) {
                hoursColor = "text.secondary";
              } else if (planned >= target - 4 && planned <= target + 8) {
                hoursColor = "success.main";
              } else if (planned > target + 8 && planned <= target + 16) {
                hoursColor = "warning.main";
              } else {
                hoursColor = "error.main";
              }

              return (
                <TableRow key={emp.id} hover>
                  {/* ── employee name ── */}
                  <TableCell
                    sx={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      width: NAME_COL_WIDTH,
                      minWidth: NAME_COL_WIDTH,
                      maxWidth: NAME_COL_WIDTH,
                      position: "sticky",
                      left: 0,
                      bgcolor: "background.paper",
                      zIndex: 1,
                      borderBottom: "2px solid",
                      borderBottomColor: "grey.400",
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <Box
                        component="span"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onEmployeeClick?.(emp.id);
                        }}
                        sx={{
                          cursor: onEmployeeClick ? "pointer" : "default",
                          "&:hover": onEmployeeClick
                            ? { textDecoration: "underline", color: "primary.main" }
                            : undefined,
                        }}
                      >
                        {emp.lastName}, {emp.firstName} ({contractPct}%)
                      </Box>
                      <QualificationPills
                        qualifications={emp.qualifications}
                        tags={tags}
                        compact
                      />
                    </Box>
                  </TableCell>

                  {/* ── hours ── */}
                  <TableCell
                    align="center"
                    sx={{
                      position: "sticky",
                      left: NAME_COL_WIDTH,
                      bgcolor: "background.paper",
                      zIndex: 1,
                      borderRight: "2px solid",
                      borderRightColor: "grey.400",
                      borderBottom: "2px solid",
                      borderBottomColor: "grey.400",
                      whiteSpace: "nowrap",
                      fontSize: 11,
                    }}
                  >
                    <Tooltip
                      title={
                        target != null
                          ? `Geplant: ${formatHours(planned)} h / Soll: ${formatHours(target)} h (${contractPct}% × ${workDays} AT × ${FULL_TIME_DAILY_HOURS} h)`
                          : `Geplant: ${formatHours(planned)} h (kein Soll hinterlegt)`
                      }
                      arrow
                    >
                      <Box sx={{ lineHeight: 1.2 }}>
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{ color: hoursColor, fontWeight: 600 }}
                        >
                          {formatHours(planned)}
                          {target != null ? `/${formatHours(target)}` : ""}
                        </Typography>
                        {target != null && (
                          <Typography
                            display="block"
                            variant="caption"
                            sx={{
                              color: hoursColor,
                              fontSize: 9,
                              fontWeight: 500,
                              lineHeight: 1,
                            }}
                          >
                            ({planned - target >= 0 ? "+" : ""}{formatHours(planned - target)}h)
                          </Typography>
                        )}
                      </Box>
                    </Tooltip>
                  </TableCell>

                  {/* ── day cells ── */}
                  {dayCols.map((iso) => {
                    const cellKey = `${emp.id}|${iso}`;
                    let display = getCellDisplay(
                      emp.id,
                      iso,
                      byEmpDay,
                      editedCells,
                      profilesById,
                      employeesById,
                    );

                    if (filter !== "none" && !display.isStatus) {
                      const asgn = byEmpDay.get(cellKey);
                      const edit = editedCells?.get(cellKey);

                      // Resolve effective shift profile (edit overrides assignment)
                      const effectivePid = edit?.shiftProfileId !== undefined
                        ? edit.shiftProfileId
                        : asgn?.shiftProfileId ?? null;
                      const effectiveProf = effectivePid ? profilesById[effectivePid] : null;

                      if (effectiveProf || asgn) {
                        const prof = effectiveProf ?? (asgn ? profilesById[asgn.shiftProfileId] : null);
                        if (filter === "night-only") {
                          if (prof?.shiftType !== "NIGHT") {
                            display = { row1: "X", row2: "", row3: "", isStatus: true, statusCode: "X" };
                          }
                        } else if (typeof filter === "object" && "station" in filter) {
                          if (prof?.shiftType === "NIGHT") {
                            // Night shift — show "N" circle (full cell, no division)
                            display = {
                              row1: "", row2: "", row3: "", isStatus: false,
                              crossIndicator: { label: "N", ...NIGHT_COLOR },
                            };
                          } else {
                            // Resolve effective station: edit > assignment > employee default
                            const effectiveStation = (edit?.stationNumber !== undefined ? edit.stationNumber : null)
                              ?? asgn?.stationNumber
                              ?? emp.mainStation
                              ?? (emp.assignedStations?.length === 1 ? emp.assignedStations[0] : null);
                            if (effectiveStation != null && effectiveStation !== filter.station) {
                              // Different station — split cell: left badge + right shift info
                              const stColor = STATION_COLORS[effectiveStation] ?? { main: "#78909c", light: "#eceff1" };
                              display = {
                                ...display,
                                crossStationBadge: { label: String(effectiveStation), ...stColor },
                              };
                            }
                          }
                        }
                      }
                    }

                    const isShiftWish =
                      shiftWishSet?.has(cellKey) && !display.isStatus;
                    const isFreiWish = freiWishSet?.has(cellKey);
                    const isChanged = editMode && editedCells?.has(cellKey);
                    const isSelected = editMode && selectedCells.has(cellKey);
                    const statusStyle =
                      display.isStatus && display.statusCode
                        ? STATUS_COLORS[display.statusCode]
                        : null;

                    let cellBg: string | undefined;
                    let cellColor: string | undefined;
                    if (isSelected) {
                      cellBg = SELECTED_BG;
                    } else if (statusStyle) {
                      cellBg = statusStyle.bg;
                      cellColor = statusStyle.color;
                    } else if (isShiftWish) {
                      cellBg = WISH_SHIFT_BG;
                    } else if (isFreiWish) {
                      cellBg = WISH_FREI_BG;
                    }

                    const displayRow1 =
                      isFreiWish && display.row1 === "X"
                        ? "Frei"
                        : display.row1;

                    return (
                      <Tooltip
                        key={iso}
                        title={
                          display.isStatus && display.statusCode
                            ? STATUS_LABEL_MAP[display.statusCode] ?? display.statusCode
                            : isShiftWish
                              ? "Dienstwunsch"
                              : isFreiWish
                                ? "Frei-Wunsch"
                                : ""
                        }
                        arrow
                        disableHoverListener={
                          !isShiftWish && !isFreiWish && !display.isStatus
                        }
                      >
                        <TableCell
                          align="center"
                          data-cell-key={cellKey}
                          onClick={(ev) => {
                            if (!editMode) {
                              const [y, m, d] = iso.split("-").map(Number);
                              onDayClick(new Date(y!, m! - 1, d!));
                            } else {
                              // Single click = select cell (for toolbar operations)
                              handleCellClick(emp.id, iso, ev);
                            }
                          }}
                          onDoubleClick={(ev) => {
                            if (!editMode) return;
                            ev.stopPropagation();
                            // Cancel pending single-click selection
                            if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
                            // Double-click = open single-cell detail menu
                            setSelectedCells(new Set());
                            setLastClickedCell(null);
                            setMenuCell({ empId: emp.id, iso });
                            setMenuRow(1);
                            setMenuAnchor(ev.currentTarget as HTMLElement);
                          }}
                          onMouseDown={(ev) => handleCellMouseDown(emp.id, iso, ev)}
                          onMouseEnter={() => handleCellMouseEnter(emp.id, iso)}
                          onContextMenu={(ev) => {
                            if (editMode && onToggleWish) {
                              ev.preventDefault();
                              setCtxAnchor({
                                el: ev.currentTarget,
                                empId: emp.id,
                                iso,
                              });
                            }
                          }}
                          sx={{
                            p: 0,
                            height: ROW_HEIGHT,
                            minWidth: 52,
                            cursor: "pointer",
                            bgcolor: cellBg,
                            color: cellColor,
                            borderRight: "1px solid",
                            borderRightColor: "divider",
                            borderBottom: "2px solid",
                            borderBottomColor: "grey.400",
                            userSelect: editMode ? "none" : undefined,
                            "&:hover": { opacity: 0.85 },
                            ...(isShiftWish && { fontWeight: 700 }),
                            ...(isFreiWish && { fontStyle: "italic" }),
                            ...(isSelected && { border: SELECTED_BORDER }),
                            ...(isChanged && !isSelected && { border: EDIT_CHANGED_BORDER }),
                          }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              flexDirection: display.crossStationBadge ? "row" : "column",
                              height: "100%",
                              width: "100%",
                            }}
                          >
                            {display.crossIndicator ? (
                              /* Night indicator — full cell circle */
                              <Tooltip title={display.crossIndicator.label === "N" ? "Nachtschicht" : `Station ${display.crossIndicator.label}`} arrow>
                                <Box sx={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  height: "100%",
                                  width: "100%",
                                }}>
                                  <Box sx={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: "50%",
                                    bgcolor: display.crossIndicator.light,
                                    color: display.crossIndicator.main,
                                    border: `1.5px solid ${alpha(display.crossIndicator.main, 0.3)}`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 11,
                                    fontWeight: 700,
                                    lineHeight: 1,
                                  }}>
                                    {display.crossIndicator.label}
                                  </Box>
                                </Box>
                              </Tooltip>
                            ) : display.crossStationBadge ? (
                              /* Cross-station — split cell: left badge | right shift info */
                              <>
                                <Tooltip title={`Station ${display.crossStationBadge.label}`} arrow>
                                  <Box sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: 26,
                                    minWidth: 26,
                                    borderRight: "1px solid",
                                    borderColor: "grey.200",
                                  }}>
                                    <Box sx={{
                                      width: 20,
                                      height: 20,
                                      borderRadius: "50%",
                                      bgcolor: display.crossStationBadge.light,
                                      color: display.crossStationBadge.main,
                                      border: `1.5px solid ${alpha(display.crossStationBadge.main, 0.3)}`,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: 10,
                                      fontWeight: 700,
                                      lineHeight: 1,
                                    }}>
                                      {display.crossStationBadge.label}
                                    </Box>
                                  </Box>
                                </Tooltip>
                                <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                                  <Box sx={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    lineHeight: 1.2,
                                    textAlign: "center",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flex: 1,
                                    borderBottom: "1px solid",
                                    borderColor: "grey.200",
                                  }}>
                                    {displayRow1}
                                  </Box>
                                  <Box sx={{
                                    fontSize: "0.6rem",
                                    lineHeight: 1.1,
                                    color: cellColor ?? "text.secondary",
                                    textAlign: "center",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flex: 1,
                                    borderBottom: "1px solid",
                                    borderColor: "grey.200",
                                  }}>
                                    {display.row2 || "\u00A0"}
                                  </Box>
                                  <Box sx={{
                                    fontSize: "0.6rem",
                                    lineHeight: 1.1,
                                    color: cellColor ?? "text.secondary",
                                    textAlign: "center",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flex: 1,
                                  }}>
                                    {display.row3 || "\u00A0"}
                                  </Box>
                                </Box>
                              </>
                            ) : (
                            <>
                            {/* Row 1 – shift profile / status */}
                            <Box
                              sx={{
                                fontSize: 12,
                                fontWeight: 600,
                                lineHeight: 1.3,
                                cursor: editMode ? "pointer" : "inherit",
                                width: "100%",
                                textAlign: "center",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flex: 1,
                                borderBottom: "1px solid",
                                borderColor: "grey.200",
                                "&:hover": editMode
                                  ? { bgcolor: "action.hover" }
                                  : undefined,
                              }}
                            >
                              {displayRow1}
                            </Box>

                            {/* Row 2 – marking */}
                            <Box
                              sx={{
                                fontSize: "0.65rem",
                                lineHeight: 1.2,
                                color: cellColor ?? "text.secondary",
                                cursor: editMode ? "pointer" : "inherit",
                                width: "100%",
                                textAlign: "center",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flex: 1,
                                borderBottom: "1px solid",
                                borderColor: "grey.200",
                                "&:hover": editMode
                                  ? { bgcolor: "action.hover" }
                                  : undefined,
                              }}
                            >
                              {display.row2 || "\u00A0"}
                            </Box>

                            {/* Row 3 – marking */}
                            <Box
                              sx={{
                                fontSize: "0.65rem",
                                lineHeight: 1.2,
                                color: cellColor ?? "text.secondary",
                                cursor: editMode ? "pointer" : "inherit",
                                width: "100%",
                                textAlign: "center",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flex: 1,
                                "&:hover": editMode
                                  ? { bgcolor: "action.hover" }
                                  : undefined,
                              }}
                            >
                              {display.row3 || "\u00A0"}
                            </Box>
                            </>
                            )}
                          </Box>
                        </TableCell>
                      </Tooltip>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
    );
  };

  const unassignedEmployees = useMemo(() => {
    const assignedIds = new Set(assignments.map((a) => a.employeeId));
    // Also exclude employees who appear in station tables (have mainStation) or night table
    const nightEmpIds = new Set<string>();
    for (const a of assignments) {
      const prof = profilesById[a.shiftProfileId];
      if (prof?.shiftType === "NIGHT") nightEmpIds.add(a.employeeId);
    }
    return employees.filter((e) => {
      // Has assignments → already in station/night table
      if (assignedIds.has(e.id)) {
        // If no mainStation but only night assignments → in night table, not unassigned
        if (e.mainStation == null) {
          // Check if all their assignments are night-only
          const hasNonNight = assignments.some((a) => {
            if (a.employeeId !== e.id) return false;
            const prof = profilesById[a.shiftProfileId];
            return prof?.shiftType !== "NIGHT";
          });
          if (!hasNonNight && nightEmpIds.has(e.id)) return false; // night-only, shown in night table
        }
        return false;
      }
      return true;
    });
  }, [employees, assignments, profilesById]);

  const renderUnassignedSection = () => {
    if (unassignedEmployees.length === 0) return null;
    const sorted = sortEmployees(unassignedEmployees);
    return (
      <Box sx={{ mb: 2 }}>
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 700,
            px: 2,
            py: 1,
            bgcolor: "warning.50",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          Nicht eingeplant ({sorted.length})
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, minWidth: 200 }}>Mitarbeiter</TableCell>
              <TableCell sx={{ fontWeight: 600, minWidth: 120 }}>Grund</TableCell>
              <TableCell sx={{ fontWeight: 600, minWidth: 80 }} align="center">Soll</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((emp) => {
              let reason: string;
              if (emp.status === "INACTIVE") {
                reason = "Inaktiv";
              } else if (emp.contractType === "AUSBILDUNG") {
                reason = "Ausbildung";
              } else if (emp.status === "KRANK") {
                reason = "Krank (ganzer Monat)";
              } else if (emp.status === "LANGZEITKRANK") {
                reason = "Langzeitkrank";
              } else if (emp.status === "MUTTERSCHUTZ") {
                reason = "Mutterschutz";
              } else if (emp.status === "URLAUB") {
                reason = "Urlaub (ganzer Monat)";
              } else if (emp.status === "KUR") {
                reason = "Kur";
              } else if (emp.mainStation == null) {
                reason = "Keine Hauptstation zugewiesen";
              } else {
                reason = "Keine passenden Schichten";
              }
              const target = monthlyTargetForMonth(emp, year, monthIndex);
              return (
                <TableRow key={emp.id} hover>
                  <TableCell>
                    <Box
                      component="span"
                      onClick={() => onEmployeeClick?.(emp.id)}
                      sx={{
                        cursor: onEmployeeClick ? "pointer" : "default",
                        "&:hover": onEmployeeClick
                          ? { textDecoration: "underline", color: "primary.main" }
                          : undefined,
                      }}
                    >
                      {emp.lastName}, {emp.firstName}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {reason}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Typography variant="body2" color="text.secondary">
                      {target != null ? `${formatHours(target)} h` : "–"}
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
    );
  };

  /* ──── render ──── */

  return (
    <Box
      ref={containerRef}
      onMouseUp={handleMouseUp}
      sx={{
        maxHeight: "70vh",
        overflow: "auto",
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        position: "relative",
      }}
    >
      {assignments.length === 0 && !editMode ? (
        renderSection("Mitarbeiter", employees, "none")
      ) : (
        <>
          {renderSection("Station 1", stationGroups[1]!, { station: 1 })}
          {renderSection("Station 2", stationGroups[2]!, { station: 2 })}
          {renderSection("Station 3", stationGroups[3]!, { station: 3 })}
          {renderSection("Nacht (gesamtes Gebäude)", nightEmployees, "night-only")}
          {renderUnassignedSection()}
        </>
      )}

      {/* ── Left-click menu (Row 1: profiles + status | Row 2/3: markings) ── */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor) && Boolean(menuCell)}
        onClose={closeMenu}
        slotProps={{ paper: { sx: { maxHeight: 400 } } }}
      >
        {menuRow === 1
          ? [
              <ListSubheader key="hdr-profiles" sx={{ lineHeight: "32px" }}>
                Schichtprofile
              </ListSubheader>,

              ...SHIFT_TYPE_ORDER.flatMap((type) => {
                const profiles = profilesByType.get(type);
                if (!profiles?.length) return [];
                return [
                  <ListSubheader
                    key={`type-${type}`}
                    sx={{ lineHeight: "28px", fontSize: 12 }}
                  >
                    {SHIFT_TYPE_LABELS[type] ?? type}
                  </ListSubheader>,
                  ...profiles.map((p) => (
                    <MenuItem
                      key={p.id}
                      dense
                      sx={{ pl: 4 }}
                      onClick={() => {
                        if (menuCell && onCellChange)
                          onCellChange(menuCell.empId, menuCell.iso, {
                            shiftProfileId: p.id,
                            dayStatus: null,
                          });
                        closeMenu();
                      }}
                    >
                      {p.name}
                    </MenuItem>
                  )),
                ];
              }),

              <Divider key="div-status" />,

              <ListSubheader key="hdr-status" sx={{ lineHeight: "32px" }}>
                Status
              </ListSubheader>,

              ...STATUS_CODES.map(({ code, label }) => (
                <MenuItem
                  key={`st-${code}`}
                  dense
                  onClick={() => {
                    if (menuCell && onCellChange)
                      onCellChange(menuCell.empId, menuCell.iso, {
                        dayStatus: code,
                      });
                    closeMenu();
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      display: "inline-block",
                      width: 28,
                      height: 20,
                      lineHeight: "20px",
                      textAlign: "center",
                      borderRadius: 0.5,
                      fontSize: 11,
                      fontWeight: 700,
                      mr: 1,
                      bgcolor: STATUS_COLORS[code]?.bg,
                      color: STATUS_COLORS[code]?.color,
                    }}
                  >
                    {code}
                  </Box>
                  {label}
                </MenuItem>
              )),

              <Divider key="div-station" />,

              <ListSubheader key="hdr-station" sx={{ lineHeight: "32px" }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <LocationOnIcon sx={{ fontSize: 16 }} />
                  Station zuweisen
                </Box>
              </ListSubheader>,

              ...[1, 2, 3].map((sNum) => (
                <MenuItem
                  key={`station-${sNum}`}
                  dense
                  sx={{ pl: 4 }}
                  onClick={() => {
                    if (menuCell && onCellChange)
                      onCellChange(menuCell.empId, menuCell.iso, {
                        stationNumber: sNum,
                      });
                    closeMenu();
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      width: 20, height: 20, borderRadius: "50%",
                      bgcolor: STATION_COLORS[sNum]?.light, color: STATION_COLORS[sNum]?.main,
                      border: `1.5px solid ${STATION_COLORS[sNum]?.main}`,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700, mr: 1,
                    }}
                  >{sNum}</Box>
                  Station {sNum}
                </MenuItem>
              )),

              <MenuItem
                key="station-clear"
                dense
                sx={{ pl: 4 }}
                onClick={() => {
                  if (menuCell && onCellChange)
                    onCellChange(menuCell.empId, menuCell.iso, {
                      stationNumber: null,
                    });
                  closeMenu();
                }}
              >
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
                  Hauptstation verwenden
                </Typography>
              </MenuItem>,

              <Divider key="div-remove" />,

              <MenuItem
                key="remove"
                dense
                onClick={() => {
                  if (menuCell && onCellChange)
                    onCellChange(menuCell.empId, menuCell.iso, {
                      shiftProfileId: null,
                      dayStatus: null,
                    });
                  closeMenu();
                }}
              >
                <ListItemIcon>
                  <RemoveCircleOutlineIcon fontSize="small" color="error" />
                </ListItemIcon>
                <ListItemText>Entfernen</ListItemText>
              </MenuItem>,
            ]
          : [
              ...MARKING_CODES.map((code) => (
                <MenuItem
                  key={code}
                  dense
                  onClick={() => {
                    if (menuCell && onCellChange)
                      onCellChange(menuCell.empId, menuCell.iso, {
                        [menuRow === 2 ? "markingRow2" : "markingRow3"]: code,
                      });
                    closeMenu();
                  }}
                >
                  {code}
                </MenuItem>
              )),

              <Divider key="div-rm" />,

              <MenuItem
                key="remove-marking"
                dense
                onClick={() => {
                  if (menuCell && onCellChange)
                    onCellChange(menuCell.empId, menuCell.iso, {
                      [menuRow === 2 ? "markingRow2" : "markingRow3"]: null,
                    });
                  closeMenu();
                }}
              >
                <ListItemIcon>
                  <RemoveCircleOutlineIcon fontSize="small" color="error" />
                </ListItemIcon>
                <ListItemText>Entfernen</ListItemText>
              </MenuItem>,
            ]}
      </Menu>

      {/* ── Right-click context menu (wish toggling) ── */}
      <Menu
        anchorEl={ctxAnchor?.el ?? null}
        open={Boolean(ctxAnchor)}
        onClose={closeCtx}
      >
        <MenuItem
          dense
          onClick={() => {
            if (ctxAnchor && onToggleWish)
              onToggleWish(ctxAnchor.empId, ctxAnchor.iso, "shift");
            closeCtx();
          }}
        >
          {ctxAnchor &&
          shiftWishSet?.has(`${ctxAnchor.empId}|${ctxAnchor.iso}`)
            ? "Dienstwunsch entfernen"
            : "Als Dienstwunsch markieren"}
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            if (ctxAnchor && onToggleWish)
              onToggleWish(ctxAnchor.empId, ctxAnchor.iso, "frei");
            closeCtx();
          }}
        >
          {ctxAnchor &&
          freiWishSet?.has(`${ctxAnchor.empId}|${ctxAnchor.iso}`)
            ? "Frei-Wunsch entfernen"
            : "Als Frei-Wunsch markieren"}
        </MenuItem>
      </Menu>

      {/* ── Floating toolbar (visible when cells are selected) ── */}
      {editMode && selectedCells.size > 0 && (
        <Paper
          elevation={6}
          sx={{
            position: "sticky",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 2,
            py: 1.5,
            bgcolor: "background.paper",
            borderTop: "2px solid",
            borderColor: "primary.main",
            flexWrap: "wrap",
          }}
        >
          <Chip
            size="small"
            label={`${selectedCells.size} Zellen`}
            color="primary"
            variant="outlined"
            sx={{ fontWeight: 700, mr: 1 }}
          />

          {/* Shift profile buttons grouped by type */}
          {SHIFT_TYPE_ORDER.map((type) => {
            const profiles = profilesByType.get(type);
            if (!profiles?.length) return null;
            return (
              <Box key={type} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600, fontSize: 10, mr: 0.5 }}>
                  {SHIFT_TYPE_LABELS[type]}
                </Typography>
                {profiles.map((p) => (
                  <Chip
                    key={p.id}
                    size="small"
                    label={p.name}
                    onClick={() => applyToSelected({ shiftProfileId: p.id, dayStatus: null })}
                    sx={{
                      cursor: "pointer",
                      fontSize: 11,
                      height: 26,
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  />
                ))}
              </Box>
            );
          })}

          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

          {/* Status code buttons */}
          {STATUS_CODES.map(({ code, label }) => (
            <Chip
              key={code}
              size="small"
              label={code}
              title={label}
              onClick={() => applyToSelected({ dayStatus: code })}
              sx={{
                cursor: "pointer",
                fontSize: 11,
                height: 26,
                bgcolor: STATUS_COLORS[code]?.bg,
                color: STATUS_COLORS[code]?.color,
                fontWeight: 700,
                "&:hover": { opacity: 0.8 },
              }}
            />
          ))}

          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

          {/* Station override buttons */}
          {[1, 2, 3].map((sNum) => (
            <Chip
              key={`st-${sNum}`}
              size="small"
              label={`St${sNum}`}
              title={`Station ${sNum}`}
              onClick={() => applyToSelected({ stationNumber: sNum })}
              sx={{
                cursor: "pointer",
                fontSize: 11,
                height: 26,
                bgcolor: STATION_COLORS[sNum]?.light,
                color: STATION_COLORS[sNum]?.main,
                fontWeight: 700,
                border: `1px solid ${STATION_COLORS[sNum]?.main}`,
                "&:hover": { opacity: 0.8 },
              }}
            />
          ))}

          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

          {/* Remove / clear button */}
          <Chip
            size="small"
            label="Entfernen"
            icon={<RemoveCircleOutlineIcon sx={{ fontSize: 16 }} />}
            onClick={() => applyToSelected({ shiftProfileId: null, dayStatus: null })}
            color="error"
            variant="outlined"
            sx={{ cursor: "pointer", fontSize: 11, height: 26 }}
          />

          {/* Deselect button */}
          <Chip
            size="small"
            label="Abwählen"
            onClick={() => { setSelectedCells(new Set()); setLastClickedCell(null); }}
            variant="outlined"
            sx={{ cursor: "pointer", fontSize: 11, height: 26, ml: "auto" }}
          />
        </Paper>
      )}
    </Box>
  );
}
