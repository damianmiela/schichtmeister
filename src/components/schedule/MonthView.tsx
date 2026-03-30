"use client";

import { Box, Paper, Typography, Chip } from "@mui/material";
import type { AssignmentJson, ShiftProfileJson, StaffingJson } from "@/lib/schedule/scheduleTypes";
import { monthCalendarRowsLocal } from "@/lib/schedule/monthSchedule";
import {
  assignedCountsForIsoDate,
  requiredCountsForIsoDate,
} from "@/lib/schedule/staffingAggregate";
import { getWeekNumber, shiftTypeLabel } from "@/lib/schedule/viewUtils";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const SHIFT_KEYS = ["EARLY", "LATE", "NIGHT", "BL"] as const;

type StaffRowAgg = {
  shiftType: string;
  minTotalCount: number;
  maxTotalCount: number | null;
  isFacilityWide: boolean;
  stationNumber: number;
};

function minMaxForShiftType(rows: StaffRowAgg[], shiftType: string): { min: number; max: number | null } {
  let min = 0;
  let maxSum = 0;
  let n = 0;
  let everyHasMax = true;
  for (const r of rows) {
    if (r.shiftType !== shiftType) continue;
    n += 1;
    min += r.minTotalCount;
    if (r.maxTotalCount != null) maxSum += r.maxTotalCount;
    else everyHasMax = false;
  }
  return { min, max: n > 0 && everyHasMax ? maxSum : null };
}

function minMaxForFacilityWideShift(rows: StaffRowAgg[], shiftType: string): { min: number; max: number | null } {
  let min = 0;
  let maxSum = 0;
  let n = 0;
  let everyHasMax = true;
  for (const r of rows) {
    if (r.shiftType !== shiftType || !r.isFacilityWide) continue;
    n += 1;
    min += r.minTotalCount;
    if (r.maxTotalCount != null) maxSum += r.maxTotalCount;
    else everyHasMax = false;
  }
  return { min, max: n > 0 && everyHasMax ? maxSum : null };
}

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
  const staffRows: StaffRowAgg[] = staffing.map((s) => ({
    shiftType: s.shiftType,
    minTotalCount: s.minTotalCount,
    maxTotalCount: s.maxTotalCount ?? null,
    isFacilityWide: s.isFacilityWide ?? false,
    stationNumber: s.stationNumber,
  }));
  const req = requiredCountsForIsoDate("", staffRows);
  const hasFwNight = staffRows.some((r) => r.shiftType === "NIGHT" && r.isFacilityWide);
  const nightMM = hasFwNight
    ? minMaxForFacilityWideShift(staffRows, "NIGHT")
    : minMaxForShiftType(staffRows, "NIGHT");
  const earlyMM = minMaxForShiftType(staffRows, "EARLY");
  const lateMM = minMaxForShiftType(staffRows, "LATE");
  const blMM = minMaxForShiftType(staffRows, "BL");

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
                    let min: number;
                    let maxForType: number | null;
                    if (key === "NIGHT") {
                      min = nightMM.min;
                      maxForType = nightMM.max;
                    } else if (key === "EARLY") {
                      min = req[key] ?? 0;
                      maxForType = earlyMM.max;
                    } else if (key === "LATE") {
                      min = req[key] ?? 0;
                      maxForType = lateMM.max;
                    } else {
                      min = req[key] ?? 0;
                      maxForType = blMM.max;
                    }
                    if (min === 0 && a === 0) return null;
                    const assigned = a;
                    const max = maxForType;
                    let chipColor: "success" | "warning" | "error";
                    if (assigned < min) chipColor = "error";
                    else if (max != null && assigned > max) chipColor = "warning";
                    else chipColor = "success";
                    const label = `${shiftTypeLabel(key).slice(0, 1)} ${a}/${
                      max != null ? `${min}–${max}` : String(min)
                    }`;
                    return (
                      <Chip
                        key={key}
                        size="small"
                        label={label}
                        color={chipColor}
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
