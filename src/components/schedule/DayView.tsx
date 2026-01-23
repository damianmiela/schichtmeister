"use client";

import {
  Box,
  Typography,
  Paper,
  Avatar,
  Chip,
  Card,
  CardContent,
  Divider,
} from "@mui/material";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import PersonIcon from "@mui/icons-material/Person";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import {
  STATIONS,
  SHIFTS,
  generateDayData,
  getStaffingStatus,
  getShiftEmployees,
} from "@/lib/schedule-data";

interface DayViewProps {
  date: Date;
  selectedStation: string | null;
}

export default function DayView({ date, selectedStation }: DayViewProps) {
  const dayData = generateDayData(date.getDate() + date.getMonth());
  const dayName = date.toLocaleDateString("de-DE", { weekday: "long" });
  const formattedDate = date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

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

      {/* Shifts */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {SHIFTS.map((shift) => {
          const shiftData = dayData[shift.id as keyof typeof dayData];

          // Calculate total staffing for this shift
          const totalAssigned = stationsToShow.reduce<number>(
            (sum, s) => sum + shiftData[s.id].assigned,
            0
          );
          const totalRequired = stationsToShow.reduce<number>(
            (sum, s) => sum + shiftData[s.id].required,
            0
          );
          const overallStatus = getStaffingStatus(totalAssigned, totalRequired);

          return (
            <Card key={shift.id} elevation={1}>
              <CardContent sx={{ p: 0 }}>
                {/* Shift header */}
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    p: 2,
                    bgcolor: shift.color,
                    color: "white",
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <Typography variant="h6" fontWeight={600}>
                      {shift.name}schicht
                    </Typography>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <AccessTimeIcon sx={{ fontSize: 18 }} />
                      <Typography variant="body2">{shift.time}</Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    {overallStatus === "success" ? (
                      <CheckCircleIcon />
                    ) : (
                      <WarningAmberIcon />
                    )}
                    <Typography variant="h6" fontWeight={600}>
                      {totalAssigned}/{totalRequired}
                    </Typography>
                  </Box>
                </Box>

                {/* Station sections */}
                <Box sx={{ p: 2 }}>
                  {stationsToShow.map((station, idx) => {
                    const stationData = shiftData[station.id];
                    const status = getStaffingStatus(
                      stationData.assigned,
                      stationData.required
                    );
                    const employees = getShiftEmployees(
                      station.id,
                      shift.id,
                      date.getDate()
                    ).slice(0, stationData.assigned);

                    // Dummy time slots for employees
                    const getTimeSlot = (empIndex: number) => {
                      if (shift.id === "early") {
                        return empIndex < 3 ? "06:00 - 14:30" : "06:00 - 12:00";
                      }
                      if (shift.id === "late") {
                        return empIndex < 2 ? "14:00 - 22:00" : "16:00 - 22:00";
                      }
                      return "21:30 - 06:30";
                    };

                    return (
                      <Box key={station.id}>
                        {idx > 0 && <Divider sx={{ my: 2 }} />}

                        {/* Station header */}
                        <Box
                          sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            mb: 2,
                          }}
                        >
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Box
                              sx={{
                                width: 8,
                                height: 24,
                                borderRadius: 1,
                                bgcolor: `${status}.main`,
                              }}
                            />
                            <Typography variant="subtitle1" fontWeight={600}>
                              {station.name}
                            </Typography>
                          </Box>
                          <Chip
                            icon={
                              status === "success" ? (
                                <CheckCircleIcon sx={{ fontSize: 16 }} />
                              ) : (
                                <WarningAmberIcon sx={{ fontSize: 16 }} />
                              )
                            }
                            label={`${stationData.assigned} von ${stationData.required} Mitarbeiter`}
                            color={status}
                            variant="outlined"
                          />
                        </Box>

                        {/* Timeline / Employee list */}
                        <Box
                          sx={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                            gap: 1.5,
                          }}
                        >
                          {employees.map((emp, empIdx) => (
                            <Paper
                              key={emp.id}
                              elevation={0}
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 2,
                                p: 1.5,
                                bgcolor: "grey.50",
                                borderRadius: 1,
                                border: 1,
                                borderColor: "divider",
                              }}
                            >
                              <Avatar
                                sx={{
                                  bgcolor: shift.color,
                                  width: 40,
                                  height: 40,
                                }}
                              >
                                {emp.initials}
                              </Avatar>
                              <Box sx={{ flex: 1 }}>
                                <Typography variant="body2" fontWeight={500}>
                                  {emp.name}
                                </Typography>
                                <Box
                                  sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 0.5,
                                    mt: 0.25,
                                  }}
                                >
                                  <AccessTimeIcon
                                    sx={{ fontSize: 14, color: "text.secondary" }}
                                  />
                                  <Typography variant="caption" color="text.secondary">
                                    {getTimeSlot(empIdx)}
                                  </Typography>
                                </Box>
                              </Box>
                            </Paper>
                          ))}

                          {/* Empty slots */}
                          {Array.from({
                            length: Math.max(
                              0,
                              stationData.required - stationData.assigned
                            ),
                          }).map((_, i) => (
                            <Paper
                              key={`empty-${i}`}
                              elevation={0}
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 1,
                                p: 1.5,
                                bgcolor: "error.50",
                                borderRadius: 1,
                                border: 1,
                                borderColor: "error.200",
                                borderStyle: "dashed",
                                minHeight: 64,
                              }}
                            >
                              <PersonIcon sx={{ color: "error.main", fontSize: 20 }} />
                              <Typography variant="body2" color="error.main">
                                Nicht besetzt
                              </Typography>
                            </Paper>
                          ))}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </CardContent>
            </Card>
          );
        })}
      </Box>
    </Box>
  );
}
