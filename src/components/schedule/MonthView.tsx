"use client";

import { useMemo } from "react";
import { Box, Paper, Tooltip, Typography, Chip } from "@mui/material";
import type { AssignmentJson, EmployeeJson, ShiftProfileJson, StaffingJson } from "@/lib/schedule/scheduleTypes";
import { monthCalendarRowsLocal } from "@/lib/schedule/monthSchedule";
import { getWeekNumber } from "@/lib/schedule/viewUtils";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

type StaffRowAgg = {
  shiftType: string;
  minTotalCount: number;
  maxTotalCount: number | null;
  isFacilityWide: boolean;
  stationNumber: number;
};

interface MonthViewProps {
  year: number;
  monthIndex: number;
  assignments: AssignmentJson[];
  employees: EmployeeJson[];
  profilesById: Record<string, ShiftProfileJson>;
  staffing: StaffingJson[];
  onWeekClick: (weekNumber: number, startDate: Date) => void;
  onDayClick: (date: Date) => void;
  holidayMap?: Map<string, string>;
}

// Resolve the effective station for an assignment
function resolveStation(
  a: AssignmentJson,
  employeesById: Record<string, EmployeeJson>,
): number | null {
  if (a.stationNumber != null) return a.stationNumber;
  const emp = employeesById[a.employeeId];
  if (emp?.assignedStations?.length === 1) return emp.assignedStations[0]!;
  return null;
}

// Station colors for visual distinction
const STATION_COLORS: Record<number, string> = {
  1: "#1565c0",
  2: "#2e7d32",
  3: "#e65100",
};

export default function MonthView({
  year,
  monthIndex,
  assignments,
  employees,
  profilesById,
  staffing,
  onWeekClick,
  onDayClick,
  holidayMap,
}: MonthViewProps) {
  const rows = monthCalendarRowsLocal(year, monthIndex);

  const employeesById = useMemo(
    () => Object.fromEntries(employees.map((e) => [e.id, e])),
    [employees],
  );

  const staffRows: StaffRowAgg[] = staffing.map((s) => ({
    shiftType: s.shiftType,
    minTotalCount: s.minTotalCount,
    maxTotalCount: s.maxTotalCount ?? null,
    isFacilityWide: s.isFacilityWide ?? false,
    stationNumber: s.stationNumber,
  }));

  // Pre-compute station-specific requirements
  const stationReqs = useMemo(() => {
    const reqs: Record<string, { min: number; max: number | null }> = {};
    for (const sr of staffRows) {
      if (sr.isFacilityWide) {
        const key = `${sr.shiftType}:fw`;
        const prev = reqs[key] ?? { min: 0, max: null as number | null };
        reqs[key] = {
          min: prev.min + sr.minTotalCount,
          max: sr.maxTotalCount != null
            ? (prev.max ?? 0) + sr.maxTotalCount
            : prev.max,
        };
      } else {
        const key = `${sr.shiftType}:${sr.stationNumber}`;
        reqs[key] = {
          min: sr.minTotalCount,
          max: sr.maxTotalCount,
        };
      }
    }
    return reqs;
  }, [staffRows]);

  // Compute station numbers from staffing
  const stations = useMemo(() => {
    const s = new Set<number>();
    for (const sr of staffRows) {
      if (!sr.isFacilityWide && sr.stationNumber) s.add(sr.stationNumber);
    }
    return [...s].sort();
  }, [staffRows]);

  // Assigned counts per day, per station, per shift type
  const dayCounts = useMemo(() => {
    const counts = new Map<string, Record<string, number>>();
    for (const a of assignments) {
      const prof = profilesById[a.shiftProfileId];
      if (!prof) continue;
      const st = prof.shiftType;
      const station = resolveStation(a, employeesById);

      if (st === "NIGHT" || st === "BL") {
        // Facility-wide
        const key = `${a.date}|${st}:fw`;
        const prev = counts.get(a.date) ?? {};
        prev[`${st}:fw`] = (prev[`${st}:fw`] ?? 0) + 1;
        counts.set(a.date, prev);
      } else if (station != null) {
        const prev = counts.get(a.date) ?? {};
        prev[`${st}:${station}`] = (prev[`${st}:${station}`] ?? 0) + 1;
        counts.set(a.date, prev);
      }
    }
    return counts;
  }, [assignments, profilesById, employeesById]);

  // Render station-grouped chips for a day
  function renderDayChips(iso: string) {
    const dayData = dayCounts.get(iso) ?? {};

    const chips: React.ReactNode[] = [];

    // Per station: Early + Late combined
    for (const st of stations) {
      const earlyKey = `EARLY:${st}`;
      const lateKey = `LATE:${st}`;
      const earlyCount = dayData[earlyKey] ?? 0;
      const lateCount = dayData[lateKey] ?? 0;
      const earlyReq = stationReqs[earlyKey];
      const lateReq = stationReqs[lateKey];
      const earlyMin = earlyReq?.min ?? 0;
      const lateMin = lateReq?.min ?? 0;

      if (earlyMin === 0 && lateMin === 0 && earlyCount === 0 && lateCount === 0) continue;

      const earlyOk = earlyCount >= earlyMin;
      const lateOk = lateCount >= lateMin;
      const allOk = earlyOk && lateOk;

      chips.push(
        <Box
          key={`st${st}`}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.25,
            fontSize: 9,
            lineHeight: 1,
          }}
        >
          <Box
            component="span"
            sx={{
              fontWeight: 700,
              color: STATION_COLORS[st] ?? "text.primary",
              minWidth: 18,
            }}
          >
            S{st}
          </Box>
          <Chip
            size="small"
            label={`F${earlyCount}/${earlyMin}`}
            color={earlyOk ? "success" : "error"}
            sx={{ height: 16, fontSize: 9, "& .MuiChip-label": { px: 0.3 } }}
          />
          <Chip
            size="small"
            label={`S${lateCount}/${lateMin}`}
            color={lateOk ? "success" : "error"}
            sx={{ height: 16, fontSize: 9, "& .MuiChip-label": { px: 0.3 } }}
          />
        </Box>,
      );
    }

    // Night (facility-wide)
    const nightCount = dayData["NIGHT:fw"] ?? 0;
    const nightReq = stationReqs["NIGHT:fw"];
    const nightMin = nightReq?.min ?? 0;
    if (nightMin > 0 || nightCount > 0) {
      chips.push(
        <Chip
          key="night"
          size="small"
          label={`N ${nightCount}/${nightMin}`}
          color={nightCount >= nightMin ? "success" : "error"}
          sx={{ height: 16, fontSize: 9, "& .MuiChip-label": { px: 0.3 } }}
        />,
      );
    }

    // BL (facility-wide)
    const blCount = dayData["BL:fw"] ?? 0;
    const blReq = stationReqs["BL:fw"];
    const blMin = blReq?.min ?? 0;
    if (blMin > 0 || blCount > 0) {
      chips.push(
        <Chip
          key="bl"
          size="small"
          label={`B ${blCount}/${blMin}`}
          color={blCount >= blMin ? "success" : "error"}
          sx={{ height: 16, fontSize: 9, "& .MuiChip-label": { px: 0.3 } }}
        />,
      );
    }

    return chips;
  }

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
                  sx={{ minHeight: 100, bgcolor: "action.hover", opacity: 0.5 }}
                />
              );
            }
            const [y, m, d] = iso.split("-").map(Number);
            const dayDate = new Date(y, m - 1, d);
            const holidayName = holidayMap?.get(iso);
            const cell = (
              <Paper
                key={iso}
                variant="outlined"
                sx={{
                  minHeight: 100,
                  p: 0.75,
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                  ...(holidayName ? { bgcolor: "error.50", borderColor: "error.200" } : {}),
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
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.3, mt: 0.5 }}>
                  {renderDayChips(iso)}
                </Box>
              </Paper>
            );
            return holidayName ? (
              <Tooltip key={`hol-${iso}`} title={holidayName} arrow>
                {cell}
              </Tooltip>
            ) : (
              cell
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
