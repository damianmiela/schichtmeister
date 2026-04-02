"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Chip,
  TextField,
  CircularProgress,
  alpha,
  Divider,
  IconButton,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import QualificationPills from "@/components/schedule/QualificationPills";
import RuleViolationsList from "@/components/schedule/RuleViolationsList";
import type { ShiftProfileJson } from "@/lib/schedule/scheduleTypes";
import type { RuleMessage } from "@/lib/planning/types";

// ── Types ──

export type AssignModalMode = "add" | "replace";

export interface AssignEmployeeModalProps {
  open: boolean;
  onClose: () => void;
  mode: AssignModalMode;
  scheduleId: string;
  date: Date;
  /** EARLY | LATE | NIGHT */
  shiftType: string;
  /** Station number (null for NIGHT) */
  stationNumber: number | null;
  /** All active shift profiles */
  profiles: ShiftProfileJson[];
  /** For replace mode: the assignment being replaced */
  replaceAssignmentId?: string;
  /** For replace mode: name of employee being replaced */
  replaceEmployeeName?: string;
  /** Called after a successful assignment/replacement */
  onSuccess: () => void;
}

type AvailableEmployee = {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  contractType: string;
  qualificationTags: string[];
  qualifications: { id: string; abbreviation: string; name: string }[];
  assignedStations: number[];
  targetHoursPercent: number | null;
  allowedShiftProfileIds: string[];
  preferredShiftTypes: string[];
  isFullTimeBl: boolean;
  fixedWorkingDays: number[];
  maxConsecutiveDays: number | null;
  istHours: number;
  sollHours: number | null;
  deltaHours: number | null;
  hasAssignmentOnDate: boolean;
};

// ── Constants ──

const SHIFT_TYPE_LABELS: Record<string, string> = {
  EARLY: "Frühschicht",
  LATE: "Spätschicht",
  NIGHT: "Nachtschicht",
  BL: "BL",
};

const QUALIFICATION_SORT_ORDER: Record<string, number> = {
  PFK: 0,
  APH: 1,
  KPH: 2,
  PH: 3,
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: "Aktiv", color: "#2e7d32" },
  INACTIVE: { label: "Inaktiv", color: "#9e9e9e" },
  KRANK: { label: "Krank", color: "#d32f2f" },
  LANGZEITKRANK: { label: "Langzeitkrank", color: "#c62828" },
  MUTTERSCHUTZ: { label: "Mutterschutz", color: "#7b1fa2" },
  URLAUB: { label: "Urlaub", color: "#1565c0" },
  KUR: { label: "Kur", color: "#00838f" },
};

function formatDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function qualSortKey(tags: string[]): number {
  let best = 99;
  for (const t of tags) {
    const order = QUALIFICATION_SORT_ORDER[t];
    if (order !== undefined && order < best) best = order;
  }
  return best;
}

// ── Component ──

export default function AssignEmployeeModal({
  open,
  onClose,
  mode,
  scheduleId,
  date,
  shiftType,
  stationNumber,
  profiles,
  replaceAssignmentId,
  replaceEmployeeName,
  onSuccess,
}: AssignEmployeeModalProps) {
  // ── State ──
  const [employees, setEmployees] = useState<AvailableEmployee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [validation, setValidation] = useState<{
    errors: RuleMessage[];
    warnings: RuleMessage[];
  } | null>(null);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Shift profiles matching the shift type
  const matchingProfiles = useMemo(
    () => profiles.filter((p) => p.shiftType === shiftType && p.isActive),
    [profiles, shiftType],
  );

  // Initialize selected profile when modal opens
  useEffect(() => {
    if (open && matchingProfiles.length > 0 && !selectedProfileId) {
      setSelectedProfileId(matchingProfiles[0].id);
    }
  }, [open, matchingProfiles, selectedProfileId]);

  // Fetch employees when modal opens
  useEffect(() => {
    if (!open) return;
    setLoadingEmployees(true);
    setSelectedId(null);
    setValidation(null);
    setSearch("");

    fetch(`/api/employees/available?scheduleId=${scheduleId}&date=${isoDate(date)}`)
      .then((r) => r.json())
      .then((data) => {
        setEmployees(data.employees ?? []);
      })
      .catch(() => setEmployees([]))
      .finally(() => setLoadingEmployees(false));
  }, [open, scheduleId, date]);

  // Reset state on close
  const handleClose = useCallback(() => {
    setSelectedId(null);
    setSelectedProfileId("");
    setValidation(null);
    setSearch("");
    onClose();
  }, [onClose]);

  // Run validation when employee or profile selection changes
  useEffect(() => {
    if (!selectedId || !selectedProfileId || !open) {
      setValidation(null);
      return;
    }
    setValidating(true);
    const body: Record<string, string> = {
      scheduleId,
      date: isoDate(date),
      shiftProfileId: selectedProfileId,
      employeeId: selectedId,
    };
    if (mode === "replace" && replaceAssignmentId) {
      body.replaceAssignmentId = replaceAssignmentId;
    }
    fetch("/api/assignments/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((data) => {
        setValidation({
          errors: data.errors ?? [],
          warnings: data.warnings ?? [],
        });
      })
      .catch(() =>
        setValidation({ errors: [{ ruleId: "fetch", code: "FETCH_ERROR", message: "Validierung fehlgeschlagen" }], warnings: [] }),
      )
      .finally(() => setValidating(false));
  }, [selectedId, selectedProfileId, open, scheduleId, date, mode, replaceAssignmentId]);

  // Filtered and sorted employee list
  const filteredEmployees = useMemo(() => {
    let list = employees.filter((e) => !e.hasAssignmentOnDate);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.firstName.toLowerCase().includes(q) ||
          e.lastName.toLowerCase().includes(q),
      );
    }
    // Sort: qualification group → alphabetical
    list.sort((a, b) => {
      const qa = qualSortKey(a.qualificationTags);
      const qb = qualSortKey(b.qualificationTags);
      if (qa !== qb) return qa - qb;
      const nameA = `${a.lastName} ${a.firstName}`.toLowerCase();
      const nameB = `${b.lastName} ${b.firstName}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });
    return list;
  }, [employees, search]);

  const selectedEmployee = employees.find((e) => e.id === selectedId) ?? null;

  // ── Submit ──
  const handleSubmit = async () => {
    if (!selectedId || !selectedProfileId) return;
    setSubmitting(true);
    try {
      // In replace mode: delete old assignment first
      if (mode === "replace" && replaceAssignmentId) {
        const delRes = await fetch(`/api/assignments/${replaceAssignmentId}`, {
          method: "DELETE",
        });
        if (!delRes.ok && delRes.status !== 204) {
          console.error("Failed to delete old assignment");
        }
      }
      // Create new assignment with force=true (user has seen warnings)
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleId,
          date: isoDate(date),
          shiftProfileId: selectedProfileId,
          employeeId: selectedId,
          force: true,
        }),
      });
      if (res.ok) {
        handleClose();
        onSuccess();
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Header subtitle ──
  const subtitle = [
    stationNumber != null ? `Station ${stationNumber}` : null,
    SHIFT_TYPE_LABELS[shiftType] ?? shiftType,
    formatDate(date),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{ sx: { height: "80vh", maxHeight: 700 } }}
    >
      {/* ── Header ── */}
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pb: 1 }}>
        <Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {mode === "add" ? <PersonAddIcon /> : <SwapHorizIcon />}
            <Typography variant="h6" component="span">
              {mode === "add" ? "Mitarbeiter zuweisen" : "Mitarbeiter ersetzen"}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {mode === "replace" && replaceEmployeeName
              ? `${replaceEmployeeName} ersetzen · ${subtitle}`
              : subtitle}
          </Typography>
        </Box>
        <IconButton onClick={handleClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ p: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* ── Shift profile selector ── */}
        <Box sx={{ px: 2.5, py: 1.5, display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
          <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
            Schicht:
          </Typography>
          {matchingProfiles.map((p) => (
            <Chip
              key={p.id}
              label={`${p.name} (${p.startTime}–${p.endTime})`}
              size="small"
              variant={selectedProfileId === p.id ? "filled" : "outlined"}
              color={selectedProfileId === p.id ? "primary" : "default"}
              onClick={() => setSelectedProfileId(p.id)}
              sx={{ fontWeight: selectedProfileId === p.id ? 600 : 400 }}
            />
          ))}
        </Box>

        <Divider />

        {/* ── Two-column layout ── */}
        <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* ── Left column: Employee list ── */}
          <Box
            sx={{
              width: "50%",
              borderRight: "1px solid",
              borderColor: "divider",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <Box sx={{ px: 2, py: 1 }}>
              <TextField
                size="small"
                placeholder="Mitarbeiter suchen…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                fullWidth
                sx={{ "& .MuiInputBase-root": { fontSize: 14 } }}
              />
            </Box>

            <Box sx={{ flex: 1, overflow: "auto", px: 1 }}>
              {loadingEmployees ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                  <CircularProgress size={28} />
                </Box>
              ) : filteredEmployees.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 2, textAlign: "center" }}>
                  Keine verfügbaren Mitarbeiter
                </Typography>
              ) : (
                filteredEmployees.map((emp) => {
                  const isSelected = emp.id === selectedId;
                  const statusInfo = STATUS_LABELS[emp.status] ?? { label: emp.status, color: "#9e9e9e" };
                  return (
                    <Box
                      key={emp.id}
                      onClick={() => setSelectedId(emp.id)}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        px: 1.5,
                        py: 0.75,
                        borderRadius: 1,
                        cursor: "pointer",
                        bgcolor: isSelected ? (t) => alpha(t.palette.primary.main, 0.1) : "transparent",
                        border: isSelected ? "1px solid" : "1px solid transparent",
                        borderColor: isSelected ? "primary.main" : "transparent",
                        "&:hover": {
                          bgcolor: isSelected
                            ? (t) => alpha(t.palette.primary.main, 0.1)
                            : "action.hover",
                        },
                        mb: 0.5,
                      }}
                    >
                      {/* Name */}
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: isSelected ? 600 : 400, minWidth: 120, flexShrink: 0 }}
                      >
                        {emp.lastName}, {emp.firstName}
                      </Typography>

                      {/* Qualification pills */}
                      <Box sx={{ flexShrink: 0 }}>
                        <QualificationPills
                          qualifications={emp.qualifications}
                          tags={emp.qualificationTags}
                          compact
                        />
                      </Box>

                      {/* Hours */}
                      <Typography
                        variant="caption"
                        sx={{ flexShrink: 0, whiteSpace: "nowrap", color: "text.secondary" }}
                      >
                        {emp.istHours.toFixed(1)}/{emp.sollHours != null ? emp.sollHours.toFixed(1) : "–"}h
                        {emp.deltaHours != null && (
                          <Typography
                            component="span"
                            variant="caption"
                            sx={{
                              ml: 0.5,
                              fontWeight: 600,
                              color: emp.deltaHours > 0 ? "error.main" : emp.deltaHours < 0 ? "info.main" : "text.secondary",
                            }}
                          >
                            ({emp.deltaHours > 0 ? "+" : ""}{emp.deltaHours.toFixed(1)}h)
                          </Typography>
                        )}
                      </Typography>

                      {/* Soll-% */}
                      {emp.targetHoursPercent != null && (
                        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                          {emp.targetHoursPercent}%
                        </Typography>
                      )}

                      {/* Status */}
                      <Chip
                        label={statusInfo.label}
                        size="small"
                        sx={{
                          ml: "auto",
                          flexShrink: 0,
                          height: 18,
                          fontSize: 10,
                          fontWeight: 600,
                          bgcolor: alpha(statusInfo.color, 0.12),
                          color: statusInfo.color,
                          "& .MuiChip-label": { px: 0.75 },
                        }}
                      />
                    </Box>
                  );
                })
              )}
            </Box>
          </Box>

          {/* ── Right column: Employee detail + validation ── */}
          <Box
            sx={{
              width: "50%",
              display: "flex",
              flexDirection: "column",
              overflow: "auto",
              p: 2,
            }}
          >
            {!selectedEmployee ? (
              <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Mitarbeiter auswählen
                </Typography>
              </Box>
            ) : (
              <>
                {/* Employee info */}
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                  {selectedEmployee.firstName} {selectedEmployee.lastName}
                </Typography>

                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, mb: 2 }}>
                  <InfoRow label="Vertragsart" value={contractLabel(selectedEmployee.contractType)} />
                  <InfoRow label="Status" value={STATUS_LABELS[selectedEmployee.status]?.label ?? selectedEmployee.status} />
                  <InfoRow label="Qualifikationen">
                    <QualificationPills qualifications={selectedEmployee.qualifications} tags={selectedEmployee.qualificationTags} />
                  </InfoRow>
                  <InfoRow label="Stationen" value={selectedEmployee.assignedStations.length > 0 ? selectedEmployee.assignedStations.join(", ") : "–"} />
                  <InfoRow label="Soll-Stunden" value={selectedEmployee.targetHoursPercent != null ? `${selectedEmployee.targetHoursPercent}% (VZ)` : "–"} />
                  <InfoRow
                    label="Ist/Soll (Monat)"
                    value={`${selectedEmployee.istHours.toFixed(1)}h / ${selectedEmployee.sollHours != null ? selectedEmployee.sollHours.toFixed(1) + "h" : "–"}`}
                  />
                  {selectedEmployee.deltaHours != null && (
                    <InfoRow label="Delta" value={`${selectedEmployee.deltaHours > 0 ? "+" : ""}${selectedEmployee.deltaHours.toFixed(1)}h`} />
                  )}
                  {selectedEmployee.fixedWorkingDays.length > 0 && (
                    <InfoRow label="Feste Arbeitstage" value={selectedEmployee.fixedWorkingDays.map(dayLabel).join(", ")} />
                  )}
                  {selectedEmployee.maxConsecutiveDays != null && (
                    <InfoRow label="Max. Tage am Stück" value={String(selectedEmployee.maxConsecutiveDays)} />
                  )}
                  {selectedEmployee.preferredShiftTypes.length > 0 && (
                    <InfoRow label="Bevorzugte Schichten" value={selectedEmployee.preferredShiftTypes.map((s) => SHIFT_TYPE_LABELS[s] ?? s).join(", ")} />
                  )}
                  <InfoRow label="BL Vollzeit" value={selectedEmployee.isFullTimeBl ? "Ja" : "Nein"} />
                </Box>

                <Divider sx={{ mb: 1.5 }} />

                {/* Rule validation */}
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                  Regelprüfung
                </Typography>
                <RuleViolationsList
                  errors={validation?.errors ?? []}
                  warnings={validation?.warnings ?? []}
                  loading={validating}
                />
              </>
            )}
          </Box>
        </Box>
      </DialogContent>

      <Divider />

      <DialogActions sx={{ px: 2.5, py: 1.5 }}>
        <Button onClick={handleClose} color="inherit">
          Abbrechen
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!selectedId || !selectedProfileId || submitting}
          startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {mode === "add" ? "Zuweisen" : "Ersetzen"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Helpers ──

function InfoRow({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 120, flexShrink: 0 }}>
        {label}
      </Typography>
      {children ?? (
        <Typography variant="body2" sx={{ fontSize: 13 }}>
          {value}
        </Typography>
      )}
    </Box>
  );
}

function contractLabel(ct: string): string {
  const map: Record<string, string> = {
    FULL_TIME: "Vollzeit",
    PART_TIME: "Teilzeit",
    MINI_JOB: "Minijob",
    AUSBILDUNG: "Ausbildung",
  };
  return map[ct] ?? ct;
}

function dayLabel(d: number): string {
  const days = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  return days[d] ?? String(d);
}
