"use client";

import { useMemo, useState } from "react";
import {
  Box,
  Divider,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import { localIsoFromParts } from "@/lib/schedule/monthSchedule";
import type { AssignmentJson, EmployeeJson, ShiftProfileJson } from "@/lib/schedule/scheduleTypes";
import QualificationPills from "@/components/schedule/QualificationPills";
import { monthlyWorkingDaysWithHolidays, absenceDailyHours } from "@/lib/holidays";

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
  assignments: AssignmentJson[],
): Record<number, EmployeeJson[]> {
  const grouped: Record<number, EmployeeJson[]> = { 1: [], 2: [], 3: [] };
  const added = new Set<string>();

  // Build set of stations each employee actually has assignments on
  const empAssignmentStations = new Map<string, Set<number>>();
  for (const a of assignments) {
    if (a.stationNumber != null && a.stationNumber >= 1 && a.stationNumber <= 3) {
      let s = empAssignmentStations.get(a.employeeId);
      if (!s) { s = new Set(); empAssignmentStations.set(a.employeeId, s); }
      s.add(a.stationNumber);
    }
  }

  for (const emp of employees) {
    const stations = new Set(emp.assignedStations ?? []);
    // Also include stations from actual assignments (e.g. Dienstwunsch on different station)
    const fromAssignments = empAssignmentStations.get(emp.id);
    if (fromAssignments) for (const st of fromAssignments) stations.add(st);

    if (stations.size > 0) {
      for (const st of stations) {
        if (st >= 1 && st <= 3 && !added.has(`${emp.id}-${st}`)) {
          grouped[st]!.push(emp);
          added.add(`${emp.id}-${st}`);
        }
      }
    } else {
      for (const st of [1, 2, 3]) {
        if (!added.has(`${emp.id}-${st}`)) {
          grouped[st]!.push(emp);
          added.add(`${emp.id}-${st}`);
        }
      }
    }
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

function sortEmployees(emps: EmployeeJson[]): EmployeeJson[] {
  return [...emps].sort((a, b) => {
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
}: MonthTableViewProps) {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuCell, setMenuCell] = useState<{ empId: string; iso: string } | null>(null);
  const [menuRow, setMenuRow] = useState<1 | 2 | 3>(1);
  const [ctxAnchor, setCtxAnchor] = useState<{
    el: HTMLElement;
    empId: string;
    iso: string;
  } | null>(null);

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

  // Count K/U absence days per employee (for Soll reduction)
  const empAbsenceDays = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assignments) {
      if (a.dayStatus && ABSENCE_STATUS_CODES.has(a.dayStatus)) {
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
    // Filter out employees who have no shifts at this station
    // Also exclude employees that are completely unassigned (they appear in "Nicht eingeplant")
    let filtered = sectionEmployees;
    const assignedEmpIds = new Set(assignments.map((a) => a.employeeId));
    if (typeof filter === "object" && "station" in filter) {
      const stationNum = filter.station;
      filtered = sectionEmployees.filter((emp) => {
        // Exclude completely unassigned employees — they belong in "Nicht eingeplant"
        if (!assignedEmpIds.has(emp.id)) return false;
        // Keep employees who have at least one non-night assignment at this station
        for (const a of assignments) {
          if (a.employeeId !== emp.id) continue;
          const prof = profilesById[a.shiftProfileId];
          if (prof?.shiftType === "NIGHT") continue; // nights are separate
          const assignedStation = a.stationNumber ?? (emp.assignedStations?.length === 1 ? emp.assignedStations[0] : null);
          if (assignedStation === stationNum) return true;
        }
        return false;
      });
    } else if (filter === "night-only") {
      // Already filtered by getNightEmployees
    }
    if (filtered.length === 0) return null;
    const sorted = sortEmployees(filtered);

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
                  bgcolor: "grey.100",
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
                  bgcolor: "background.paper",
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
                const inner = (
                  <>
                    <Typography variant="caption" display="block" color="text.secondary">
                      {wd}
                    </Typography>
                    {d}
                  </>
                );
                return (
                  <TableCell
                    key={iso}
                    align="center"
                    sx={{
                      minWidth: 52,
                      fontWeight: 600,
                      cursor: "pointer",
                      "&:hover": { bgcolor: "action.hover" },
                      ...(hName ? { bgcolor: "#fff0f0" } : {}),
                    }}
                    onClick={() => onDayClick(new Date(y!, m! - 1, d!))}
                  >
                    {hName ? (
                      <Tooltip title={hName} arrow>
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
              const planned = empPlannedHours.get(emp.id) ?? 0;
              const rawTarget = monthlyTargetForMonth(emp, year, monthIndex);
              const absDays = empAbsenceDays.get(emp.id) ?? 0;
              const calendarDays = new Date(year, monthIndex + 1, 0).getDate();
              const target = rawTarget != null ? rawTarget - absDays * absenceDailyHours(rawTarget, calendarDays) : null;
              const tags = emp.qualificationTags ?? [];
              const contractPct = emp.targetHoursPercent ?? 100;

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
                      borderRight: 1,
                      borderColor: "divider",
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
                      if (asgn) {
                        const prof = profilesById[asgn.shiftProfileId];
                        if (filter === "night-only") {
                          if (prof?.shiftType !== "NIGHT") {
                            display = { row1: "X", row2: "", row3: "", isStatus: true, statusCode: "X" };
                          }
                        } else if (typeof filter === "object" && "station" in filter) {
                          const asgnStation = asgn.stationNumber
                            ?? (emp.assignedStations?.length === 1 ? emp.assignedStations[0] : null);
                          if (asgnStation != null && asgnStation !== filter.station) {
                            display = { row1: "", row2: "", row3: "", isStatus: false, statusCode: "" };
                          }
                        }
                      }
                    }

                    const isShiftWish =
                      shiftWishSet?.has(cellKey) && !display.isStatus;
                    const isFreiWish = freiWishSet?.has(cellKey);
                    const isChanged = editMode && editedCells?.has(cellKey);
                    const statusStyle =
                      display.isStatus && display.statusCode
                        ? STATUS_COLORS[display.statusCode]
                        : null;

                    let cellBg: string | undefined;
                    let cellColor: string | undefined;
                    if (statusStyle) {
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
                          isShiftWish
                            ? "Dienstwunsch"
                            : isFreiWish
                              ? "Frei-Wunsch"
                              : ""
                        }
                        arrow
                        disableHoverListener={!isShiftWish && !isFreiWish}
                      >
                        <TableCell
                          align="center"
                          onClick={() => {
                            if (!editMode) {
                              const [y, m, d] = iso.split("-").map(Number);
                              onDayClick(new Date(y!, m! - 1, d!));
                            }
                          }}
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
                            "&:hover": { opacity: 0.85 },
                            ...(isShiftWish && { fontWeight: 700 }),
                            ...(isFreiWish && { fontStyle: "italic" }),
                            ...(isChanged && { border: EDIT_CHANGED_BORDER }),
                          }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              flexDirection: "column",
                              height: "100%",
                              width: "100%",
                            }}
                          >
                            {/* Row 1 – shift profile / status */}
                            <Box
                              onClick={(ev) => {
                                if (editMode) {
                                  ev.stopPropagation();
                                  setMenuCell({ empId: emp.id, iso });
                                  setMenuRow(1);
                                  setMenuAnchor(ev.currentTarget as HTMLElement);
                                }
                              }}
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
                                borderColor: "divider",
                                "&:hover": editMode
                                  ? { bgcolor: "action.hover" }
                                  : undefined,
                              }}
                            >
                              {displayRow1}
                            </Box>

                            {/* Row 2 – marking */}
                            <Box
                              onClick={(ev) => {
                                if (editMode) {
                                  ev.stopPropagation();
                                  setMenuCell({ empId: emp.id, iso });
                                  setMenuRow(2);
                                  setMenuAnchor(ev.currentTarget as HTMLElement);
                                }
                              }}
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
                                borderColor: "divider",
                                "&:hover": editMode
                                  ? { bgcolor: "action.hover" }
                                  : undefined,
                              }}
                            >
                              {display.row2 || "\u00A0"}
                            </Box>

                            {/* Row 3 – marking */}
                            <Box
                              onClick={(ev) => {
                                if (editMode) {
                                  ev.stopPropagation();
                                  setMenuCell({ empId: emp.id, iso });
                                  setMenuRow(3);
                                  setMenuAnchor(ev.currentTarget as HTMLElement);
                                }
                              }}
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
    return employees.filter((e) => !assignedIds.has(e.id));
  }, [employees, assignments]);

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
      sx={{
        maxHeight: "70vh",
        overflow: "auto",
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
      }}
    >
      {renderSection("Station 1", stationGroups[1]!, { station: 1 })}
      {renderSection("Station 2", stationGroups[2]!, { station: 2 })}
      {renderSection("Station 3", stationGroups[3]!, { station: 3 })}
      {renderSection("Nacht (gesamtes Gebäude)", nightEmployees, "night-only")}
      {renderUnassignedSection()}

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
    </Box>
  );
}
