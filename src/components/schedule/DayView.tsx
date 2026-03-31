"use client";

import { useMemo } from "react";
import { Box, Typography, Chip, Tooltip, alpha, useTheme } from "@mui/material";
import type {
  AssignmentJson,
  EmployeeJson,
  ShiftProfileJson,
} from "@/lib/schedule/scheduleTypes";
import { localIsoDate } from "@/lib/schedule/monthSchedule";
import QualificationPills from "@/components/schedule/QualificationPills";

interface DayViewProps {
  date: Date;
  assignments: AssignmentJson[];
  employeesById: Record<string, EmployeeJson>;
  profilesById: Record<string, ShiftProfileJson>;
  onEmployeeClick?: (employeeId: string) => void;
  shiftWishSet?: Set<string>;
  freiWishSet?: Set<string>;
}

const TIMELINE_START = 5;
const TIMELINE_END = 31;
const TOTAL_HOURS = TIMELINE_END - TIMELINE_START;
const NAME_COL = 180;
const ROW_H = 36;
const BAR_H = 28;

const SHIFT_COLORS: Record<string, string> = {
  EARLY: "#42a5f5",
  LATE: "#ff9800",
  NIGHT: "#7e57c2",
  BL: "#66bb6a",
};

const SHIFT_COLORS_ALT: Record<string, string> = {
  EARLY: "#90caf9",
  LATE: "#ffcc80",
  NIGHT: "#b39ddb",
  BL: "#a5d6a7",
};

function shiftToPosition(startTime: string, endTime: string) {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let startH = sh + sm / 60;
  let endH = eh + em / 60;
  if (endH <= startH) endH += 24;
  const left = ((startH - TIMELINE_START) / TOTAL_HOURS) * 100;
  const width = ((endH - startH) / TOTAL_HOURS) * 100;
  return {
    left: Math.max(0, left),
    width: Math.min(width, 100 - Math.max(0, left)),
  };
}

function buildGridHours() {
  const hours: number[] = [];
  for (let h = TIMELINE_START; h <= TIMELINE_END; h += 2) hours.push(h);
  return hours;
}
const GRID_HOURS = buildGridHours();

function hourLabel(h: number) {
  return (h % 24).toString().padStart(2, "0");
}

type EmpRow = {
  employeeId: string;
  employee: EmployeeJson | undefined;
  assignment: AssignmentJson;
  profile: ShiftProfileJson;
  isShiftWish: boolean;
};

type Section = { title: string; rows: EmpRow[] };

function ShiftBar({
  startTime,
  endTime,
  color,
  label,
  isShiftWish,
  onClick,
}: {
  startTime: string;
  endTime: string;
  color: string;
  label: string;
  isShiftWish: boolean;
  onClick?: () => void;
}) {
  const pos = shiftToPosition(startTime, endTime);
  return (
    <Box
      onClick={onClick}
      sx={{
        position: "absolute",
        top: (ROW_H - BAR_H) / 2,
        left: `${pos.left}%`,
        width: `${pos.width}%`,
        height: BAR_H,
        bgcolor: color,
        borderRadius: "4px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
        cursor: onClick ? "pointer" : "default",
        display: "flex",
        alignItems: "center",
        px: 0.5,
        overflow: "hidden",
        zIndex: 2,
        ...(isShiftWish && { borderLeft: "3px solid #4caf50" }),
        "&:hover": { filter: "brightness(1.1)" },
      }}
    >
      <Typography
        variant="caption"
        noWrap
        sx={{
          color: "#fff",
          fontWeight: 600,
          fontSize: 11,
          lineHeight: 1,
          textShadow: "0 1px 2px rgba(0,0,0,0.3)",
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

function EmployeeRow({
  row,
  onEmployeeClick,
}: {
  row: EmpRow;
  onEmployeeClick?: (id: string) => void;
}) {
  const { employee, profile, assignment, isShiftWish } = row;
  const color = SHIFT_COLORS[profile.shiftType] ?? "#78909c";
  const altColor = SHIFT_COLORS_ALT[profile.shiftType] ?? "#b0bec5";
  const hasSplit = !!(profile.startTime2 && profile.endTime2);

  const displayName = employee
    ? `${employee.lastName}, ${employee.firstName}`
    : assignment.employeeId;

  const barLabel = employee
    ? `${employee.lastName} (${profile.name})`
    : profile.name;

  const tags = employee?.qualificationTags ?? [];

  const tooltipContent = (
    <Box sx={{ p: 0.5 }}>
      <Typography variant="body2" fontWeight={600}>
        {employee
          ? `${employee.firstName} ${employee.lastName}`
          : assignment.employeeId}
      </Typography>
      <Typography variant="caption" display="block">
        {profile.name}: {profile.startTime}–{profile.endTime}
        {hasSplit && ` + ${profile.startTime2}–${profile.endTime2}`}
      </Typography>
      <Box sx={{ my: 0.5 }}>
        <QualificationPills
          qualifications={employee?.qualifications}
          tags={tags}
          compact
        />
      </Box>
      <Typography variant="caption" display="block" color="text.secondary">
        Station {assignment.stationNumber ?? (employee?.assignedStations?.length ? employee.assignedStations.join("+") : "–")}
      </Typography>
    </Box>
  );

  const handleClick = onEmployeeClick
    ? () => onEmployeeClick(assignment.employeeId)
    : undefined;

  return (
    <Box sx={{ display: "flex", height: ROW_H, alignItems: "center" }}>
      <Box
        sx={{
          width: NAME_COL,
          minWidth: NAME_COL,
          flexShrink: 0,
          px: 1,
          overflow: "hidden",
        }}
      >
        <Typography
          variant="body2"
          noWrap
          onClick={handleClick}
          sx={{
            fontWeight: 500,
            fontSize: 13,
            cursor: onEmployeeClick ? "pointer" : "default",
            "&:hover": onEmployeeClick
              ? { textDecoration: "underline", color: "primary.main" }
              : undefined,
          }}
        >
          {displayName}
        </Typography>
      </Box>

      <Tooltip title={tooltipContent} arrow placement="top">
        <Box sx={{ flex: 1, position: "relative", height: ROW_H }}>
          <ShiftBar
            startTime={profile.startTime}
            endTime={profile.endTime}
            color={color}
            label={barLabel}
            isShiftWish={isShiftWish}
            onClick={handleClick}
          />
          {hasSplit && (
            <ShiftBar
              startTime={profile.startTime2!}
              endTime={profile.endTime2!}
              color={altColor}
              label={barLabel}
              isShiftWish={isShiftWish}
              onClick={handleClick}
            />
          )}
        </Box>
      </Tooltip>
    </Box>
  );
}

function SectionTimeline({
  section,
  onEmployeeClick,
}: {
  section: Section;
  onEmployeeClick?: (id: string) => void;
}) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1,
          bgcolor: alpha(theme.palette.primary.main, 0.07),
          borderBottom: "1px solid",
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Typography variant="subtitle2" fontWeight={700}>
          {section.title}
        </Typography>
        <Chip
          label={`${section.rows.length} MA`}
          size="small"
          variant="outlined"
          sx={{ ml: "auto", height: 22, fontSize: "0.7rem" }}
        />
      </Box>

      {section.rows.length === 0 ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ p: 2, textAlign: "center", fontStyle: "italic" }}
        >
          Keine Schichten
        </Typography>
      ) : (
        <Box sx={{ overflowX: "auto" }}>
          <Box sx={{ minWidth: 800 }}>
            <Box
              sx={{
                display: "flex",
                height: 24,
                borderBottom: "1px solid",
                borderColor: "divider",
              }}
            >
              <Box sx={{ width: NAME_COL, minWidth: NAME_COL, flexShrink: 0 }} />
              <Box sx={{ flex: 1, position: "relative" }}>
                {GRID_HOURS.map((h) => {
                  const left =
                    ((h - TIMELINE_START) / TOTAL_HOURS) * 100;
                  return (
                    <Typography
                      key={h}
                      variant="caption"
                      sx={{
                        position: "absolute",
                        left: `${left}%`,
                        bottom: 2,
                        transform: "translateX(-50%)",
                        fontSize: 11,
                        color: "text.secondary",
                        userSelect: "none",
                      }}
                    >
                      {hourLabel(h)}
                    </Typography>
                  );
                })}
              </Box>
            </Box>

            <Box sx={{ position: "relative" }}>
              {section.rows.map((row) => (
                <EmployeeRow
                  key={row.assignment.id}
                  row={row}
                  onEmployeeClick={onEmployeeClick}
                />
              ))}

              <Box
                sx={{
                  position: "absolute",
                  top: 0,
                  left: `${NAME_COL}px`,
                  right: 0,
                  bottom: 0,
                  pointerEvents: "none",
                  zIndex: 1,
                }}
              >
                {GRID_HOURS.map((h) => {
                  const left =
                    ((h - TIMELINE_START) / TOTAL_HOURS) * 100;
                  return (
                    <Box
                      key={h}
                      sx={{
                        position: "absolute",
                        left: `${left}%`,
                        top: 0,
                        bottom: 0,
                        borderLeft: "1px dashed",
                        borderColor: "divider",
                      }}
                    />
                  );
                })}
              </Box>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}

export default function DayView({
  date,
  assignments,
  employeesById,
  profilesById,
  onEmployeeClick,
  shiftWishSet,
}: DayViewProps) {
  const iso = localIsoDate(date);

  const dayAssignments = useMemo(
    () => assignments.filter((a) => a.date === iso),
    [assignments, iso],
  );

  const sections = useMemo(() => {
    const stationRows: Record<number, EmpRow[]> = { 1: [], 2: [], 3: [] };
    const nightRows: EmpRow[] = [];

    for (const a of dayAssignments) {
      const profile = profilesById[a.shiftProfileId];
      if (!profile) continue;
      const employee = employeesById[a.employeeId];
      const isShiftWish =
        shiftWishSet?.has(`${a.employeeId}|${iso}`) ?? false;
      const row: EmpRow = {
        employeeId: a.employeeId,
        employee,
        assignment: a,
        profile,
        isShiftWish,
      };

      if (profile.shiftType === "NIGHT") {
        nightRows.push(row);
      } else {
        // Use the solver-assigned station from the assignment first,
        // fall back to the employee's profile station
        const st = a.stationNumber ?? employee?.assignedStations?.[0] ?? 1;
        (stationRows[st] ?? stationRows[1]).push(row);
      }
    }

    const sortFn = (a: EmpRow, b: EmpRow) => {
      const an = a.employee
        ? `${a.employee.lastName} ${a.employee.firstName}`
        : "";
      const bn = b.employee
        ? `${b.employee.lastName} ${b.employee.firstName}`
        : "";
      return an.localeCompare(bn, "de");
    };

    const result: Section[] = [
      { title: "Station 1", rows: stationRows[1].sort(sortFn) },
      { title: "Station 2", rows: stationRows[2].sort(sortFn) },
      { title: "Station 3", rows: stationRows[3].sort(sortFn) },
      {
        title: "Nacht (gesamtes Gebäude)",
        rows: nightRows.sort(sortFn),
      },
    ];
    return result;
  }, [dayAssignments, profilesById, employeesById, shiftWishSet, iso]);

  if (dayAssignments.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: "center" }}>
        <Typography color="text.secondary">
          Keine Zuweisungen für{" "}
          {date.toLocaleDateString("de-DE", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          .
        </Typography>
      </Box>
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

      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {sections.map((section) => (
          <SectionTimeline
            key={section.title}
            section={section}
            onEmployeeClick={onEmployeeClick}
          />
        ))}
      </Box>
    </Box>
  );
}
