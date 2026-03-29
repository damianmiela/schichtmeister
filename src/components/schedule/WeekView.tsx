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
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";
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
            <TableCell sx={{ fontWeight: 600 }}>Mitarbeiter</TableCell>
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
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedEmps.map((e) => (
            <TableRow key={e.id} hover>
              <TableCell>
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
                  <QualificationPills tags={e.qualificationTags ?? []} compact />
                </Box>
              </TableCell>
              {dayIsos.map((iso) => {
                const key = `${e.id}|${iso}`;
                const pid = byEmpDay.get(key);
                const p = pid ? profilesById[pid] : undefined;
                const label = p
                  ? `${p.name} \u00B7 ${shiftTypeLabel(p.shiftType)}`
                  : "\u2014";
                const [y, m, d] = iso.split("-").map(Number);
                const isShiftWish = shiftWishSet?.has(key) && !!pid;
                const isFreiWish = freiWishSet?.has(key);
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
                      ...(isShiftWish && {
                        bgcolor: WISH_SHIFT_BG,
                        fontWeight: 700,
                      }),
                      ...(isFreiWish && {
                        bgcolor: WISH_FREI_BG,
                        fontStyle: "italic",
                      }),
                    }}
                    title={isShiftWish ? "Dienstwunsch" : isFreiWish ? "Frei-Wunsch" : undefined}
                  >
                    {isFreiWish && !pid ? "Frei" : label}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
