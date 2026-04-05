"use client";

import { useMemo } from "react";
import {
  Box,
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
} from "@mui/material";
import type { AssignmentJson, EmployeeJson, ShiftProfileJson } from "@/lib/schedule/scheduleTypes";
import { weekLocalIsoDays } from "@/lib/schedule/monthSchedule";
import QualificationPills from "@/components/schedule/QualificationPills";

interface WeekViewProps {
  weekStartDate: Date;
  assignments: AssignmentJson[];
  employees: EmployeeJson[];
  profilesById: Record<string, ShiftProfileJson>;
  onDayClick: (date: Date) => void;
  onEmployeeClick?: (employeeId: string) => void;
  shiftWishSet?: Set<string>;
  freiWishSet?: Set<string>;
}

const WISH_SHIFT_BG = "#e8f5e9";
const WISH_FREI_BG = "#e3f2fd";
const NAME_COL_WIDTH = 280;

const EMP_STATUS_MAP: Record<string, string> = {
  KRANK: "K", LANGZEITKRANK: "LZ", MUTTERSCHUTZ: "MS", URLAUB: "U", KUR: "KU",
};

const STATUS_LABEL_MAP: Record<string, string> = {
  K: "Krank", U: "Urlaub", LZ: "Langzeitkrank", MS: "Mutterschutz", KU: "Kur", SCH: "Schule",
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  U: { bg: "#e3f2fd", color: "#1565c0" },
  K: { bg: "#ffebee", color: "#c62828" },
  LZ: { bg: "#fce4ec", color: "#ad1457" },
  MS: { bg: "#f3e5f5", color: "#7b1fa2" },
  KU: { bg: "#fff3e0", color: "#e65100" },
  X: { bg: "#f5f5f5", color: "#9e9e9e" },
};

const SECTION_COLORS: Record<string, string> = {
  "Station 1": "#1565c0",
  "Station 2": "#2e7d32",
  "Station 3": "#e65100",
  "Nacht": "#7e57c2",
};

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

function sortEmployees(emps: EmployeeJson[]): EmployeeJson[] {
  return [...emps].sort((a, b) => {
    const ln = a.lastName.localeCompare(b.lastName, "de");
    return ln !== 0 ? ln : a.firstName.localeCompare(b.firstName, "de");
  });
}

export default function WeekView({
  weekStartDate,
  assignments,
  employees,
  profilesById,
  onDayClick,
  onEmployeeClick,
  shiftWishSet,
  freiWishSet,
}: WeekViewProps) {
  const theme = useTheme();
  const dayIsos = weekLocalIsoDays(weekStartDate);

  const byEmpDay = useMemo(() => {
    const m = new Map<string, AssignmentJson>();
    for (const a of assignments) m.set(`${a.employeeId}|${a.date}`, a);
    return m;
  }, [assignments]);

  // Group employees by station + night
  const { stationGroups, nightEmployees } = useMemo(() => {
    const groups: Record<number, Set<string>> = { 1: new Set(), 2: new Set(), 3: new Set() };
    const nightIds = new Set<string>();

    for (const a of assignments) {
      const prof = profilesById[a.shiftProfileId];
      if (!prof) continue;
      if (prof.shiftType === "NIGHT") {
        nightIds.add(a.employeeId);
        continue;
      }
      const emp = employees.find((e) => e.id === a.employeeId);
      const station = a.stationNumber ?? emp?.mainStation ?? (emp?.assignedStations?.length === 1 ? emp.assignedStations[0] : null);
      if (station && groups[station]) {
        groups[station]!.add(a.employeeId);
      }
    }

    const empById = Object.fromEntries(employees.map((e) => [e.id, e]));
    const stationEmployees: Record<number, EmployeeJson[]> = {};
    for (const [st, ids] of Object.entries(groups)) {
      stationEmployees[Number(st)] = [...ids]
        .map((id) => empById[id])
        .filter((e): e is EmployeeJson => !!e);
    }

    return {
      stationGroups: stationEmployees,
      nightEmployees: [...nightIds]
        .map((id) => empById[id])
        .filter((e): e is EmployeeJson => !!e),
    };
  }, [assignments, employees, profilesById]);

  const renderSection = (title: string, sectionEmployees: EmployeeJson[], filterType: "station" | "night") => {
    if (sectionEmployees.length === 0) return null;
    const sorted = sortEmployees(sectionEmployees);
    const accentColor = SECTION_COLORS[title] ?? theme.palette.primary.main;

    return (
      <Box sx={{ mb: 2 }}>
        <TableContainer
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            overflow: "hidden",
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    fontWeight: 700,
                    width: NAME_COL_WIDTH,
                    minWidth: NAME_COL_WIDTH,
                    maxWidth: NAME_COL_WIDTH,
                    bgcolor: alpha(accentColor, 0.08),
                    borderBottom: `2px solid ${accentColor}`,
                    fontSize: "0.875rem",
                  }}
                >
                  {title}
                </TableCell>
                {dayIsos.map((iso) => {
                  const [y, m, d] = iso.split("-").map(Number);
                  const dayDate = new Date(y, m - 1, d);
                  const wd = dayDate.toLocaleDateString("de-DE", { weekday: "short" });
                  const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;
                  return (
                    <TableCell
                      key={iso}
                      align="center"
                      sx={{
                        cursor: "pointer",
                        fontWeight: 600,
                        bgcolor: isWeekend ? alpha(accentColor, 0.04) : undefined,
                        borderBottom: `2px solid ${accentColor}`,
                        "&:hover": { bgcolor: alpha(accentColor, 0.12) },
                      }}
                      onClick={() => onDayClick(new Date(y, m - 1, d))}
                    >
                      <Typography variant="caption" display="block" color="text.secondary" fontWeight={600}>
                        {wd}
                      </Typography>
                      {d}.{m}.
                    </TableCell>
                  );
                })}
                <TableCell
                  align="center"
                  sx={{
                    fontWeight: 600,
                    borderBottom: `2px solid ${accentColor}`,
                    minWidth: 50,
                  }}
                >
                  Std
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((e) => {
                const tags = e.qualificationTags ?? [];
                return (
                  <TableRow key={e.id} hover>
                    <TableCell
                      sx={{
                        width: NAME_COL_WIDTH,
                        minWidth: NAME_COL_WIDTH,
                        maxWidth: NAME_COL_WIDTH,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        <Box
                          component="span"
                          onClick={(ev: React.MouseEvent) => {
                            ev.stopPropagation();
                            onEmployeeClick?.(e.id);
                          }}
                          sx={{
                            cursor: onEmployeeClick ? "pointer" : "default",
                            "&:hover": onEmployeeClick
                              ? { textDecoration: "underline", color: "primary.main" }
                              : undefined,
                          }}
                        >
                          {e.lastName}, {e.firstName} ({e.targetHoursPercent ?? 100}%)
                        </Box>
                        <QualificationPills qualifications={e.qualifications} tags={tags} compact />
                      </Box>
                    </TableCell>
                    {dayIsos.map((iso) => {
                      const key = `${e.id}|${iso}`;
                      const a = byEmpDay.get(key);
                      const prof = a ? profilesById[a.shiftProfileId] : undefined;
                      const [y, m, d] = iso.split("-").map(Number);
                      const isShiftWish = shiftWishSet?.has(key) && !!a;
                      const isFreiWish = freiWishSet?.has(key);
                      const statusCode = e.status && e.status !== "ACTIVE"
                        ? (EMP_STATUS_MAP[e.status] ?? e.status)
                        : null;

                      // For station sections, only show non-NIGHT shifts
                      let showShift = true;
                      if (filterType === "station" && prof?.shiftType === "NIGHT") showShift = false;
                      if (filterType === "night" && prof && prof.shiftType !== "NIGHT") showShift = false;

                      let cellText: string;
                      let cellStyle: Record<string, string> | undefined;
                      if (statusCode) {
                        cellText = statusCode;
                        cellStyle = STATUS_COLORS[statusCode];
                      } else if (prof && showShift) {
                        cellText = prof.name;
                      } else if (isFreiWish) {
                        cellText = "Frei";
                      } else {
                        cellText = "";
                      }

                      const dayDate = new Date(y, m - 1, d);
                      const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;

                      const tooltipTitle = statusCode
                        ? (STATUS_LABEL_MAP[statusCode] ?? statusCode)
                        : isShiftWish ? "Dienstwunsch" : isFreiWish ? "Frei-Wunsch" : "";

                      return (
                        <Tooltip key={iso} title={tooltipTitle} arrow disableHoverListener={!tooltipTitle}>
                        <TableCell
                          align="center"
                          onClick={() => onDayClick(dayDate)}
                          sx={{
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: cellText && cellText !== "" ? 600 : 400,
                            maxWidth: 140,
                            bgcolor: isWeekend && !cellStyle?.bg ? "grey.50" : undefined,
                            "&:hover": { bgcolor: "action.hover" },
                            ...(isShiftWish && !statusCode && {
                              bgcolor: WISH_SHIFT_BG,
                              fontWeight: 700,
                            }),
                            ...(isFreiWish && !statusCode && {
                              bgcolor: WISH_FREI_BG,
                              fontStyle: "italic",
                            }),
                            ...(cellStyle && {
                              bgcolor: cellStyle.bg,
                              color: cellStyle.color,
                            }),
                          }}
                        >
                          {cellText}
                        </TableCell>
                        </Tooltip>
                      );
                    })}
                    <TableCell align="center" sx={{ fontSize: 12, fontWeight: 600 }}>
                      {formatHours(dayIsos.reduce((sum, iso) => {
                        const a = byEmpDay.get(`${e.id}|${iso}`);
                        const p = a ? profilesById[a.shiftProfileId] : undefined;
                        if (!p) return sum;
                        if (filterType === "station" && p.shiftType === "NIGHT") return sum;
                        if (filterType === "night" && p.shiftType !== "NIGHT") return sum;
                        return sum + paidHoursForShift(p);
                      }, 0))}h
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  };

  return (
    <Box>
      {renderSection("Station 1", stationGroups[1] ?? [], "station")}
      {renderSection("Station 2", stationGroups[2] ?? [], "station")}
      {renderSection("Station 3", stationGroups[3] ?? [], "station")}
      {renderSection("Nacht", nightEmployees, "night")}
    </Box>
  );
}
