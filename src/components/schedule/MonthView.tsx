"use client";

import { useMemo } from "react";
import { Box, Paper, Tooltip, Typography } from "@mui/material";
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
  if (emp?.mainStation != null) return emp.mainStation;
  if (emp?.assignedStations?.length === 1) return emp.assignedStations[0]!;
  return null;
}

// Station colors
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
      if (!a.shiftProfileId) continue;
      const prof = profilesById[a.shiftProfileId];
      if (!prof) continue;
      const st = prof.shiftType;
      const station = resolveStation(a, employeesById);

      if (st === "NIGHT" || st === "BL") {
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

  // Render staffing data for a single day cell
  function renderDayContent(iso: string) {
    const dayData = dayCounts.get(iso) ?? {};
    const rows: React.ReactNode[] = [];

    // Per-station rows
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

      rows.push(
        <Box
          key={`st${st}`}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            py: "1px",
          }}
        >
          <Typography
            component="span"
            sx={{
              fontWeight: 700,
              fontSize: { xs: 8, sm: 10, md: 11 },
              color: STATION_COLORS[st] ?? "text.primary",
              minWidth: 22,
              lineHeight: 1,
            }}
          >
            S{st}
          </Typography>
          <Box
            component="span"
            sx={{
              fontSize: { xs: 8, sm: 10, md: 11 },
              fontWeight: 600,
              color: earlyOk ? "success.main" : "error.main",
              minWidth: 28,
            }}
          >
            F {earlyCount}/{earlyMin}
          </Box>
          <Box
            component="span"
            sx={{
              fontSize: { xs: 8, sm: 10, md: 11 },
              fontWeight: 600,
              color: lateOk ? "success.main" : "error.main",
              minWidth: 28,
            }}
          >
            S {lateCount}/{lateMin}
          </Box>
        </Box>,
      );
    }

    // Night row (facility-wide)
    const nightCount = dayData["NIGHT:fw"] ?? 0;
    const nightReq = stationReqs["NIGHT:fw"];
    const nightMin = nightReq?.min ?? 0;
    if (nightMin > 0 || nightCount > 0) {
      const nightOk = nightCount >= nightMin;
      rows.push(
        <Box
          key="night"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            py: "1px",
            borderTop: rows.length > 0 ? "1px solid" : "none",
            borderColor: "divider",
            mt: rows.length > 0 ? "2px" : 0,
            pt: rows.length > 0 ? "3px" : "1px",
          }}
        >
          <Typography
            component="span"
            sx={{
              fontWeight: 700,
              fontSize: { xs: 8, sm: 10, md: 11 },
              color: "#7e57c2",
              minWidth: 22,
              lineHeight: 1,
            }}
          >
            N
          </Typography>
          <Box
            component="span"
            sx={{
              fontSize: { xs: 8, sm: 10, md: 11 },
              fontWeight: 600,
              color: nightOk ? "success.main" : "error.main",
            }}
          >
            {nightCount}/{nightMin}
          </Box>
        </Box>,
      );
    }

    // BL row (facility-wide)
    const blCount = dayData["BL:fw"] ?? 0;
    const blReq = stationReqs["BL:fw"];
    const blMin = blReq?.min ?? 0;
    if (blMin > 0 || blCount > 0) {
      const blOk = blCount >= blMin;
      rows.push(
        <Box
          key="bl"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            py: "1px",
          }}
        >
          <Typography
            component="span"
            sx={{
              fontWeight: 700,
              fontSize: { xs: 8, sm: 10, md: 11 },
              color: "#66bb6a",
              minWidth: 22,
              lineHeight: 1,
            }}
          >
            BL
          </Typography>
          <Box
            component="span"
            sx={{
              fontSize: { xs: 8, sm: 10, md: 11 },
              fontWeight: 600,
              color: blOk ? "success.main" : "error.main",
            }}
          >
            {blCount}/{blMin}
          </Box>
        </Box>,
      );
    }

    return rows;
  }

  return (
    <Box sx={{ overflow: "auto" }}>
      {/* Weekday header */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 0.5,
          mb: 0.5,
        }}
      >
        {WEEKDAYS.map((d) => (
          <Typography key={d} variant="caption" fontWeight={700} textAlign="center" sx={{ fontSize: 13 }}>
            {d}
          </Typography>
        ))}
      </Box>

      {/* Calendar rows */}
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
                  sx={{ minHeight: { xs: 70, sm: 90, md: 110 }, bgcolor: "action.hover", opacity: 0.4 }}
                />
              );
            }
            const [y, m, d] = iso.split("-").map(Number);
            const dayDate = new Date(y, m - 1, d);
            const holidayName = holidayMap?.get(iso);
            const dayOfWeek = dayDate.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

            const cell = (
              <Paper
                key={iso}
                variant="outlined"
                sx={{
                  minHeight: { xs: 70, sm: 90, md: 110 },
                  p: 1,
                  cursor: "pointer",
                  transition: "background-color 0.15s",
                  "&:hover": { bgcolor: "action.hover" },
                  ...(holidayName
                    ? { bgcolor: "#fff5f5", borderColor: "error.200" }
                    : isWeekend
                    ? { bgcolor: "#fafafa" }
                    : {}),
                }}
                onClick={() => onDayClick(dayDate)}
              >
                {/* Day number */}
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
                  <Typography
                    variant="body2"
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
                      fontWeight: 700,
                      fontSize: 14,
                      color: holidayName ? "error.main" : isWeekend ? "text.secondary" : "primary.main",
                      textDecoration: "underline",
                      textDecorationColor: "transparent",
                      "&:hover": { textDecorationColor: "currentcolor" },
                    }}
                  >
                    {d}
                  </Typography>
                  {holidayName && (
                    <Typography variant="caption" sx={{ fontSize: 9, color: "error.main", fontWeight: 500 }}>
                      Feiertag
                    </Typography>
                  )}
                </Box>

                {/* Staffing data */}
                <Box sx={{ display: "flex", flexDirection: "column" }}>
                  {renderDayContent(iso)}
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
