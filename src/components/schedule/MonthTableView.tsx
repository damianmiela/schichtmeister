"use client";

import { useMemo } from "react";
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Tooltip,
} from "@mui/material";
import {
  EMPLOYEES,
  SHIFT_CODE_MAP,
  SHIFT_CODE_COLORS,
  generateMonthlyRoster,
  getEmployeeById,
  WEEKDAYS,
  ShiftCode,
} from "@/lib/schedule-data";

interface MonthTableViewProps {
  year: number;
  month: number;
  selectedStation: string | null;
  onDayClick: (date: Date) => void;
}

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

export default function MonthTableView({
  year,
  month,
  selectedStation,
  onDayClick,
}: MonthTableViewProps) {
  // Generate roster data
  const rosterData = useMemo(
    () => generateMonthlyRoster(year, month),
    [year, month]
  );

  // Filter employees by station
  const filteredEmployees = useMemo(() => {
    if (!selectedStation) return EMPLOYEES;
    return EMPLOYEES.filter((e) => e.station === selectedStation);
  }, [selectedStation]);

  // Days in month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Get day info (weekday, is weekend)
  const getDayInfo = (day: number) => {
    const date = new Date(year, month, day);
    const dayOfWeek = date.getDay();
    const weekdayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert to Mo=0, So=6
    return {
      date,
      weekday: WEEKDAYS[weekdayIndex],
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    };
  };

  // Get cell background color based on shift code
  const getCellStyle = (code: ShiftCode) => {
    if (!code) return {};
    const info = SHIFT_CODE_MAP[code];
    if (!info) return {};
    const colors = SHIFT_CODE_COLORS[info.shiftType];
    return {
      backgroundColor: colors.bg,
      borderLeft: `2px solid ${colors.border}`,
    };
  };

  // Handle day column click
  const handleDayClick = (day: number) => {
    const date = new Date(year, month, day);
    onDayClick(date);
  };

  return (
    <Paper elevation={1} sx={{ overflow: "hidden" }}>
      <TableContainer sx={{ maxHeight: "calc(100vh - 280px)" }}>
        <Table stickyHeader size="small" sx={{ minWidth: 1200 }}>
          <TableHead>
            {/* Day numbers row */}
            <TableRow>
              <TableCell
                sx={{
                  position: "sticky",
                  left: 0,
                  zIndex: 3,
                  backgroundColor: "#fafafa",
                  borderRight: "2px solid #e0e0e0",
                  minWidth: 180,
                  fontWeight: 600,
                }}
              >
                Mitarbeiter
              </TableCell>
              <TableCell
                align="center"
                sx={{
                  position: "sticky",
                  left: 180,
                  zIndex: 3,
                  backgroundColor: "#fafafa",
                  borderRight: "1px solid #e0e0e0",
                  minWidth: 70,
                  fontWeight: 600,
                  fontSize: "0.75rem",
                }}
              >
                Std.
              </TableCell>
              <TableCell
                align="center"
                sx={{
                  position: "sticky",
                  left: 250,
                  zIndex: 3,
                  backgroundColor: "#fafafa",
                  borderRight: "2px solid #e0e0e0",
                  minWidth: 60,
                  fontWeight: 600,
                  fontSize: "0.75rem",
                }}
              >
                Rolle
              </TableCell>
              {days.map((day) => {
                const { weekday, isWeekend } = getDayInfo(day);
                return (
                  <TableCell
                    key={day}
                    align="center"
                    onClick={() => handleDayClick(day)}
                    sx={{
                      minWidth: 36,
                      maxWidth: 36,
                      p: 0.5,
                      backgroundColor: isWeekend ? "#f5f5f5" : "#fafafa",
                      cursor: "pointer",
                      "&:hover": {
                        backgroundColor: "#e3f2fd",
                      },
                      borderRight: day % 7 === 0 ? "1px solid #bdbdbd" : undefined,
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 600,
                        fontSize: "0.7rem",
                        color: isWeekend ? "#9e9e9e" : "text.primary",
                      }}
                    >
                      {weekday}
                    </Typography>
                    <Typography
                      variant="caption"
                      display="block"
                      sx={{
                        fontWeight: 500,
                        fontSize: "0.75rem",
                        color: isWeekend ? "#9e9e9e" : "text.primary",
                      }}
                    >
                      {day}
                    </Typography>
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredEmployees.map((employee) => {
              const schedule = rosterData.find(
                (s) => s.employeeId === employee.id
              );
              if (!schedule) return null;

              return (
                <TableRow
                  key={employee.id}
                  sx={{
                    "&:hover": {
                      backgroundColor: "#fafafa",
                    },
                  }}
                >
                  {/* Employee name - sticky */}
                  <TableCell
                    sx={{
                      position: "sticky",
                      left: 0,
                      zIndex: 1,
                      backgroundColor: "#fff",
                      borderRight: "2px solid #e0e0e0",
                      py: 0.75,
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 500, fontSize: "0.8rem" }}
                    >
                      {employee.name}
                    </Typography>
                  </TableCell>

                  {/* Hours soll/ist - sticky */}
                  <TableCell
                    align="center"
                    sx={{
                      position: "sticky",
                      left: 180,
                      zIndex: 1,
                      backgroundColor: "#fff",
                      borderRight: "1px solid #e0e0e0",
                      py: 0.75,
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        fontSize: "0.7rem",
                        color:
                          schedule.hoursPlanned > employee.hoursContract
                            ? "error.main"
                            : schedule.hoursPlanned < employee.hoursContract - 10
                            ? "warning.main"
                            : "text.secondary",
                      }}
                    >
                      {employee.hoursContract}/{schedule.hoursPlanned}
                    </Typography>
                  </TableCell>

                  {/* Role - sticky */}
                  <TableCell
                    align="center"
                    sx={{
                      position: "sticky",
                      left: 250,
                      zIndex: 1,
                      backgroundColor: "#fff",
                      borderRight: "2px solid #e0e0e0",
                      py: 0.75,
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        fontSize: "0.65rem",
                        color: employee.role === "Fachkraft" ? "#1976d2" : "#757575",
                        fontWeight: employee.role === "Fachkraft" ? 600 : 400,
                      }}
                    >
                      {employee.role === "Fachkraft" ? "FK" : "HK"}
                    </Typography>
                  </TableCell>

                  {/* Day cells */}
                  {days.map((day) => {
                    const code = schedule.days[day - 1] || "";
                    const { isWeekend } = getDayInfo(day);
                    const shiftInfo = code ? SHIFT_CODE_MAP[code] : null;

                    return (
                      <Tooltip
                        key={day}
                        title={
                          shiftInfo && shiftInfo.fullName
                            ? `${shiftInfo.fullName}${
                                shiftInfo.startTime
                                  ? ` (${shiftInfo.startTime}-${shiftInfo.endTime})`
                                  : ""
                              }`
                            : ""
                        }
                        arrow
                        placement="top"
                      >
                        <TableCell
                          align="center"
                          onClick={() => handleDayClick(day)}
                          sx={{
                            p: 0.5,
                            cursor: "pointer",
                            ...getCellStyle(code),
                            backgroundColor: !code && isWeekend ? "#f5f5f5" : getCellStyle(code).backgroundColor,
                            "&:hover": {
                              opacity: 0.8,
                            },
                            borderRight: day % 7 === 0 ? "1px solid #bdbdbd" : undefined,
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{
                              fontSize: "0.7rem",
                              fontWeight: 500,
                              color:
                                code === "X" || code === "U"
                                  ? "#757575"
                                  : "#424242",
                            }}
                          >
                            {code}
                          </Typography>
                        </TableCell>
                      </Tooltip>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Legend */}
      <Box
        sx={{
          display: "flex",
          gap: 2,
          p: 1.5,
          borderTop: "1px solid #e0e0e0",
          backgroundColor: "#fafafa",
          flexWrap: "wrap",
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 600, mr: 1 }}>
          Legende:
        </Typography>
        {[
          { code: "F", label: "Früh", color: SHIFT_CODE_COLORS.early },
          { code: "S", label: "Spät", color: SHIFT_CODE_COLORS.late },
          { code: "N", label: "Nacht", color: SHIFT_CODE_COLORS.night },
          { code: "X", label: "Frei", color: SHIFT_CODE_COLORS.off },
          { code: "U", label: "Urlaub", color: SHIFT_CODE_COLORS.vacation },
        ].map((item) => (
          <Box
            key={item.code}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
            }}
          >
            <Box
              sx={{
                width: 20,
                height: 16,
                backgroundColor: item.color.bg,
                borderLeft: `2px solid ${item.color.border}`,
                borderRadius: "2px",
              }}
            />
            <Typography variant="caption" sx={{ fontSize: "0.7rem" }}>
              {item.code} = {item.label}
            </Typography>
          </Box>
        ))}
        <Box sx={{ ml: "auto", display: "flex", gap: 2 }}>
          <Typography variant="caption" sx={{ fontSize: "0.7rem" }}>
            FK = Fachkraft
          </Typography>
          <Typography variant="caption" sx={{ fontSize: "0.7rem" }}>
            HK = Hilfskraft
          </Typography>
        </Box>
      </Box>
    </Paper>
  );
}
