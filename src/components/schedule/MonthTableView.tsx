"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { localIsoFromParts } from "@/lib/schedule/monthSchedule";
import type { AssignmentJson, EmployeeJson, ShiftProfileJson } from "@/lib/schedule/scheduleTypes";

interface MonthTableViewProps {
  year: number;
  monthIndex: number;
  assignments: AssignmentJson[];
  employees: EmployeeJson[];
  profilesById: Record<string, ShiftProfileJson>;
  onDayClick: (date: Date) => void;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export default function MonthTableView({
  year,
  monthIndex,
  assignments,
  employees,
  profilesById,
  onDayClick,
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

  return (
    <TableContainer sx={{ maxHeight: "70vh", border: 1, borderColor: "divider", borderRadius: 1 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ minWidth: 160, fontWeight: 600 }}>Mitarbeiter</TableCell>
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
          {sortedEmps.map((e) => (
            <TableRow key={e.id} hover>
              <TableCell sx={{ whiteSpace: "nowrap" }}>
                {e.firstName} {e.lastName}
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
                    {label || "—"}
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
