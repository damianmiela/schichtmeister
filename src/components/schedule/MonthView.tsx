"use client";

import { Box, Paper, Typography, Chip } from "@mui/material";
import type { AssignmentJson, ShiftProfileJson, StaffingJson } from "@/lib/schedule/scheduleTypes";
import { monthCalendarRowsLocal } from "@/lib/schedule/monthSchedule";
import {
  assignedCountsForIsoDate,
  requiredCountsForIsoDate,
} from "@/lib/schedule/staffingAggregate";
import { getStaffingStatus, getWeekNumber, shiftTypeLabel } from "@/lib/schedule/viewUtils";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const SHIFT_KEYS = ["EARLY", "LATE", "NIGHT"] as const;

interface MonthViewProps {
  year: number;
  monthIndex: number;
  assignments: AssignmentJson[];
  profilesById: Record<string, ShiftProfileJson>;
  staffing: StaffingJson[];
  onWeekClick: (weekNumber: number, startDate: Date) => void;
  onDayClick: (date: Date) => void;
}

export default function MonthView({
  year,
  monthIndex,
  assignments,
  profilesById,
  staffing,
  onWeekClick,
  onDayClick,
}: MonthViewProps) {
  const rows = monthCalendarRowsLocal(year, monthIndex);
  const staffRows = staffing.map((s) => ({
    dayOfWeek: s.dayOfWeek,
    shiftType: s.shiftType,
    minStaffCount: s.minStaffCount,
  }));

  return (
    <Box sx={{ overflow: "auto" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 0.5,
          mb: 0.5,
        }}
      >
        {WEEKDAYS.map((d) => (
          <Typography key={d} variant="caption" fontWeight={600} textAlign="center">
            {d}
          </Typography>
        ))}
      </Box>
      {rows.map((row, ri) => (
        <Box
          key={ri}
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 0.5,
            mb: 0.5,
          }}
        >
          {row.map((iso, ci) => {
            if (!iso) {
              return (
                <Paper
                  key={`pad-${ri}-${ci}`}
                  variant="outlined"
                  sx={{ minHeight: 88, bgcolor: "action.hover", opacity: 0.5 }}
                />
              );
            }
            const [y, m, d] = iso.split("-").map(Number);
            const dayDate = new Date(y, m - 1, d);
            const req = requiredCountsForIsoDate(iso, staffRows);
            const ass = assignedCountsForIsoDate(iso, assignments, profilesById);
            return (
              <Paper
                key={iso}
                variant="outlined"
                sx={{
                  minHeight: 88,
                  p: 0.75,
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                }}
                onClick={() => onDayClick(dayDate)}
              >
                <Typography
                  variant="subtitle2"
                  fontWeight={700}
                  component="button"
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    const monday = new Date(dayDate);
                    const day = monday.getDay();
                    const diff = day === 0 ? -6 : 1 - day;
                    monday.setDate(monday.getDate() + diff);
                    onWeekClick(getWeekNumber(monday), monday);
                  }}
                  sx={{
                    cursor: "pointer",
                    border: "none",
                    background: "none",
                    p: 0,
                    font: "inherit",
                    textAlign: "left",
                    color: "primary.main",
                    textDecoration: "underline",
                  }}
                >
                  {d}
                </Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, mt: 0.5 }}>
                  {SHIFT_KEYS.map((key) => {
                    const a = ass[key] ?? 0;
                    const r = req[key] ?? 0;
                    if (r === 0 && a === 0) return null;
                    const st = getStaffingStatus(a, r || a);
                    return (
                      <Chip
                        key={key}
                        size="small"
                        label={`${shiftTypeLabel(key).slice(0, 1)} ${a}/${r || "—"}`}
                        color={st === "success" ? "success" : st === "warning" ? "warning" : "error"}
                        sx={{ height: 20, fontSize: 10, "& .MuiChip-label": { px: 0.5 } }}
                      />
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
