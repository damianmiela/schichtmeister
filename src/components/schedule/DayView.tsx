"use client";

import { Box, Typography, Paper, Tooltip, Avatar } from "@mui/material";
import {
  STATIONS,
  TIMELINE_START_HOUR,
  TIMELINE_END_HOUR,
  TIMELINE_HOURS,
  SHIFT_COLORS,
  generateTimelineShifts,
  getStationEmployees,
  timeToHours,
  type TimelineShift,
} from "@/lib/schedule-data";

interface DayViewProps {
  date: Date;
  selectedStation: string | null;
}

// Constants for layout
const EMPLOYEE_LABEL_WIDTH = 140;
const ROW_HEIGHT = 44;
const HOUR_WIDTH = 60;
const TIMELINE_WIDTH = TIMELINE_HOURS.length * HOUR_WIDTH;

export default function DayView({ date, selectedStation }: DayViewProps) {
  const dayName = date.toLocaleDateString("de-DE", { weekday: "long" });
  const formattedDate = date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const allShifts = generateTimelineShifts(date.getDate() + date.getMonth());
  const stationsToShow = selectedStation
    ? STATIONS.filter((s) => s.id === selectedStation)
    : STATIONS;

  return (
    <Box>
      {/* Day header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>
          {dayName}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {formattedDate}
        </Typography>
      </Box>

      {/* Legend */}
      <Box sx={{ display: "flex", gap: 3, mb: 3, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ width: 20, height: 12, borderRadius: 0.5, bgcolor: SHIFT_COLORS.early.bg }} />
          <Typography variant="caption">Früh (06:00-14:30)</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ width: 20, height: 12, borderRadius: 0.5, bgcolor: SHIFT_COLORS.late.bg }} />
          <Typography variant="caption">Spät (14:00-22:00)</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ width: 20, height: 12, borderRadius: 0.5, bgcolor: SHIFT_COLORS.night.bg }} />
          <Typography variant="caption">Nacht (21:30-06:30)</Typography>
        </Box>
      </Box>

      {/* Timeline container */}
      <Paper
        elevation={1}
        sx={{
          overflow: "auto",
          bgcolor: "background.paper",
          borderRadius: 2,
        }}
      >
        {/* Sticky time axis header */}
        <Box
          sx={{
            display: "flex",
            position: "sticky",
            top: 0,
            zIndex: 10,
            bgcolor: "grey.100",
            borderBottom: 2,
            borderColor: "divider",
          }}
        >
          {/* Empty corner for employee labels */}
          <Box
            sx={{
              width: EMPLOYEE_LABEL_WIDTH,
              minWidth: EMPLOYEE_LABEL_WIDTH,
              flexShrink: 0,
              p: 1,
              borderRight: 1,
              borderColor: "divider",
              position: "sticky",
              left: 0,
              bgcolor: "grey.100",
              zIndex: 11,
            }}
          >
            <Typography variant="subtitle2" fontWeight={600}>
              Mitarbeiter
            </Typography>
          </Box>

          {/* Hour ticks */}
          <Box sx={{ display: "flex" }}>
            {TIMELINE_HOURS.map((hour) => (
              <Box
                key={hour}
                sx={{
                  width: HOUR_WIDTH,
                  minWidth: HOUR_WIDTH,
                  textAlign: "center",
                  py: 1,
                  borderRight: 1,
                  borderColor: hour % 2 === 0 ? "divider" : "transparent",
                  bgcolor: hour >= 21 || hour < 6 ? "grey.200" : "grey.100",
                }}
              >
                <Typography
                  variant="caption"
                  fontWeight={hour % 2 === 0 ? 600 : 400}
                  color={hour % 2 === 0 ? "text.primary" : "text.secondary"}
                >
                  {hour === 24 ? "00:00" : `${hour.toString().padStart(2, "0")}:00`}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>

        {/* Station sections */}
        {stationsToShow.map((station, stationIdx) => {
          const stationShifts = allShifts.filter((s) => s.stationId === station.id);
          const stationEmployees = getStationEmployees(allShifts, station.id);

          return (
            <Box key={station.id}>
              {/* Station header */}
              <Box
                sx={{
                  display: "flex",
                  position: "sticky",
                  left: 0,
                  bgcolor: "primary.main",
                  color: "white",
                  borderTop: stationIdx > 0 ? 2 : 0,
                  borderColor: "primary.dark",
                }}
              >
                <Box
                  sx={{
                    width: EMPLOYEE_LABEL_WIDTH,
                    minWidth: EMPLOYEE_LABEL_WIDTH,
                    flexShrink: 0,
                    p: 1.5,
                    position: "sticky",
                    left: 0,
                    bgcolor: "primary.main",
                    zIndex: 5,
                  }}
                >
                  <Typography variant="subtitle1" fontWeight={600}>
                    {station.name}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.8 }}>
                    {stationEmployees.length} Mitarbeiter
                  </Typography>
                </Box>
                <Box
                  sx={{
                    flex: 1,
                    minWidth: TIMELINE_WIDTH,
                  }}
                />
              </Box>

              {/* Employee rows */}
              {stationEmployees.length === 0 ? (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: ROW_HEIGHT,
                    bgcolor: "error.50",
                    borderBottom: 1,
                    borderColor: "divider",
                  }}
                >
                  <Typography variant="body2" color="error.main">
                    Keine Mitarbeiter zugewiesen
                  </Typography>
                </Box>
              ) : (
                stationEmployees.map((employee, empIdx) => {
                  const employeeShifts = stationShifts.filter(
                    (s) => s.employeeId === employee.id
                  );

                  return (
                    <Box
                      key={employee.id}
                      sx={{
                        display: "flex",
                        height: ROW_HEIGHT,
                        borderBottom: 1,
                        borderColor: "divider",
                        bgcolor: empIdx % 2 === 0 ? "background.paper" : "grey.50",
                        "&:hover": {
                          bgcolor: "action.hover",
                        },
                      }}
                    >
                      {/* Employee label */}
                      <Box
                        sx={{
                          width: EMPLOYEE_LABEL_WIDTH,
                          minWidth: EMPLOYEE_LABEL_WIDTH,
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          px: 1.5,
                          borderRight: 1,
                          borderColor: "divider",
                          position: "sticky",
                          left: 0,
                          bgcolor: empIdx % 2 === 0 ? "background.paper" : "grey.50",
                          zIndex: 2,
                        }}
                      >
                        <Avatar
                          sx={{
                            width: 28,
                            height: 28,
                            fontSize: 11,
                            bgcolor: "primary.main",
                          }}
                        >
                          {employee.initials}
                        </Avatar>
                        <Typography
                          variant="body2"
                          fontWeight={500}
                          noWrap
                          sx={{ flex: 1 }}
                        >
                          {employee.name}
                        </Typography>
                      </Box>

                      {/* Timeline area with hour grid */}
                      <Box
                        sx={{
                          position: "relative",
                          width: TIMELINE_WIDTH,
                          minWidth: TIMELINE_WIDTH,
                        }}
                      >
                        {/* Hour grid lines */}
                        <Box sx={{ position: "absolute", inset: 0, display: "flex" }}>
                          {TIMELINE_HOURS.map((hour) => (
                            <Box
                              key={hour}
                              sx={{
                                width: HOUR_WIDTH,
                                height: "100%",
                                borderRight: 1,
                                borderColor: hour % 2 === 0 ? "divider" : "grey.100",
                                bgcolor: hour >= 21 || hour < 6 ? "rgba(0,0,0,0.03)" : "transparent",
                              }}
                            />
                          ))}
                        </Box>

                        {/* Shift blocks */}
                        {employeeShifts.map((shift) => (
                          <ShiftBlock key={shift.id} shift={shift} />
                        ))}
                      </Box>
                    </Box>
                  );
                })
              )}
            </Box>
          );
        })}
      </Paper>

      {/* Time indicator hint */}
      <Box sx={{ mt: 2, textAlign: "center" }}>
        <Typography variant="caption" color="text.secondary">
          Scroll horizontal um alle Stunden zu sehen • Klicken Sie auf einen
          Schichtblock für Details
        </Typography>
      </Box>
    </Box>
  );
}

// Shift block component
interface ShiftBlockProps {
  shift: TimelineShift;
}

function ShiftBlock({ shift }: ShiftBlockProps) {
  const startHours = timeToHours(shift.startTime);
  const endHours = timeToHours(shift.endTime);

  // Calculate position and width
  const left = (startHours - TIMELINE_START_HOUR) * HOUR_WIDTH;
  const width = (endHours - startHours) * HOUR_WIDTH;

  const colors = SHIFT_COLORS[shift.shiftType];

  return (
    <Tooltip
      title={
        <Box>
          <Typography variant="body2" fontWeight={600}>
            {shift.employeeName}
          </Typography>
          <Typography variant="caption" display="block">
            {STATIONS.find((s) => s.id === shift.stationId)?.name}
          </Typography>
          <Typography variant="caption" display="block">
            {shift.startTime} – {shift.endTime === "24:00" ? "00:00" : shift.endTime}
          </Typography>
        </Box>
      }
      arrow
      placement="top"
    >
      <Box
        sx={{
          position: "absolute",
          left: left,
          top: 6,
          width: width - 4,
          height: ROW_HEIGHT - 12,
          bgcolor: colors.bg,
          borderRadius: 1,
          display: "flex",
          alignItems: "center",
          px: 1,
          cursor: "pointer",
          transition: "transform 0.1s, box-shadow 0.1s",
          boxShadow: 1,
          "&:hover": {
            transform: "scaleY(1.1)",
            boxShadow: 3,
            zIndex: 1,
          },
          overflow: "hidden",
        }}
      >
        <Typography
          variant="caption"
          sx={{
            color: "white",
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontSize: 11,
          }}
        >
          {width > 80 ? `${shift.startTime} - ${shift.endTime === "24:00" ? "00:00" : shift.endTime}` : shift.startTime}
        </Typography>
      </Box>
    </Tooltip>
  );
}
