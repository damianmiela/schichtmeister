"use client";

import { Box, Typography, Paper, Tooltip } from "@mui/material";
import {
  STATIONS,
  SHIFTS,
  WEEKDAYS,
  generateDayData,
  getStaffingStatus,
  getAggregatedStaffing,
  getMonthWeeks,
} from "@/lib/schedule-data";

interface MonthViewProps {
  year: number;
  month: number;
  selectedStation: string | null;
  onWeekClick: (weekNumber: number, startDate: Date) => void;
  onDayClick: (date: Date) => void;
}

export default function MonthView({
  year,
  month,
  selectedStation,
  onWeekClick,
  onDayClick,
}: MonthViewProps) {
  const weeks = getMonthWeeks(year, month);

  return (
    <Box sx={{ overflow: "auto" }}>
      {/* Header row with weekdays */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "60px repeat(7, 1fr)",
          gap: 0.5,
          mb: 0.5,
        }}
      >
        <Box sx={{ p: 1 }} /> {/* Empty corner */}
        {WEEKDAYS.map((day, idx) => (
          <Box
            key={day}
            sx={{
              p: 1,
              textAlign: "center",
              bgcolor: idx >= 5 ? "grey.100" : "transparent",
              borderRadius: 1,
            }}
          >
            <Typography variant="subtitle2" fontWeight={600}>
              {day}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* Week rows */}
      {weeks.map((week) => (
        <Box
          key={week.weekNumber}
          sx={{
            display: "grid",
            gridTemplateColumns: "60px repeat(7, 1fr)",
            gap: 0.5,
            mb: 0.5,
          }}
        >
          {/* Week number */}
          <Box
            onClick={() => onWeekClick(week.weekNumber, week.days[0])}
            sx={{
              p: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "primary.main",
              color: "white",
              borderRadius: 1,
              cursor: "pointer",
              "&:hover": {
                bgcolor: "primary.dark",
              },
            }}
          >
            <Typography variant="body2" fontWeight={600}>
              KW {week.weekNumber}
            </Typography>
          </Box>

          {/* Day cells */}
          {week.days.map((date, dayIdx) => {
            const isCurrentMonth = date.getMonth() === month;
            const isToday = isSameDay(date, new Date());
            const isWeekend = dayIdx >= 5;
            const dayData = generateDayData(date.getDate() + date.getMonth());

            return (
              <Paper
                key={date.toISOString()}
                elevation={0}
                onClick={() => onDayClick(date)}
                sx={{
                  p: 0.5,
                  opacity: isCurrentMonth ? 1 : 0.4,
                  bgcolor: isToday
                    ? "primary.50"
                    : isWeekend
                    ? "grey.50"
                    : "background.paper",
                  border: 1,
                  borderColor: isToday ? "primary.main" : "divider",
                  borderRadius: 1,
                  cursor: "pointer",
                  "&:hover": {
                    bgcolor: "action.hover",
                    borderColor: "primary.light",
                  },
                  minHeight: 120,
                }}
              >
                {/* Date header */}
                <Typography
                  variant="caption"
                  sx={{
                    display: "block",
                    textAlign: "right",
                    fontWeight: isToday ? 700 : 400,
                    color: isToday ? "primary.main" : "text.secondary",
                    mb: 0.5,
                  }}
                >
                  {date.getDate()}
                </Typography>

                {/* Shifts */}
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
                  {SHIFTS.map((shift) => {
                    const shiftData = dayData[shift.id as keyof typeof dayData];

                    return (
                      <ShiftRow
                        key={shift.id}
                        shift={shift}
                        shiftData={shiftData}
                        selectedStation={selectedStation}
                      />
                    );
                  })}
                </Box>
              </Paper>
            );
          })}
        </Box>
      ))}

      {/* Legend */}
      <Box
        sx={{
          display: "flex",
          gap: 3,
          mt: 2,
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        {SHIFTS.map((shift) => (
          <Box key={shift.id} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: 0.5,
                bgcolor: shift.color,
              }}
            />
            <Typography variant="caption">{shift.name}</Typography>
          </Box>
        ))}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: "success.main" }} />
          <Typography variant="caption">Voll besetzt</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: "warning.main" }} />
          <Typography variant="caption">Knapp besetzt</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: "error.main" }} />
          <Typography variant="caption">Unterbesetzt</Typography>
        </Box>
      </Box>
    </Box>
  );
}

interface ShiftRowProps {
  shift: (typeof SHIFTS)[number];
  shiftData: ReturnType<typeof generateDayData>["early"];
  selectedStation: string | null;
}

function ShiftRow({ shift, shiftData, selectedStation }: ShiftRowProps) {
  // If a station is selected, show only that station's data
  if (selectedStation) {
    const stationData = shiftData[selectedStation];
    const status = getStaffingStatus(stationData.assigned, stationData.required);

    return (
      <Tooltip title={`${shift.name}: ${stationData.assigned}/${stationData.required}`}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            py: 0.25,
          }}
        >
          <Box
            sx={{
              width: 4,
              height: 16,
              borderRadius: 0.5,
              bgcolor: shift.color,
            }}
          />
          <Box
            sx={{
              flex: 1,
              bgcolor: `${status}.main`,
              borderRadius: 0.5,
              px: 0.5,
              py: 0.125,
            }}
          >
            <Typography
              variant="caption"
              sx={{ color: "white", fontSize: 12, fontWeight: 500 }}
            >
              {stationData.assigned}/{stationData.required}
            </Typography>
          </Box>
        </Box>
      </Tooltip>
    );
  }

  // Show all stations as columns
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.25,
        py: 0.25,
      }}
    >
      <Box
        sx={{
          width: 4,
          height: 16,
          borderRadius: 0.5,
          bgcolor: shift.color,
          flexShrink: 0,
        }}
      />
      {STATIONS.map((station) => {
        const stationData = shiftData[station.id];
        const status = getStaffingStatus(stationData.assigned, stationData.required);

        return (
          <Tooltip
            key={station.id}
            title={`${shift.name} - ${station.name}: ${stationData.assigned}/${stationData.required}`}
          >
            <Box
              sx={{
                flex: 1,
                bgcolor: `${status}.main`,
                borderRadius: 0.5,
                px: 0.25,
                py: 0.125,
                textAlign: "center",
                minWidth: 0,
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  color: "white",
                  fontSize: 12,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                }}
              >
                {stationData.assigned}/{stationData.required}
              </Typography>
            </Box>
          </Tooltip>
        );
      })}
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
