"use client";

import { useState } from "react";
import {
  Box,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  Divider,
} from "@mui/material";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
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
  shiftWishSet?: Set<string>;
  freiWishSet?: Set<string>;
  editMode?: boolean;
  editedAssignments?: Map<string, string | null>;
  onCellChange?: (employeeId: string, date: string, shiftProfileId: string | null) => void;
  shiftProfiles?: ShiftProfileJson[];
  onToggleWish?: (employeeId: string, date: string, type: "shift" | "frei") => void;
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

const FULL_TIME_DAILY_HOURS = 8;

function workingDaysInMonth(year: number, monthIndex: number): number {
  const totalDays = new Date(year, monthIndex + 1, 0).getDate();
  let count = 0;
  for (let d = 1; d <= totalDays; d++) {
    const dow = new Date(year, monthIndex, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function monthlyTargetForMonth(
  employee: EmployeeJson,
  year: number,
  monthIndex: number,
): number | null {
  if (employee.targetHours == null) return null;
  const wd = workingDaysInMonth(year, monthIndex);
  if (employee.targetHoursPercent != null && employee.targetHoursPercent > 0) {
    return (employee.targetHoursPercent / 100) * FULL_TIME_DAILY_HOURS * wd;
  }
  if (employee.targetHoursPeriod === "WEEKLY") {
    return (employee.targetHours / 5) * wd;
  }
  const AVG_WORKING_DAYS_PER_MONTH = 21.75;
  return employee.targetHours * (wd / AVG_WORKING_DAYS_PER_MONTH);
}

const WISH_SHIFT_BG = "#e8f5e9";
const WISH_FREI_BG = "#e3f2fd";
const EDIT_CHANGED_BORDER = "2px dashed #ff9800";

export default function MonthTableView({
  year,
  monthIndex,
  assignments,
  employees,
  profilesById,
  onDayClick,
  onEmployeeClick,
  shiftWishSet,
  freiWishSet,
  editMode,
  editedAssignments,
  onCellChange,
  shiftProfiles,
  onToggleWish,
}: MonthTableViewProps) {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuCell, setMenuCell] = useState<{ empId: string; iso: string } | null>(null);
  const [ctxAnchor, setCtxAnchor] = useState<{ el: HTMLElement; empId: string; iso: string } | null>(null);

  const days = daysInMonth(year, monthIndex);
  const workDays = workingDaysInMonth(year, monthIndex);
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

  const effectivePid = (empId: string, iso: string): string | null => {
    const key = `${empId}|${iso}`;
    if (editMode && editedAssignments?.has(key)) {
      return editedAssignments.get(key) ?? null;
    }
    return byEmpDay.get(key) ?? null;
  };

  const empPlannedHours = new Map<string, number>();
  if (editMode && editedAssignments) {
    const seen = new Set<string>();
    for (const [key, pid] of editedAssignments) {
      seen.add(key);
      if (pid) {
        const p = profilesById[pid];
        if (p) {
          const eid = key.split("|")[0]!;
          empPlannedHours.set(eid, (empPlannedHours.get(eid) ?? 0) + paidHoursForShift(p));
        }
      }
    }
    for (const a of assignments) {
      const key = `${a.employeeId}|${a.date}`;
      if (!seen.has(key)) {
        const p = profilesById[a.shiftProfileId];
        if (p) {
          empPlannedHours.set(a.employeeId, (empPlannedHours.get(a.employeeId) ?? 0) + paidHoursForShift(p));
        }
      }
    }
  } else {
    for (const a of assignments) {
      const profile = profilesById[a.shiftProfileId];
      if (!profile) continue;
      const h = paidHoursForShift(profile);
      empPlannedHours.set(a.employeeId, (empPlannedHours.get(a.employeeId) ?? 0) + h);
    }
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
            const target = monthlyTargetForMonth(e, year, monthIndex);
            const tags = e.qualificationTags ?? [];
            const pct = target != null && target > 0 ? Math.round((planned / target) * 100) : null;

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
                    <QualificationPills qualifications={e.qualifications} tags={tags} compact />
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
                        ? `Geplant: ${formatHours(planned)} h / Soll: ${formatHours(target)} h (${e.targetHoursPercent ?? 100}% × ${workDays} Arbeitstage × ${FULL_TIME_DAILY_HOURS} h)`
                        : `Geplant: ${formatHours(planned)} h (kein Soll hinterlegt)`
                    }
                    arrow
                  >
                    <Box sx={{ lineHeight: 1.2 }}>
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ color: hoursColor, fontWeight: 600 }}
                      >
                        {formatHours(planned)}{target != null ? `/${formatHours(target)}` : ""}
                      </Typography>
                      {pct != null && (
                        <Typography
                          display="block"
                          variant="caption"
                          sx={{ color: hoursColor, fontSize: 9, fontWeight: 500, lineHeight: 1 }}
                        >
                          ({pct}%)
                        </Typography>
                      )}
                    </Box>
                  </Tooltip>
                </TableCell>
                {dayCols.map((iso) => {
                  const key = `${e.id}|${iso}`;
                  const pid = effectivePid(e.id, iso);
                  const label = pid ? profilesById[pid]?.name ?? "?" : "";
                  const isShiftWish = shiftWishSet?.has(key) && !!pid;
                  const isFreiWish = freiWishSet?.has(key);
                  const isChanged = editMode && editedAssignments?.has(key);
                  return (
                    <Tooltip
                      key={iso}
                      title={
                        isShiftWish
                          ? "Dienstwunsch"
                          : isFreiWish
                            ? "Frei-Wunsch"
                            : ""
                      }
                      arrow
                      disableHoverListener={!isShiftWish && !isFreiWish}
                    >
                      <TableCell
                        align="center"
                        onClick={(ev) => {
                          if (editMode) {
                            setMenuCell({ empId: e.id, iso });
                            setMenuAnchor(ev.currentTarget);
                          } else {
                            const [y, m, d] = iso.split("-").map(Number);
                            onDayClick(new Date(y, m - 1, d));
                          }
                        }}
                        onContextMenu={(ev) => {
                          if (editMode && onToggleWish) {
                            ev.preventDefault();
                            setCtxAnchor({ el: ev.currentTarget, empId: e.id, iso });
                          }
                        }}
                        sx={{
                          cursor: "pointer",
                          fontSize: 11,
                          color: label ? "text.primary" : "text.disabled",
                          "&:hover": { bgcolor: "action.hover" },
                          ...(isShiftWish && {
                            bgcolor: WISH_SHIFT_BG,
                            fontWeight: 700,
                          }),
                          ...(isFreiWish && {
                            bgcolor: WISH_FREI_BG,
                            fontStyle: "italic",
                          }),
                          ...(isChanged && {
                            border: EDIT_CHANGED_BORDER,
                          }),
                        }}
                      >
                        {isFreiWish && !pid ? "Frei" : label || "\u2014"}
                      </TableCell>
                    </Tooltip>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Shift selection menu (left-click in edit mode) */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor) && Boolean(menuCell)}
        onClose={() => { setMenuAnchor(null); setMenuCell(null); }}
        slotProps={{ paper: { sx: { maxHeight: 320 } } }}
      >
        {shiftProfiles?.map((p) => (
          <MenuItem
            key={p.id}
            dense
            selected={menuCell ? effectivePid(menuCell.empId, menuCell.iso) === p.id : false}
            onClick={() => {
              if (menuCell && onCellChange) onCellChange(menuCell.empId, menuCell.iso, p.id);
              setMenuAnchor(null);
              setMenuCell(null);
            }}
          >
            {p.name}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem
          dense
          onClick={() => {
            if (menuCell && onCellChange) onCellChange(menuCell.empId, menuCell.iso, null);
            setMenuAnchor(null);
            setMenuCell(null);
          }}
        >
          <ListItemIcon><RemoveCircleOutlineIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText>Entfernen</ListItemText>
        </MenuItem>
      </Menu>

      {/* Context menu for wish marking (right-click in edit mode) */}
      <Menu
        anchorEl={ctxAnchor?.el ?? null}
        open={Boolean(ctxAnchor)}
        onClose={() => setCtxAnchor(null)}
      >
        <MenuItem
          dense
          onClick={() => {
            if (ctxAnchor && onToggleWish) onToggleWish(ctxAnchor.empId, ctxAnchor.iso, "shift");
            setCtxAnchor(null);
          }}
        >
          {ctxAnchor && shiftWishSet?.has(`${ctxAnchor.empId}|${ctxAnchor.iso}`)
            ? "Dienstwunsch entfernen"
            : "Als Dienstwunsch markieren"}
        </MenuItem>
        <MenuItem
          dense
          onClick={() => {
            if (ctxAnchor && onToggleWish) onToggleWish(ctxAnchor.empId, ctxAnchor.iso, "frei");
            setCtxAnchor(null);
          }}
        >
          {ctxAnchor && freiWishSet?.has(`${ctxAnchor.empId}|${ctxAnchor.iso}`)
            ? "Frei-Wunsch entfernen"
            : "Als Frei-Wunsch markieren"}
        </MenuItem>
      </Menu>
    </TableContainer>
  );
}
