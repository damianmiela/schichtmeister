"use client";

import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type { AssignmentJson, EmployeeJson, ShiftProfileJson } from "@/lib/schedule/scheduleTypes";
import { weekLocalIsoDays } from "@/lib/schedule/monthSchedule";
import QualificationPills from "@/components/schedule/QualificationPills";

interface WeekViewProps {
  weekStartDate: Date;
  assignments: AssignmentJson[];
  employees: EmployeeJson[];
  profilesById: Record<string, ShiftProfileJson>;
  onDayClick: (date: Date) => void;
  onEmployeeClick?: (employeeId: string) => void;
  shiftWishSet?: Set<string>;
  freiWishSet?: Set<string>;
}

const WISH_SHIFT_BG = "#e8f5e9";
const WISH_FREI_BG = "#e3f2fd";
const NAME_COL_WIDTH = 200;

const EMP_STATUS_MAP: Record<string, string> = {
  KRANK: "K", LANGZEITKRANK: "LZ", MUTTERSCHUTZ: "MS", URLAUB: "U", KUR: "KU",
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  U: { bg: "#e3f2fd", color: "#1565c0" },
  K: { bg: "#ffebee", color: "#c62828" },
  LZ: { bg: "#fce4ec", color: "#ad1457" },
  MS: { bg: "#f3e5f5", color: "#7b1fa2" },
  KU: { bg: "#fff3e0", color: "#e65100" },
  X: { bg: "#f5f5f5", color: "#9e9e9e" },
};

function paidHoursForShift(profile: ShiftProfileJson): number {
  const [sh, sm] = profile.startTime.split(":").map(Number);
  const [eh, em] = profile.endTime.split(":").map(Number);
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return Math.max(0, (endMin - startMin - profile.breakMinutes) / 60);
}

function formatHours(h: number): string {
  return h % 1 === 0 ? String(h) : h.toFixed(1);
}

export default function WeekView({
  weekStartDate,
  assignments,
  employees,
  profilesById,
  onDayClick,
  onEmployeeClick,
  shiftWishSet,
  freiWishSet,
}: WeekViewProps) {
  const dayIsos = weekLocalIsoDays(weekStartDate);
  const byEmpDay = new Map<string, string>();
  for (const a of assignments) {
    byEmpDay.set(`${a.employeeId}|${a.date}`, a.shiftProfileId);
  }

  const sortedEmps = [...employees].sort((a, b) => {
    const ln = a.lastName.localeCompare(b.lastName, "de");
    if (ln !== 0) return ln;
    return a.firstName.localeCompare(b.firstName, "de");
  });

  return (
    <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600, width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH, maxWidth: NAME_COL_WIDTH }}>Mitarbeiter</TableCell>
            {dayIsos.map((iso) => {
              const [y, m, d] = iso.split("-").map(Number);
              const wd = new Date(y, m - 1, d).toLocaleDateString("de-DE", {
                weekday: "short",
              });
              return (
                <TableCell
                  key={iso}
                  align="center"
                  sx={{ cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
                  onClick={() => onDayClick(new Date(y, m - 1, d))}
                >
                  <Typography variant="caption" display="block" color="text.secondary">
                    {wd}
                  </Typography>
                  {d}.{m}.
                </TableCell>
              );
            })}
            <TableCell align="center" sx={{ fontWeight: 600 }}>Std</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedEmps.map((e) => (
            <TableRow key={e.id} hover>
              <TableCell sx={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH, maxWidth: NAME_COL_WIDTH, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
                    {e.lastName}, {e.firstName} ({e.targetHoursPercent ?? 100}%)
                  </Box>
                  <QualificationPills qualifications={e.qualifications} tags={e.qualificationTags ?? []} compact />
                </Box>
              </TableCell>
              {dayIsos.map((iso) => {
                const key = `${e.id}|${iso}`;
                const pid = byEmpDay.get(key);
                const p = pid ? profilesById[pid] : undefined;
                const [y, m, d] = iso.split("-").map(Number);
                const isShiftWish = shiftWishSet?.has(key) && !!pid;
                const isFreiWish = freiWishSet?.has(key);
                const statusCode = e.status && e.status !== "ACTIVE"
                  ? (EMP_STATUS_MAP[e.status] ?? e.status)
                  : null;

                let cellText: string;
                let cellStyle: Record<string, string> | undefined;
                if (statusCode) {
                  cellText = statusCode;
                  cellStyle = STATUS_COLORS[statusCode];
                } else if (p) {
                  cellText = p.name;
                } else if (isFreiWish) {
                  cellText = "Frei";
                } else {
                  cellText = "X";
                  cellStyle = STATUS_COLORS["X"];
                }

                return (
                  <TableCell
                    key={iso}
                    align="center"
                    onClick={() => onDayClick(new Date(y, m - 1, d))}
                    sx={{
                      cursor: "pointer",
                      fontSize: 12,
                      maxWidth: 140,
                      "&:hover": { bgcolor: "action.hover" },
                      ...(isShiftWish && !statusCode && {
                        bgcolor: WISH_SHIFT_BG,
                        fontWeight: 700,
                      }),
                      ...(isFreiWish && !statusCode && {
                        bgcolor: WISH_FREI_BG,
                        fontStyle: "italic",
                      }),
                      ...(cellStyle && {
                        bgcolor: cellStyle.bg,
                        color: cellStyle.color,
                      }),
                    }}
                    title={statusCode ? statusCode : isShiftWish ? "Dienstwunsch" : isFreiWish ? "Frei-Wunsch" : undefined}
                  >
                    {cellText}
                  </TableCell>
                );
              })}
              <TableCell align="center" sx={{ fontSize: 12, fontWeight: 600 }}>
                {formatHours(dayIsos.reduce((sum, iso) => {
                  const pid = byEmpDay.get(`${e.id}|${iso}`);
                  const p = pid ? profilesById[pid] : undefined;
                  return sum + (p ? paidHoursForShift(p) : 0);
                }, 0))}h
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
