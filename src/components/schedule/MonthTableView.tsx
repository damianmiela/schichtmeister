"use client";

import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import { localIsoFromParts } from "@/lib/schedule/monthSchedule";
import type { AssignmentJson, EmployeeJson, ShiftProfileJson } from "@/lib/schedule/scheduleTypes";
import QualificationPills from "@/components/schedule/QualificationPills";

interface MonthTableViewProps {
  year: number;
  monthIndex: number;
  assignments: AssignmentJson[];
  employees: EmployeeJson[];
  profilesById: Record<string, ShiftProfileJson>;
  onDayClick: (date: Date) => void;
  onEmployeeClick?: (employeeId: string) => void;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function paidHoursForShift(profile: ShiftProfileJson): number {
  const [sh, sm] = profile.startTime.split(":").map(Number);
  const [eh, em] = profile.endTime.split(":").map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return Math.max(0, (endMin - startMin - profile.breakMinutes) / 60);
}

function formatHours(h: number): string {
  return h % 1 === 0 ? String(h) : h.toFixed(1);
}

export default function MonthTableView({
  year,
  monthIndex,
  assignments,
  employees,
  profilesById,
  onDayClick,
  onEmployeeClick,
}: MonthTableViewProps) {
  const days = daysInMonth(year, monthIndex);
  const dayCols = Array.from({ length: days }, (_, i) =>
    localIsoFromParts(year, monthIndex, i + 1),
  );

  const byEmpDay = new Map<string, string>();
  for (const a of assignments) {
    byEmpDay.set(`${a.employeeId}|${a.date}`, a.shiftProfileId);
  }

  const sortedEmps = [...employees].sort((a, b) => {
    const ln = a.lastName.localeCompare(b.lastName, "de");
    if (ln !== 0) return ln;
    return a.firstName.localeCompare(b.firstName, "de");
  });

  const empPlannedHours = new Map<string, number>();
  for (const a of assignments) {
    const profile = profilesById[a.shiftProfileId];
    if (!profile) continue;
    const h = paidHoursForShift(profile);
    empPlannedHours.set(a.employeeId, (empPlannedHours.get(a.employeeId) ?? 0) + h);
  }

  return (
    <TableContainer sx={{ maxHeight: "70vh", border: 1, borderColor: "divider", borderRadius: 1 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ minWidth: 160, fontWeight: 600, position: "sticky", left: 0, zIndex: 3, bgcolor: "background.paper" }}>
              Mitarbeiter
            </TableCell>
            <TableCell
              align="center"
              sx={{ minWidth: 72, fontWeight: 600, position: "sticky", left: 160, zIndex: 3, bgcolor: "background.paper", borderRight: 1, borderColor: "divider" }}
            >
              <Tooltip title="Geplante Stunden / Soll-Stunden" arrow>
                <span>Std</span>
              </Tooltip>
            </TableCell>
            {dayCols.map((iso) => {
              const [y, m, d] = iso.split("-").map(Number);
              const wd = new Date(y, m - 1, d).toLocaleDateString("de-DE", {
                weekday: "short",
              });
              return (
                <TableCell
                  key={iso}
                  align="center"
                  sx={{
                    minWidth: 72,
                    fontWeight: 600,
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                  onClick={() => onDayClick(new Date(y, m - 1, d))}
                >
                  <Typography variant="caption" display="block" color="text.secondary">
                    {wd}
                  </Typography>
                  {d}
                </TableCell>
              );
            })}
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedEmps.map((e) => {
            const planned = empPlannedHours.get(e.id) ?? 0;
            const target = e.targetHours ?? null;
            const tags = e.qualificationTags ?? [];

            let hoursColor: string;
            if (target == null) {
              hoursColor = "text.secondary";
            } else if (planned > target * 1.05) {
              hoursColor = "error.main";
            } else if (planned < target * 0.95) {
              hoursColor = "warning.main";
            } else {
              hoursColor = "success.main";
            }

            return (
              <TableRow key={e.id} hover>
                <TableCell sx={{ whiteSpace: "nowrap", position: "sticky", left: 0, bgcolor: "background.paper", zIndex: 1 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Box
                      component="span"
                      onClick={(ev: React.MouseEvent) => {
                        ev.stopPropagation();
                        onEmployeeClick?.(e.id);
                      }}
                      sx={{
                        cursor: onEmployeeClick ? "pointer" : "default",
                        "&:hover": onEmployeeClick
                          ? { textDecoration: "underline", color: "primary.main" }
                          : undefined,
                      }}
                    >
                      {e.firstName} {e.lastName}
                    </Box>
                    <QualificationPills tags={tags} compact />
                  </Box>
                </TableCell>
                <TableCell
                  align="center"
                  sx={{
                    position: "sticky",
                    left: 160,
                    bgcolor: "background.paper",
                    zIndex: 1,
                    borderRight: 1,
                    borderColor: "divider",
                    whiteSpace: "nowrap",
                    fontSize: 11,
                  }}
                >
                  <Tooltip
                    title={
                      target != null
                        ? `Geplant: ${formatHours(planned)} h / Soll: ${formatHours(target)} h (${e.targetHoursPeriod === "WEEKLY" ? "wöchentlich" : "monatlich"})`
                        : `Geplant: ${formatHours(planned)} h (kein Soll hinterlegt)`
                    }
                    arrow
                  >
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{ color: hoursColor, fontWeight: 600 }}
                    >
                      {formatHours(planned)}{target != null ? `/${formatHours(target)}` : ""}
                    </Typography>
                  </Tooltip>
                </TableCell>
                {dayCols.map((iso) => {
                  const pid = byEmpDay.get(`${e.id}|${iso}`);
                  const label = pid ? profilesById[pid]?.name ?? "?" : "";
                  return (
                    <TableCell
                      key={iso}
                      align="center"
                      onClick={() => {
                        const [y, m, d] = iso.split("-").map(Number);
                        onDayClick(new Date(y, m - 1, d));
                      }}
                      sx={{
                        cursor: "pointer",
                        fontSize: 11,
                        color: label ? "text.primary" : "text.disabled",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      {label || "\u2014"}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
