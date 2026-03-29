"use client";

import { useMemo } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Avatar,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  alpha,
  useTheme,
} from "@mui/material";
import WbSunnyIcon from "@mui/icons-material/WbSunny";
import WbTwilightIcon from "@mui/icons-material/WbTwilight";
import NightsStayIcon from "@mui/icons-material/NightsStay";
import type { AssignmentJson, EmployeeJson, ShiftProfileJson } from "@/lib/schedule/scheduleTypes";
import { localIsoFromParts } from "@/lib/schedule/monthSchedule";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";
import QualificationPills from "@/components/schedule/QualificationPills";

interface EmployeeViewProps {
  year: number;
  monthIndex: number;
  employee: EmployeeJson;
  assignments: AssignmentJson[];
  profilesById: Record<string, ShiftProfileJson>;
  onDayClick?: (date: Date) => void;
}

const SHIFT_ACCENT: Record<string, string> = {
  EARLY: "#f59e0b",
  LATE: "#3b82f6",
  NIGHT: "#6366f1",
};

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

function fmtHours(h: number): string {
  return h % 1 === 0 ? String(h) : h.toFixed(1);
}

const WEEKDAYS_DE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export default function EmployeeView({
  year,
  monthIndex,
  employee,
  assignments,
  profilesById,
  onDayClick,
}: EmployeeViewProps) {
  const theme = useTheme();

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

  const { totalHours, workingDays } = useMemo(() => {
    let hours = 0;
    let wDays = 0;
    for (const [, dayAssignments] of assignmentsByDate) {
      wDays++;
      for (const a of dayAssignments) {
        const p = profilesById[a.shiftProfileId];
        if (p) hours += paidHours(p);
      }
    }
    return { totalHours: hours, workingDays: wDays };
  }, [assignmentsByDate, profilesById]);

  const FULL_TIME_DAILY = 8;
  const target = useMemo(() => {
    if (employee.targetHours == null) return null;
    const totalDays = new Date(year, monthIndex + 1, 0).getDate();
    let wd = 0;
    for (let d = 1; d <= totalDays; d++) {
      const dow = new Date(year, monthIndex, d).getDay();
      if (dow !== 0 && dow !== 6) wd++;
    }
    if (employee.targetHoursPercent != null && employee.targetHoursPercent > 0) {
      return (employee.targetHoursPercent / 100) * FULL_TIME_DAILY * wd;
    }
    if (employee.targetHoursPeriod === "WEEKLY") {
      return (employee.targetHours / 5) * wd;
    }
    const AVG_WD = 21.75;
    return employee.targetHours * (wd / AVG_WD);
  }, [employee.targetHours, employee.targetHoursPercent, employee.targetHoursPeriod, year, monthIndex]);
  const tags = employee.qualificationTags ?? [];
  const pct = target != null && target > 0 ? Math.round((totalHours / target) * 100) : null;

  let hoursColor: string;
  if (target == null) {
    hoursColor = theme.palette.text.secondary;
  } else if (totalHours > target * 1.05) {
    hoursColor = theme.palette.error.main;
  } else if (totalHours < target * 0.95) {
    hoursColor = theme.palette.warning.main;
  } else {
    hoursColor = theme.palette.success.main;
  }

  const initials = `${employee.firstName.charAt(0)}${employee.lastName.charAt(0)}`;

  return (
    <Box>
      {/* Employee header card */}
      <Card
        variant="outlined"
        sx={{ mb: 2, borderRadius: 2, overflow: "hidden" }}
      >
        <CardContent sx={{ py: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
            <Avatar
              sx={{
                width: 48,
                height: 48,
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                color: theme.palette.primary.main,
                fontWeight: 700,
                fontSize: 18,
              }}
            >
              {initials}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 180 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.3 }}>
                  {employee.firstName} {employee.lastName}
                </Typography>
                <QualificationPills tags={tags} />
              </Box>
              {employee.contractType && (
                <Typography variant="caption" color="text.secondary">
                  {employee.contractType}
                </Typography>
              )}
            </Box>
            <Box
              sx={{
                display: "flex",
                gap: 1.5,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <Chip
                label={`${workingDays} Arbeitstage`}
                size="small"
                variant="outlined"
              />
              <Chip
                label={
                  target != null
                    ? `${fmtHours(totalHours)} / ${fmtHours(target)} Std`
                    : `${fmtHours(totalHours)} Std`
                }
                size="small"
                sx={{
                  fontWeight: 600,
                  color: hoursColor,
                  borderColor: hoursColor,
                }}
                variant="outlined"
              />
              {pct != null && (
                <Chip
                  label={`${pct}%`}
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
        </CardContent>
      </Card>

      {/* Vertical calendar */}
      <TableContainer
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          maxHeight: "65vh",
        }}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell
                sx={{
                  fontWeight: 700,
                  width: 50,
                  bgcolor: "background.paper",
                }}
              >
                Tag
              </TableCell>
              <TableCell
                sx={{
                  fontWeight: 700,
                  width: 44,
                  bgcolor: "background.paper",
                }}
              >
                WT
              </TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: "background.paper" }}>
                Schicht
              </TableCell>
              <TableCell
                sx={{
                  fontWeight: 700,
                  width: 70,
                  bgcolor: "background.paper",
                }}
                align="center"
              >
                Station
              </TableCell>
              <TableCell
                sx={{
                  fontWeight: 700,
                  width: 110,
                  bgcolor: "background.paper",
                }}
                align="center"
              >
                Uhrzeit
              </TableCell>
              <TableCell
                sx={{
                  fontWeight: 700,
                  width: 70,
                  bgcolor: "background.paper",
                }}
                align="right"
              >
                Stunden
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {days.map(({ day, iso, dateObj, dow, weekday }) => {
              const dayAssignments = assignmentsByDate.get(iso) ?? [];
              const isWeekend = dow === 0 || dow === 6;
              const isFree = dayAssignments.length === 0;
              const isToday = (() => {
                const t = new Date();
                return (
                  t.getFullYear() === year &&
                  t.getMonth() === monthIndex &&
                  t.getDate() === day
                );
              })();

              if (isFree) {
                return (
                  <TableRow
                    key={iso}
                    hover
                    onClick={() => onDayClick?.(dateObj)}
                    sx={{
                      cursor: onDayClick ? "pointer" : "default",
                      bgcolor: isWeekend
                        ? alpha(theme.palette.action.hover, 0.3)
                        : undefined,
                      ...(isToday && {
                        borderLeft: `3px solid ${theme.palette.primary.main}`,
                      }),
                    }}
                  >
                    <TableCell sx={{ fontWeight: isToday ? 700 : 500 }}>
                      {day}.
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="caption"
                        sx={{
                          color: isWeekend
                            ? theme.palette.error.main
                            : "text.secondary",
                          fontWeight: isWeekend ? 600 : 400,
                        }}
                      >
                        {weekday}
                      </Typography>
                    </TableCell>
                    <TableCell colSpan={3}>
                      <Typography
                        variant="body2"
                        sx={{
                          color: "text.disabled",
                          fontStyle: "italic",
                          fontSize: "0.8rem",
                        }}
                      >
                        Frei
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" color="text.disabled">
                        —
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              }

              return dayAssignments.map((a, aIdx) => {
                const prof = profilesById[a.shiftProfileId];
                const accent =
                  SHIFT_ACCENT[prof?.shiftType ?? ""] ??
                  theme.palette.grey[500];
                const hours = prof ? paidHours(prof) : 0;

                return (
                  <TableRow
                    key={a.id}
                    hover
                    onClick={() => onDayClick?.(dateObj)}
                    sx={{
                      cursor: onDayClick ? "pointer" : "default",
                      bgcolor: isWeekend
                        ? alpha(theme.palette.action.hover, 0.3)
                        : undefined,
                      ...(isToday && {
                        borderLeft: `3px solid ${theme.palette.primary.main}`,
                      }),
                      ...(aIdx > 0 && {
                        "& td": { borderTop: "none", pt: 0 },
                      }),
                    }}
                  >
                    {aIdx === 0 ? (
                      <>
                        <TableCell
                          rowSpan={dayAssignments.length}
                          sx={{ fontWeight: isToday ? 700 : 500, verticalAlign: "top" }}
                        >
                          {day}.
                        </TableCell>
                        <TableCell
                          rowSpan={dayAssignments.length}
                          sx={{ verticalAlign: "top" }}
                        >
                          <Typography
                            variant="caption"
                            sx={{
                              color: isWeekend
                                ? theme.palette.error.main
                                : "text.secondary",
                              fontWeight: isWeekend ? 600 : 400,
                            }}
                          >
                            {weekday}
                          </Typography>
                        </TableCell>
                      </>
                    ) : null}
                    <TableCell>
                      <Box
                        sx={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 0.8,
                          px: 1,
                          py: 0.25,
                          borderRadius: 1,
                          bgcolor: alpha(accent, 0.08),
                          borderLeft: `3px solid ${accent}`,
                        }}
                      >
                        <Box sx={{ color: accent, display: "flex" }}>
                          {shiftIcon(prof?.shiftType ?? "")}
                        </Box>
                        <Typography
                          variant="body2"
                          fontWeight={600}
                          sx={{ color: accent }}
                        >
                          {prof?.name ?? "?"}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {prof ? shiftTypeLabel(prof.shiftType) : ""}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={`St. ${prof?.stationNumber ?? "?"}`}
                        size="small"
                        variant="outlined"
                        sx={{ height: 20, fontSize: "0.7rem" }}
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8rem" }}>
                        {prof
                          ? `${prof.startTime}\u2013${prof.endTime}`
                          : "—"}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        fontWeight={500}
                        sx={{ color: accent }}
                      >
                        {fmtHours(hours)}h
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              });
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
