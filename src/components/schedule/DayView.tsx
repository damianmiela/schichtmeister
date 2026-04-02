"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Typography,
  Chip,
  Tooltip,
  alpha,
  useTheme,
  ToggleButtonGroup,
  ToggleButton,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from "@mui/material";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import TimelineIcon from "@mui/icons-material/Timeline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import AddIcon from "@mui/icons-material/Add";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import CloseIcon from "@mui/icons-material/Close";
import AssignEmployeeModal from "@/components/schedule/AssignEmployeeModal";
import type { AssignModalMode } from "@/components/schedule/AssignEmployeeModal";
import type {
  AssignmentJson,
  EmployeeJson,
  ShiftProfileJson,
  StaffingJson,
} from "@/lib/schedule/scheduleTypes";
import { localIsoDate } from "@/lib/schedule/monthSchedule";
import QualificationPills from "@/components/schedule/QualificationPills";

interface DayViewProps {
  date: Date;
  assignments: AssignmentJson[];
  employeesById: Record<string, EmployeeJson>;
  profilesById: Record<string, ShiftProfileJson>;
  staffing?: StaffingJson[];
  onEmployeeClick?: (employeeId: string) => void;
  shiftWishSet?: Set<string>;
  freiWishSet?: Set<string>;
  /** Required for add/replace/remove features */
  scheduleId?: string;
  /** Called after assignment mutation to refresh data */
  onAssignmentChange?: () => void;
}

type DayViewMode = "columns" | "timeline";

// ── Shared types ──

type EmpRow = {
  employeeId: string;
  employee: EmployeeJson | undefined;
  assignment: AssignmentJson;
  profile: ShiftProfileJson;
  isShiftWish: boolean;
};

// ── Station colors ──

const STATION_COLORS: Record<number, { main: string; light: string }> = {
  1: { main: "#1565c0", light: "#e3f2fd" },
  2: { main: "#2e7d32", light: "#e8f5e9" },
  3: { main: "#e65100", light: "#fff3e0" },
};

const SHIFT_TYPE_COLORS: Record<string, string> = {
  EARLY: "#42a5f5",
  LATE: "#ff9800",
  NIGHT: "#7e57c2",
  BL: "#66bb6a",
};

const SHIFT_LABELS: Record<string, string> = {
  EARLY: "Früh",
  LATE: "Spät",
  NIGHT: "Nacht",
  BL: "BL",
};

// ══════════════════════════════════════════════════════════
//  COLUMN VIEW (default) – requirement slots
// ══════════════════════════════════════════════════════════

type QualReq = { qualificationTag: string; minCount: number };

/** Check if employee has at least one of the required qualification tags.
 *  qualificationTag is comma-separated (e.g. "APH,KPH,PH" means any of those). */
function employeeMatchesTag(emp: EmployeeJson | undefined, qualTag: string): boolean {
  if (!emp?.qualificationTags?.length) return false;
  const required = qualTag.split(",").map((t) => t.trim());
  return required.some((rt) => emp.qualificationTags!.includes(rt));
}

/** Format a comma-separated qualificationTag for display: "APH,KPH,PH" → "APH / KPH / PH" */
function formatQualTag(qualTag: string): string {
  return qualTag.split(",").map((t) => t.trim()).join(" / ");
}

/** Match employees to qualification-requirement slots for a shift group */
function matchSlots(
  rows: EmpRow[],
  qualReqs: QualReq[],
) {
  // Build slots: one per required qualification x minCount
  type Slot = { tag: string; displayTag: string; filled: EmpRow | null };
  const slots: Slot[] = [];
  for (const qr of qualReqs) {
    for (let i = 0; i < qr.minCount; i++) {
      slots.push({ tag: qr.qualificationTag, displayTag: formatQualTag(qr.qualificationTag), filled: null });
    }
  }

  const used = new Set<string>(); // assignment ids already slotted

  // Greedily fill slots (SH employees are excluded — they don't fill requirement slots)
  for (const slot of slots) {
    const match = rows.find(
      (r) =>
        !used.has(r.assignment.id) &&
        !r.employee?.qualificationTags?.includes("SH") &&
        employeeMatchesTag(r.employee, slot.tag),
    );
    if (match) {
      slot.filled = match;
      used.add(match.assignment.id);
    }
  }

  // Remaining employees (not slotted into a qual requirement)
  const extra = rows.filter((r) => !used.has(r.assignment.id));

  return { slots, extra };
}

function ColumnView({
  dayAssignments,
  employeesById,
  profilesById,
  staffing,
  onEmployeeClick,
  date,
  scheduleId,
  allProfiles,
  onAssignmentChange,
}: {
  dayAssignments: AssignmentJson[];
  employeesById: Record<string, EmployeeJson>;
  profilesById: Record<string, ShiftProfileJson>;
  staffing?: StaffingJson[];
  onEmployeeClick?: (employeeId: string) => void;
  date: Date;
  scheduleId?: string;
  allProfiles?: ShiftProfileJson[];
  onAssignmentChange?: () => void;
}) {
  // ── Modal state for add / replace ──
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<AssignModalMode>("add");
  const [modalShiftType, setModalShiftType] = useState("EARLY");
  const [modalStation, setModalStation] = useState<number | null>(null);
  const [modalReplaceId, setModalReplaceId] = useState<string | undefined>(undefined);
  const [modalReplaceName, setModalReplaceName] = useState<string | undefined>(undefined);

  // ── Remove confirmation dialog state ──
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{
    assignmentId: string;
    employeeName: string;
    shiftLabel: string;
    stationLabel: string;
  } | null>(null);
  const [removing, setRemoving] = useState(false);

  const openAddModal = useCallback(
    (shiftType: string, stationNum: number | null) => {
      setModalMode("add");
      setModalShiftType(shiftType);
      setModalStation(stationNum);
      setModalReplaceId(undefined);
      setModalReplaceName(undefined);
      setModalOpen(true);
    },
    [],
  );

  const openReplaceModal = useCallback(
    (row: EmpRow, stationNum: number | null) => {
      setModalMode("replace");
      setModalShiftType(row.profile.shiftType);
      setModalStation(stationNum);
      setModalReplaceId(row.assignment.id);
      const name = row.employee
        ? `${row.employee.firstName} ${row.employee.lastName}`
        : row.employeeId.slice(0, 8);
      setModalReplaceName(name);
      setModalOpen(true);
    },
    [],
  );

  const handleRemoveClick = useCallback(
    (row: EmpRow, shiftLabel: string, stationLabel: string) => {
      const name = row.employee
        ? `${row.employee.firstName} ${row.employee.lastName}`
        : row.employeeId.slice(0, 8);
      setRemoveTarget({
        assignmentId: row.assignment.id,
        employeeName: name,
        shiftLabel,
        stationLabel,
      });
      setRemoveDialogOpen(true);
    },
    [],
  );

  const handleRemoveConfirm = useCallback(async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/assignments/${removeTarget.assignmentId}`, {
        method: "DELETE",
      });
      if (res.ok || res.status === 204) {
        onAssignmentChange?.();
      }
    } finally {
      setRemoving(false);
      setRemoveDialogOpen(false);
      setRemoveTarget(null);
    }
  }, [removeTarget, onAssignmentChange]);

  const canEdit = !!scheduleId;
  // Group by station and shift type
  const { stationData, nightRows } = useMemo(() => {
    const stations: Record<number, { early: EmpRow[]; late: EmpRow[]; bl: EmpRow[] }> = {
      1: { early: [], late: [], bl: [] },
      2: { early: [], late: [], bl: [] },
      3: { early: [], late: [], bl: [] },
    };
    const nights: EmpRow[] = [];

    for (const a of dayAssignments) {
      const profile = profilesById[a.shiftProfileId];
      if (!profile) continue;
      const employee = employeesById[a.employeeId];
      const row: EmpRow = {
        employeeId: a.employeeId,
        employee,
        assignment: a,
        profile,
        isShiftWish: false,
      };

      if (profile.shiftType === "NIGHT") {
        nights.push(row);
      } else {
        const st = a.stationNumber ?? employee?.assignedStations?.[0] ?? 1;
        const bucket = stations[st] ?? stations[1];
        if (profile.shiftType === "EARLY") bucket!.early.push(row);
        else if (profile.shiftType === "LATE") bucket!.late.push(row);
        else if (profile.shiftType === "BL") bucket!.bl.push(row);
      }
    }

    const sortFn = (a: EmpRow, b: EmpRow) => {
      const an = a.employee ? `${a.employee.lastName} ${a.employee.firstName}` : "";
      const bn = b.employee ? `${b.employee.lastName} ${b.employee.firstName}` : "";
      return an.localeCompare(bn, "de");
    };
    for (const st of Object.values(stations)) {
      st.early.sort(sortFn);
      st.late.sort(sortFn);
      st.bl.sort(sortFn);
    }
    nights.sort(sortFn);

    return { stationData: stations, nightRows: nights };
  }, [dayAssignments, employeesById, profilesById]);

  // Build lookup: staffing requirements keyed by "shiftType:stationNumber" or "shiftType:fw"
  const reqMap = useMemo(() => {
    const m = new Map<string, StaffingJson>();
    for (const s of staffing ?? []) {
      const key = s.isFacilityWide ? `${s.shiftType}:fw` : `${s.shiftType}:${s.stationNumber}`;
      m.set(key, s);
    }
    return m;
  }, [staffing]);

  // ── Shared inline pills for qualification + shift type ──
  const renderInfoPills = (row: EmpRow) => {
    const shiftColor = SHIFT_TYPE_COLORS[row.profile.shiftType] ?? "#78909c";
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, ml: 1, flexShrink: 0 }}>
        <QualificationPills qualifications={row.employee?.qualifications} tags={row.employee?.qualificationTags ?? []} compact />
        <Box sx={{ width: "1px", height: 14, bgcolor: "divider", mx: 0.25 }} />
        <Chip
          label={row.profile.name}
          size="small"
          sx={{
            height: 20,
            fontSize: 10,
            fontWeight: 600,
            bgcolor: alpha(shiftColor, 0.15),
            color: shiftColor,
            "& .MuiChip-label": { px: 0.5 },
          }}
        />
      </Box>
    );
  };

  // ── Hover action buttons for pills ──
  const renderHoverActions = (row: EmpRow, stationNum: number | null, shiftLabel: string, stationLabel: string) => {
    if (!canEdit) return null;
    return (
      <Box
        className="pill-hover-actions"
        sx={{
          display: "none",
          position: "absolute",
          right: 4,
          top: "50%",
          transform: "translateY(-50%)",
          gap: 0.25,
          alignItems: "center",
          zIndex: 3,
        }}
      >
        <Tooltip title="Ersetzen" arrow>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); openReplaceModal(row, stationNum); }}
            sx={{ p: 0.25, bgcolor: "background.paper", boxShadow: 1, "&:hover": { bgcolor: "primary.50" } }}
          >
            <SwapHorizIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Entfernen" arrow>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); handleRemoveClick(row, shiftLabel, stationLabel); }}
            sx={{ p: 0.25, bgcolor: "background.paper", boxShadow: 1, "&:hover": { bgcolor: "error.50" } }}
          >
            <CloseIcon sx={{ fontSize: 16, color: "error.main" }} />
          </IconButton>
        </Tooltip>
      </Box>
    );
  };

  // ── Render a filled requirement pill ──
  const renderFilledReqPill = (row: EmpRow, tag: string, idx: number, stationNum: number | null, shiftLabel: string, stationLabel: string) => {
    const name = row.employee
      ? `${row.employee.lastName}, ${row.employee.firstName}`
      : row.employeeId.slice(0, 8);

    return (
      <Tooltip
        key={`req-${tag}-${idx}`}
        title={
          <Box sx={{ p: 0.5 }}>
            <Typography variant="caption" fontWeight={700}>{tag}</Typography>
            <Typography variant="caption" display="block">{row.profile.name}</Typography>
            <QualificationPills qualifications={row.employee?.qualifications} tags={row.employee?.qualificationTags ?? []} compact />
          </Box>
        }
        arrow
      >
        <Box
          onClick={onEmployeeClick ? () => onEmployeeClick(row.employeeId) : undefined}
          sx={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            py: 1,
            px: 1.5,
            border: "2px dashed",
            borderColor: "success.light",
            borderRadius: 2,
            bgcolor: alpha("#4caf50", 0.04),
            cursor: onEmployeeClick ? "pointer" : "default",
            "&:hover": {
              bgcolor: alpha("#4caf50", 0.1),
              "& .pill-hover-actions": { display: "flex" },
            },
            minHeight: 40,
            mt: 1,
          }}
        >
          {/* Floating label on border — MUI TextField style */}
          <Typography
            variant="caption"
            sx={{
              position: "absolute",
              top: -9,
              left: 10,
              px: 0.5,
              bgcolor: "background.paper",
              fontWeight: 700,
              fontSize: 10,
              color: "success.dark",
              lineHeight: "16px",
              letterSpacing: 0.3,
            }}
          >
            {tag}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 500, fontSize: 13 }}>
            {name}
          </Typography>
          {renderInfoPills(row)}
          {renderHoverActions(row, stationNum, shiftLabel, stationLabel)}
        </Box>
      </Tooltip>
    );
  };

  // ── Render an empty (unfilled) requirement pill ──
  const renderEmptyReqPill = (tag: string, idx: number) => (
    <Box
      key={`empty-${tag}-${idx}`}
      sx={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 0.75,
        py: 1,
        px: 1.5,
        border: "2px dashed",
        borderColor: "error.main",
        borderRadius: 2,
        bgcolor: alpha("#d32f2f", 0.08),
        minHeight: 40,
        mt: 1,
      }}
    >
      {/* Floating label on border */}
      <Typography
        variant="caption"
        sx={{
          position: "absolute",
          top: -9,
          left: 10,
          px: 0.5,
          bgcolor: "background.paper",
          fontWeight: 700,
          fontSize: 10,
          color: "error.main",
          lineHeight: "16px",
          letterSpacing: 0.3,
        }}
      >
        {tag}
      </Typography>
      <WarningAmberIcon sx={{ fontSize: 18, color: "error.main" }} />
      <Typography variant="body2" sx={{ color: "error.dark", fontWeight: 600, fontStyle: "italic", fontSize: 13 }}>
        nicht besetzt
      </Typography>
    </Box>
  );

  // ── Render a regular (extra) employee pill ──
  const renderExtraPill = (row: EmpRow, stationNum: number | null, shiftLabel: string, stationLabel: string) => {
    const name = row.employee
      ? `${row.employee.lastName}, ${row.employee.firstName}`
      : row.employeeId.slice(0, 8);

    return (
      <Box
        key={row.assignment.id}
        onClick={onEmployeeClick ? () => onEmployeeClick(row.employeeId) : undefined}
        sx={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          py: 0.75,
          px: 1.5,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 2,
          cursor: onEmployeeClick ? "pointer" : "default",
          "&:hover": {
            bgcolor: "action.hover",
            "& .pill-hover-actions": { display: "flex" },
          },
          minHeight: 40,
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 500, fontSize: 13 }}>
          {name}
        </Typography>
        {renderInfoPills(row)}
        {renderHoverActions(row, stationNum, shiftLabel, stationLabel)}
      </Box>
    );
  };

  // ── Render a shift group (Frueh / Spaet / BL) with requirement pills ──
  const renderShiftGroup = (
    label: string,
    shiftType: string,
    rows: EmpRow[],
    stationNum: number | "fw",
  ) => {
    const color = SHIFT_TYPE_COLORS[shiftType] ?? "#78909c";
    const reqKey = stationNum === "fw" ? `${shiftType}:fw` : `${shiftType}:${stationNum}`;
    const req = reqMap.get(reqKey);
    const qualReqs = req?.qualificationRequirements ?? [];

    const { slots, extra } = matchSlots(rows, qualReqs);
    const unfilledCount = slots.filter((s) => !s.filled).length;
    const totalRequired = req?.minTotalCount ?? 0;
    const totalAssigned = rows.length;
    const totalMet = totalAssigned >= totalRequired;

    return (
      <Box key={shiftType} data-shift-group={shiftType} sx={{ mb: 1 }}>
        {/* Shift type header */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            py: 0.5,
            bgcolor: alpha(color, 0.06),
            borderBottom: `1px solid ${alpha(color, 0.15)}`,
          }}
        >
          <Box sx={{ width: 3, height: 14, bgcolor: color, borderRadius: 1 }} />
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: "text.secondary",
              fontSize: 11,
            }}
          >
            {label}
          </Typography>
          {totalRequired > 0 && (
            <Typography variant="caption" sx={{ fontSize: 11, color: totalMet ? "success.main" : "error.main", fontWeight: 600 }}>
              {totalAssigned}/{totalRequired}
            </Typography>
          )}
          {unfilledCount > 0 && (
            <Tooltip title={`${unfilledCount} Qualifikationsanforderung(en) nicht erfuellt`} arrow>
              <WarningAmberIcon sx={{ fontSize: 15, color: "error.main", ml: "auto" }} />
            </Tooltip>
          )}
        </Box>

        {/* Requirement pills */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, px: 1, py: 0.75 }}>
          {slots.map((slot, i) =>
            slot.filled
              ? renderFilledReqPill(slot.filled, slot.displayTag, i, stationNum === "fw" ? null : stationNum, label, stationNum === "fw" ? "Nacht" : `Station ${stationNum}`)
              : renderEmptyReqPill(slot.displayTag, i),
          )}

          {/* Separator between requirement pills and extras */}
          {slots.length > 0 && extra.length > 0 && (
            <Box sx={{ borderTop: "1px dashed", borderColor: "divider", my: 0.25 }} />
          )}

          {/* Extra people beyond requirements */}
          {extra.map((r) => renderExtraPill(r, stationNum === "fw" ? null : stationNum, label, stationNum === "fw" ? "Nacht" : `Station ${stationNum}`))}

          {/* Nothing at all */}
          {rows.length === 0 && slots.length === 0 && (
            <Typography variant="body2" color="text.disabled" sx={{ px: 1, py: 0.5, fontSize: 12, fontStyle: "italic" }}>
              Keine Zuweisungen
            </Typography>
          )}

          {/* Add employee pill */}
          {canEdit && (
            <Box
              onClick={() => openAddModal(shiftType, stationNum === "fw" ? null : stationNum)}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 0.75,
                py: 0.5,
                px: 1.5,
                border: "1px dashed",
                borderColor: alpha(color, 0.35),
                borderRadius: 2,
                cursor: "pointer",
                minHeight: 32,
                mt: 0.25,
                color: alpha(color, 0.6),
                "&:hover": {
                  bgcolor: alpha(color, 0.06),
                  borderColor: color,
                  color,
                },
                transition: "all 0.15s",
              }}
            >
              <AddIcon sx={{ fontSize: 18 }} />
              <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 500 }}>
                Mitarbeiter
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    );
  };

  // ── Station column ──
  const renderStationColumn = (stationNum: number) => {
    const data = stationData[stationNum];
    if (!data) return null;
    const colors = STATION_COLORS[stationNum] ?? { main: "#757575", light: "#f5f5f5" };
    const total = data.early.length + data.late.length + data.bl.length;

    return (
      <Box
        sx={{
          flex: 1,
          minWidth: 300,
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            px: 2,
            py: 1,
            bgcolor: colors.light,
            borderBottom: `2px solid ${colors.main}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: colors.main }}>
            Station {stationNum}
          </Typography>
          <Chip
            label={`${total} MA`}
            size="small"
            sx={{
              height: 22,
              fontSize: 11,
              fontWeight: 600,
              bgcolor: alpha(colors.main, 0.12),
              color: colors.main,
            }}
          />
        </Box>

        {renderShiftGroup(SHIFT_LABELS.EARLY, "EARLY", data.early, stationNum)}
        {renderShiftGroup(SHIFT_LABELS.LATE, "LATE", data.late, stationNum)}
        {data.bl.length > 0 && renderShiftGroup(SHIFT_LABELS.BL, "BL", data.bl, stationNum)}

        {total === 0 && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: "center", py: 3, fontStyle: "italic" }}
          >
            Keine Schichten
          </Typography>
        )}
      </Box>
    );
  };

  // ── Sync shift-group heights across station columns ──
  const stationsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = stationsRef.current;
    if (!container) return;
    const groups = container.querySelectorAll<HTMLElement>("[data-shift-group]");
    const byShift: Record<string, HTMLElement[]> = {};
    groups.forEach((el) => {
      const st = el.dataset.shiftGroup!;
      (byShift[st] ??= []).push(el);
    });
    for (const elements of Object.values(byShift)) {
      // reset so we measure natural height
      elements.forEach((el) => (el.style.minHeight = ""));
      const maxH = Math.max(...elements.map((el) => el.offsetHeight));
      elements.forEach((el) => (el.style.minHeight = `${maxH}px`));
    }
  });

  return (
    <Box>
      <Box ref={stationsRef} sx={{ display: "flex", gap: 2, mb: 2 }}>
        {renderStationColumn(1)}
        {renderStationColumn(2)}
        {renderStationColumn(3)}
      </Box>

      {/* Night section */}
      <Box
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            px: 2,
            py: 1,
            bgcolor: alpha(SHIFT_TYPE_COLORS.NIGHT, 0.08),
            borderBottom: `2px solid ${SHIFT_TYPE_COLORS.NIGHT}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: SHIFT_TYPE_COLORS.NIGHT }}>
            Nacht (gesamtes Gebaeude)
          </Typography>
          <Chip
            label={`${nightRows.length} MA`}
            size="small"
            sx={{
              height: 22,
              fontSize: 11,
              fontWeight: 600,
              bgcolor: alpha(SHIFT_TYPE_COLORS.NIGHT, 0.12),
              color: SHIFT_TYPE_COLORS.NIGHT,
            }}
          />
        </Box>
        {renderShiftGroup(SHIFT_LABELS.NIGHT, "NIGHT", nightRows, "fw")}
      </Box>

      {/* ── Assign Employee Modal ── */}
      {scheduleId && allProfiles && (
        <AssignEmployeeModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          mode={modalMode}
          scheduleId={scheduleId}
          date={date}
          shiftType={modalShiftType}
          stationNumber={modalStation}
          profiles={allProfiles}
          replaceAssignmentId={modalReplaceId}
          replaceEmployeeName={modalReplaceName}
          onSuccess={() => onAssignmentChange?.()}
        />
      )}

      {/* ── Remove Confirmation Dialog ── */}
      <Dialog open={removeDialogOpen} onClose={() => setRemoveDialogOpen(false)} maxWidth="xs">
        <DialogTitle>Zuweisung entfernen</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            <strong>{removeTarget?.employeeName}</strong> von{" "}
            <strong>{removeTarget?.shiftLabel}</strong> ({removeTarget?.stationLabel}) entfernen?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveDialogOpen(false)} color="inherit">
            Abbrechen
          </Button>
          <Button
            onClick={handleRemoveConfirm}
            color="error"
            variant="contained"
            disabled={removing}
          >
            Entfernen
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ══════════════════════════════════════════════════════════
//  TIMELINE VIEW (existing, preserved)
// ══════════════════════════════════════════════════════════

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

function TimelineEmployeeRow({
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
        {employee ? `${employee.firstName} ${employee.lastName}` : assignment.employeeId}
      </Typography>
      <Typography variant="caption" display="block">
        {profile.name}: {profile.startTime}–{profile.endTime}
        {hasSplit && ` + ${profile.startTime2}–${profile.endTime2}`}
      </Typography>
      <Box sx={{ my: 0.5 }}>
        <QualificationPills qualifications={employee?.qualifications} tags={tags} compact />
      </Box>
      <Typography variant="caption" display="block" color="text.secondary">
        Station {assignment.stationNumber ?? (employee?.assignedStations?.length ? employee.assignedStations.join("+") : "–")}
      </Typography>
    </Box>
  );

  const handleClick = onEmployeeClick ? () => onEmployeeClick(assignment.employeeId) : undefined;

  return (
    <Box sx={{ display: "flex", height: ROW_H, alignItems: "center" }}>
      <Box sx={{ width: NAME_COL, minWidth: NAME_COL, flexShrink: 0, px: 1, overflow: "hidden" }}>
        <Typography
          variant="body2"
          noWrap
          onClick={handleClick}
          sx={{
            fontWeight: 500,
            fontSize: 13,
            cursor: onEmployeeClick ? "pointer" : "default",
            "&:hover": onEmployeeClick ? { textDecoration: "underline", color: "primary.main" } : undefined,
          }}
        >
          {displayName}
        </Typography>
      </Box>
      <Tooltip title={tooltipContent} arrow placement="top">
        <Box sx={{ flex: 1, position: "relative", height: ROW_H }}>
          <ShiftBar startTime={profile.startTime} endTime={profile.endTime} color={color} label={barLabel} isShiftWish={isShiftWish} onClick={handleClick} />
          {hasSplit && (
            <ShiftBar startTime={profile.startTime2!} endTime={profile.endTime2!} color={altColor} label={barLabel} isShiftWish={isShiftWish} onClick={handleClick} />
          )}
        </Box>
      </Tooltip>
    </Box>
  );
}

function SectionTimeline({ section, onEmployeeClick }: { section: Section; onEmployeeClick?: (id: string) => void }) {
  const theme = useTheme();
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
      <Box sx={{ px: 2, py: 1, bgcolor: alpha(theme.palette.primary.main, 0.07), borderBottom: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="subtitle2" fontWeight={700}>{section.title}</Typography>
        <Chip label={`${section.rows.length} MA`} size="small" variant="outlined" sx={{ ml: "auto", height: 22, fontSize: "0.7rem" }} />
      </Box>
      {section.rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center", fontStyle: "italic" }}>Keine Schichten</Typography>
      ) : (
        <Box sx={{ overflowX: "auto" }}>
          <Box sx={{ minWidth: 800 }}>
            <Box sx={{ display: "flex", height: 24, borderBottom: "1px solid", borderColor: "divider" }}>
              <Box sx={{ width: NAME_COL, minWidth: NAME_COL, flexShrink: 0 }} />
              <Box sx={{ flex: 1, position: "relative" }}>
                {GRID_HOURS.map((h) => (
                  <Typography key={h} variant="caption" sx={{ position: "absolute", left: `${((h - TIMELINE_START) / TOTAL_HOURS) * 100}%`, bottom: 2, transform: "translateX(-50%)", fontSize: 11, color: "text.secondary", userSelect: "none" }}>
                    {hourLabel(h)}
                  </Typography>
                ))}
              </Box>
            </Box>
            <Box sx={{ position: "relative" }}>
              {section.rows.map((row) => (
                <TimelineEmployeeRow key={row.assignment.id} row={row} onEmployeeClick={onEmployeeClick} />
              ))}
              <Box sx={{ position: "absolute", top: 0, left: `${NAME_COL}px`, right: 0, bottom: 0, pointerEvents: "none", zIndex: 1 }}>
                {GRID_HOURS.map((h) => (
                  <Box key={h} sx={{ position: "absolute", left: `${((h - TIMELINE_START) / TOTAL_HOURS) * 100}%`, top: 0, bottom: 0, borderLeft: "1px dashed", borderColor: "divider" }} />
                ))}
              </Box>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function TimelineView({
  dayAssignments,
  employeesById,
  profilesById,
  iso,
  onEmployeeClick,
  shiftWishSet,
}: {
  dayAssignments: AssignmentJson[];
  employeesById: Record<string, EmployeeJson>;
  profilesById: Record<string, ShiftProfileJson>;
  iso: string;
  onEmployeeClick?: (employeeId: string) => void;
  shiftWishSet?: Set<string>;
}) {
  const sections = useMemo(() => {
    const stationRows: Record<number, EmpRow[]> = { 1: [], 2: [], 3: [] };
    const nightRows: EmpRow[] = [];

    for (const a of dayAssignments) {
      const profile = profilesById[a.shiftProfileId];
      if (!profile) continue;
      const employee = employeesById[a.employeeId];
      const isShiftWish = shiftWishSet?.has(`${a.employeeId}|${iso}`) ?? false;
      const row: EmpRow = { employeeId: a.employeeId, employee, assignment: a, profile, isShiftWish };

      if (profile.shiftType === "NIGHT") {
        nightRows.push(row);
      } else {
        const st = a.stationNumber ?? employee?.assignedStations?.[0] ?? 1;
        (stationRows[st] ?? stationRows[1]).push(row);
      }
    }

    const sortFn = (a: EmpRow, b: EmpRow) => {
      const an = a.employee ? `${a.employee.lastName} ${a.employee.firstName}` : "";
      const bn = b.employee ? `${b.employee.lastName} ${b.employee.firstName}` : "";
      return an.localeCompare(bn, "de");
    };

    return [
      { title: "Station 1", rows: stationRows[1].sort(sortFn) },
      { title: "Station 2", rows: stationRows[2].sort(sortFn) },
      { title: "Station 3", rows: stationRows[3].sort(sortFn) },
      { title: "Nacht (gesamtes Gebaeude)", rows: nightRows.sort(sortFn) },
    ] as Section[];
  }, [dayAssignments, profilesById, employeesById, shiftWishSet, iso]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {sections.map((section) => (
        <SectionTimeline key={section.title} section={section} onEmployeeClick={onEmployeeClick} />
      ))}
    </Box>
  );
}

// ══════════════════════════════════════════════════════════
//  MAIN DAY VIEW (with toggle)
// ══════════════════════════════════════════════════════════

export default function DayView({
  date,
  assignments,
  employeesById,
  profilesById,
  staffing,
  onEmployeeClick,
  shiftWishSet,
  scheduleId,
  onAssignmentChange,
}: DayViewProps) {
  const [viewMode, setViewMode] = useState<DayViewMode>("columns");
  const iso = localIsoDate(date);

  const dayAssignments = useMemo(
    () => assignments.filter((a) => a.date === iso),
    [assignments, iso],
  );

  const allProfiles = useMemo(
    () => Object.values(profilesById),
    [profilesById],
  );

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          Schichten am{" "}
          {date.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}
        </Typography>
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          onChange={(_, v) => v && setViewMode(v)}
          size="small"
          sx={{ "& .MuiToggleButton-root": { px: 1.5, py: 0.5, fontSize: "0.75rem" } }}
        >
          <ToggleButton value="columns">
            <ViewColumnIcon sx={{ fontSize: 18, mr: 0.5 }} />
            Stationen
          </ToggleButton>
          <ToggleButton value="timeline">
            <TimelineIcon sx={{ fontSize: 18, mr: 0.5 }} />
            Zeitstrahl
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {viewMode === "columns" ? (
        <ColumnView
          dayAssignments={dayAssignments}
          employeesById={employeesById}
          profilesById={profilesById}
          staffing={staffing}
          onEmployeeClick={onEmployeeClick}
          date={date}
          scheduleId={scheduleId}
          allProfiles={allProfiles}
          onAssignmentChange={onAssignmentChange}
        />
      ) : (
        <TimelineView
          dayAssignments={dayAssignments}
          employeesById={employeesById}
          profilesById={profilesById}
          iso={iso}
          onEmployeeClick={onEmployeeClick}
          shiftWishSet={shiftWishSet}
        />
      )}
    </Box>
  );
}
