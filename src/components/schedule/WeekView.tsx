"use client";

import { Box, Typography, Paper, Avatar, AvatarGroup, Chip, Tooltip } from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  STATIONS,
  SHIFTS,
  WEEKDAYS,
  generateDayData,
  getStaffingStatus,
  getShiftEmployees,
} from "@/lib/schedule-data";

interface WeekViewProps {
  weekNumber: number;
  startDate: Date;
  selectedStation: string | null;
  onDayClick: (date: Date) => void;
}

export default function WeekView({
  weekNumber,
  startDate,
  selectedStation,
  onDayClick,
}: WeekViewProps) {
  // Generate week days
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    return date;
  });

  const stationsToShow = selectedStation
    ? STATIONS.filter((s) => s.id === selectedStation)
    : STATIONS;

  return (
    <Box sx={{ overflow: "auto" }}>
      {/* Header row with days */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "120px repeat(7, 1fr)",
          gap: 1,
          mb: 1,
        }}
      >
        <Box sx={{ p: 1 }} />
        {weekDays.map((date, idx) => {
          const isToday = isSameDay(date, new Date());
          const isWeekend = idx >= 5;

          return (
            <Box
              key={date.toISOString()}
              onClick={() => onDayClick(date)}
              sx={{
                p: 1.5,
                textAlign: "center",
                bgcolor: isToday ? "primary.main" : isWeekend ? "grey.100" : "transparent",
                color: isToday ? "white" : "text.primary",
                borderRadius: 1,
                cursor: "pointer",
                "&:hover": {
                  bgcolor: isToday ? "primary.dark" : "action.hover",
                },
              }}
            >
              <Typography variant="body2" fontWeight={isToday ? 600 : 400}>
                {WEEKDAYS[idx]}
              </Typography>
              <Typography variant="h6" fontWeight={isToday ? 600 : 400}>
                {date.getDate()}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* Shift rows */}
      {SHIFTS.map((shift) => (
        <Box
          key={shift.id}
          sx={{
            display: "grid",
            gridTemplateColumns: "120px repeat(7, 1fr)",
            gap: 1,
            mb: 1,
          }}
        >
          {/* Shift label */}
          <Box
            sx={{
              p: 1.5,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              borderRight: 2,
              borderColor: shift.color,
            }}
          >
            <Chip
              label={shift.name}
              size="small"
              sx={{
                bgcolor: shift.color,
                color: "white",
                fontWeight: 600,
                mb: 0.5,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {shift.time}
            </Typography>
          </Box>

          {/* Day cells */}
          {weekDays.map((date, dayIdx) => {
            const isWeekend = dayIdx >= 5;
            const dayData = generateDayData(date.getDate() + date.getMonth());
            const shiftData = dayData[shift.id as keyof typeof dayData];

            return (
              <Paper
                key={date.toISOString()}
                elevation={0}
                onClick={() => onDayClick(date)}
                sx={{
                  p: 1,
                  bgcolor: isWeekend ? "grey.50" : "background.paper",
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1,
                  cursor: "pointer",
                  "&:hover": {
                    borderColor: "primary.light",
                  },
                  minHeight: stationsToShow.length > 1 ? 140 : 80,
                }}
              >
                {/* Station sections */}
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {stationsToShow.map((station) => {
                    const stationData = shiftData[station.id];
                    const status = getStaffingStatus(
                      stationData.assigned,
                      stationData.required
                    );
                    const employees = getShiftEmployees(
                      station.id,
                      shift.id,
                      date.getDate()
                    );
                    const hasWarning = status !== "success";

                    return (
                      <Box
                        key={station.id}
                        sx={{
                          p: 0.75,
                          bgcolor: `${status}.50`,
                          borderRadius: 1,
                          borderLeft: 3,
                          borderColor: `${status}.main`,
                        }}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            mb: 0.5,
                          }}
                        >
                          <Typography
                            variant="caption"
                            fontWeight={600}
                            color="text.secondary"
                          >
                            {station.name}
                          </Typography>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                            {hasWarning && (
                              <WarningAmberIcon
                                sx={{ fontSize: 12, color: `${status}.main` }}
                              />
                            )}
                            <Chip
                              label={`${stationData.assigned}/${stationData.required}`}
                              size="small"
                              color={status}
                              sx={{ height: 18, fontSize: 10 }}
                            />
                          </Box>
                        </Box>
                        <AvatarGroup
                          max={4}
                          sx={{
                            justifyContent: "flex-start",
                            "& .MuiAvatar-root": {
                              width: 22,
                              height: 22,
                              fontSize: 9,
                              bgcolor: shift.color,
                            },
                          }}
                        >
                          {employees.slice(0, stationData.assigned).map((emp) => (
                            <Tooltip key={emp.id} title={emp.name}>
                              <Avatar>{emp.initials}</Avatar>
                            </Tooltip>
                          ))}
                        </AvatarGroup>
                      </Box>
                    );
                  })}
                </Box>
              </Paper>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getDate() === date2.getDate() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getFullYear() === date2.getFullYear()
  );
}
