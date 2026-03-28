"use client";

import { useMemo } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Avatar,
  alpha,
  useTheme,
} from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import WbSunnyIcon from "@mui/icons-material/WbSunny";
import WbTwilightIcon from "@mui/icons-material/WbTwilight";
import NightsStayIcon from "@mui/icons-material/NightsStay";
import type { AssignmentJson, EmployeeJson, ShiftProfileJson } from "@/lib/schedule/scheduleTypes";
import { localIsoDate } from "@/lib/schedule/monthSchedule";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";
import QualificationPills from "@/components/schedule/QualificationPills";

interface DayViewProps {
  date: Date;
  assignments: AssignmentJson[];
  employeesById: Record<string, EmployeeJson>;
  profilesById: Record<string, ShiftProfileJson>;
  onEmployeeClick?: (employeeId: string) => void;
}

const STATIONS = [1, 2, 3] as const;
const SHIFT_ORDER = ["EARLY", "LATE", "NIGHT"] as const;

const SHIFT_ACCENT: Record<string, string> = {
  EARLY: "#f59e0b",
  LATE: "#3b82f6",
  NIGHT: "#6366f1",
};

function shiftIcon(shiftType: string) {
  switch (shiftType) {
    case "EARLY":
      return <WbSunnyIcon sx={{ fontSize: 16 }} />;
    case "LATE":
      return <WbTwilightIcon sx={{ fontSize: 16 }} />;
    case "NIGHT":
      return <NightsStayIcon sx={{ fontSize: 16 }} />;
    default:
      return null;
  }
}

type GroupedSlot = {
  profile: ShiftProfileJson;
  employees: { assignment: AssignmentJson; employee: EmployeeJson | undefined }[];
};

export default function DayView({
  date,
  assignments,
  employeesById,
  profilesById,
  onEmployeeClick,
}: DayViewProps) {
  const theme = useTheme();
  const iso = localIsoDate(date);
  const dayAssignments = useMemo(
    () => assignments.filter((a) => a.date === iso),
    [assignments, iso],
  );

  const stationData = useMemo(() => {
    const byStation = new Map<number, Map<string, GroupedSlot>>();

    for (const a of dayAssignments) {
      const prof = profilesById[a.shiftProfileId];
      if (!prof) continue;
      const st = prof.stationNumber;

      if (!byStation.has(st)) byStation.set(st, new Map());
      const stMap = byStation.get(st)!;

      if (!stMap.has(prof.id)) {
        stMap.set(prof.id, { profile: prof, employees: [] });
      }
      stMap.get(prof.id)!.employees.push({
        assignment: a,
        employee: employeesById[a.employeeId],
      });
    }

    return STATIONS.map((stNum) => {
      const profMap = byStation.get(stNum);
      const slots: GroupedSlot[] = [];
      if (profMap) {
        for (const shiftType of SHIFT_ORDER) {
          for (const slot of profMap.values()) {
            if (slot.profile.shiftType === shiftType) {
              slot.employees.sort((a, b) => {
                const na = a.employee
                  ? `${a.employee.lastName} ${a.employee.firstName}`
                  : "";
                const nb = b.employee
                  ? `${b.employee.lastName} ${b.employee.firstName}`
                  : "";
                return na.localeCompare(nb, "de");
              });
              slots.push(slot);
            }
          }
        }
      }
      return { stationNumber: stNum, slots };
    });
  }, [dayAssignments, profilesById, employeesById]);

  if (dayAssignments.length === 0) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography color="text.secondary">
            Keine Zuweisungen für{" "}
            {date.toLocaleDateString("de-DE", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
            .
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
        Schichten am{" "}
        {date.toLocaleDateString("de-DE", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
      </Typography>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
          gap: 2,
          alignItems: "start",
        }}
      >
        {stationData.map(({ stationNumber, slots }) => (
          <Card
            key={stationNumber}
            variant="outlined"
            sx={{
              borderRadius: 2,
              overflow: "hidden",
              borderColor: theme.palette.divider,
            }}
          >
            {/* Station header */}
            <Box
              sx={{
                px: 2,
                py: 1.2,
                bgcolor: alpha(theme.palette.primary.main, 0.07),
                borderBottom: "1px solid",
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                gap: 1,
              }}
            >
              <Typography variant="subtitle2" fontWeight={700} sx={{ fontSize: "0.9rem" }}>
                Station {stationNumber}
              </Typography>
              <Chip
                label={`${slots.reduce((s, sl) => s + sl.employees.length, 0)} MA`}
                size="small"
                variant="outlined"
                sx={{ ml: "auto", height: 22, fontSize: "0.7rem" }}
              />
            </Box>

            <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
              {slots.length === 0 ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ p: 2, textAlign: "center", fontStyle: "italic" }}
                >
                  Keine Schichten
                </Typography>
              ) : (
                slots.map((slot, idx) => {
                  const accent = SHIFT_ACCENT[slot.profile.shiftType] ?? theme.palette.grey[500];
                  return (
                    <Box key={slot.profile.id}>
                      {idx > 0 && (
                        <Box sx={{ borderTop: "1px solid", borderColor: "divider" }} />
                      )}

                      {/* Shift profile header */}
                      <Box
                        sx={{
                          px: 2,
                          py: 0.8,
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          bgcolor: alpha(accent, 0.06),
                          borderLeft: `3px solid ${accent}`,
                        }}
                      >
                        <Box sx={{ color: accent, display: "flex" }}>
                          {shiftIcon(slot.profile.shiftType)}
                        </Box>
                        <Typography
                          variant="body2"
                          fontWeight={600}
                          sx={{ color: accent }}
                        >
                          {slot.profile.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {shiftTypeLabel(slot.profile.shiftType)}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ ml: "auto", whiteSpace: "nowrap" }}
                        >
                          {slot.profile.startTime}–{slot.profile.endTime}
                        </Typography>
                      </Box>

                      {/* Employee list */}
                      <Box sx={{ px: 1.5, py: 0.5 }}>
                        {slot.employees.map(({ assignment, employee }) => {
                          const name = employee
                            ? `${employee.firstName} ${employee.lastName}`
                            : assignment.employeeId;
                          const tags = employee?.qualificationTags ?? [];
                          return (
                            <Box
                              key={assignment.id}
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                                py: 0.5,
                                px: 0.5,
                                borderRadius: 1,
                                "&:hover": {
                                  bgcolor: alpha(theme.palette.action.hover, 0.5),
                                },
                              }}
                            >
                              <Avatar
                                sx={{
                                  width: 26,
                                  height: 26,
                                  bgcolor: alpha(accent, 0.15),
                                  color: accent,
                                  fontSize: 12,
                                }}
                              >
                                {employee
                                  ? `${employee.firstName.charAt(0)}${employee.lastName.charAt(0)}`
                                  : <PersonIcon sx={{ fontSize: 14 }} />}
                              </Avatar>
                              <Typography
                                variant="body2"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  onEmployeeClick?.(assignment.employeeId);
                                }}
                                sx={{
                                  fontWeight: 500,
                                  lineHeight: 1.3,
                                  cursor: onEmployeeClick ? "pointer" : "default",
                                  "&:hover": onEmployeeClick
                                    ? { textDecoration: "underline", color: "primary.main" }
                                    : undefined,
                                }}
                              >
                                {name}
                              </Typography>
                              <QualificationPills tags={tags} compact />
                            </Box>
                          );
                        })}
                      </Box>
                    </Box>
                  );
                })
              )}
            </CardContent>
          </Card>
        ))}
      </Box>
    </Box>
  );
}
