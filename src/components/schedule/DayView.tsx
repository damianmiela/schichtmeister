"use client";

import {
  Box,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  Typography,
  Chip,
} from "@mui/material";
import type { AssignmentJson, EmployeeJson, ShiftProfileJson } from "@/lib/schedule/scheduleTypes";
import { localIsoDate } from "@/lib/schedule/monthSchedule";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

interface DayViewProps {
  date: Date;
  assignments: AssignmentJson[];
  employeesById: Record<string, EmployeeJson>;
  profilesById: Record<string, ShiftProfileJson>;
}

export default function DayView({
  date,
  assignments,
  employeesById,
  profilesById,
}: DayViewProps) {
  const iso = localIsoDate(date);
  const dayAssignments = assignments.filter((a) => a.date === iso);
  dayAssignments.sort((a, b) => {
    const pa = profilesById[a.shiftProfileId]?.name ?? "";
    const pb = profilesById[b.shiftProfileId]?.name ?? "";
    return pa.localeCompare(pb, "de");
  });

  if (dayAssignments.length === 0) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography color="text.secondary">
            Keine Zuweisungen für {date.toLocaleDateString("de-DE")}.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" gutterBottom fontWeight={600}>
          Schichten am {date.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}
        </Typography>
        <List dense disablePadding>
          {dayAssignments.map((a) => {
            const emp = employeesById[a.employeeId];
            const prof = profilesById[a.shiftProfileId];
            const name = emp ? `${emp.firstName} ${emp.lastName}` : a.employeeId;
            return (
              <ListItem key={a.id} sx={{ px: 0, alignItems: "flex-start" }}>
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                      <Typography fontWeight={500}>{name}</Typography>
                      {prof && (
                        <Chip
                          size="small"
                          label={`${prof.name} (${prof.startTime}–${prof.endTime})`}
                          color="primary"
                          variant="outlined"
                        />
                      )}
                    </Box>
                  }
                  secondary={
                    prof ? shiftTypeLabel(prof.shiftType) : undefined
                  }
                />
              </ListItem>
            );
          })}
        </List>
      </CardContent>
    </Card>
  );
}
