"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MainLayout from "@/components/layout/MainLayout";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Avatar,
  Chip,
  IconButton,
  Button,
  TextField,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Alert,
  CircularProgress,
  Autocomplete,
  Checkbox,
  Divider,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import { REFERENCE_FULL_TIME_MONTHLY_HOURS } from "@/lib/employeeContractDenorm";

type ContractType = "FULL_TIME" | "PART_TIME" | "MINI_JOB" | "AUSBILDUNG";
type StatusType = "ACTIVE" | "INACTIVE" | "KRANK" | "LANGZEITKRANK" | "MUTTERSCHUTZ" | "URLAUB" | "KUR";

interface QualificationCatalog {
  id: string;
  name: string;
  abbreviation: string;
}

interface ShiftProfileCatalog {
  id: string;
  name: string;
  shiftType: string;
}

interface Absence {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  note?: string | null;
}

interface EmployeeRow {
  id: string;
  firstName: string;
  lastName: string;
  contractType: ContractType;
  status: string;
  targetHours: number | null;
  targetHoursPeriod: string | null;
  miniJobMaxMonthlyHours: number | null;
  targetHoursPercent: number | null;
  assignedStations: number[];
  workProfile: { id: string; name: string } | null;
  qualificationTags: string[];
  qualifications: { id: string; name: string; abbreviation: string }[];
  allowedShiftProfiles: { id: string; name: string; shiftType: string }[];
  isFullTimeBl?: boolean;
  fixedWorkingDays?: number[];
  maxConsecutiveDays?: number | null;
  shiftDistribution?: Record<string, number> | null;
}

const CONTRACT_LABELS: Record<ContractType, string> = {
  FULL_TIME: "Vollzeit",
  PART_TIME: "Teilzeit",
  MINI_JOB: "Mini-Job",
  AUSBILDUNG: "Ausbildung",
};

const CONTRACT_SORT_ORDER: ContractType[] = [
  "FULL_TIME",
  "PART_TIME",
  "MINI_JOB",
  "AUSBILDUNG",
];

const CONTRACT_CHIP_COLOR: Record<
  ContractType,
  "success" | "info" | "warning" | "secondary"
> = {
  FULL_TIME: "success",
  PART_TIME: "info",
  MINI_JOB: "warning",
  AUSBILDUNG: "secondary",
};

const STATUS_LABELS: Record<StatusType, string> = {
  ACTIVE: "Aktiv",
  INACTIVE: "Inaktiv",
  KRANK: "Krank",
  LANGZEITKRANK: "Langzeitkrank",
  MUTTERSCHUTZ: "Mutterschutz",
  URLAUB: "Urlaub",
  KUR: "Kur",
};

const STATUS_CHIP_COLOR: Record<
  StatusType,
  "success" | "error" | "warning" | "secondary" | "info" | "default"
> = {
  ACTIVE: "success",
  INACTIVE: "default",
  KRANK: "error",
  LANGZEITKRANK: "warning",
  MUTTERSCHUTZ: "secondary",
  URLAUB: "info",
  KUR: "default",
};

const STATUS_OPTIONS: StatusType[] = [
  "ACTIVE",
  "INACTIVE",
  "KRANK",
  "LANGZEITKRANK",
  "MUTTERSCHUTZ",
  "URLAUB",
  "KUR",
];

const WEEKDAY_LABELS: Record<number, string> = {
  1: "Mo",
  2: "Di",
  3: "Mi",
  4: "Do",
  5: "Fr",
  6: "Sa",
  7: "So",
};

const SHIFT_TYPE_LABELS: Record<string, string> = {
  EARLY: "Früh",
  LATE: "Spät",
  NIGHT: "Nacht",
  FULL_DAY: "Ganztag",
  OTHER: "Sonstig",
};

const ABSENCE_TYPE_LABELS: Record<string, string> = {
  KRANK: "Krank",
  URLAUB: "Urlaub",
};

function contractSortIndex(ct: ContractType): number {
  const i = CONTRACT_SORT_ORDER.indexOf(ct);
  return i === -1 ? CONTRACT_SORT_ORDER.length : i;
}

function monthlyHoursLabel(percent: number): string {
  const h = (percent / 100) * REFERENCE_FULL_TIME_MONTHLY_HOURS;
  const rounded = Math.round(h * 100) / 100;
  return String(rounded).replace(".", ",");
}

function parsePercentInput(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) return null;
  return n;
}

function contractHoursDetail(e: EmployeeRow): string | null {
  const bits: string[] = [];
  if (e.targetHoursPercent != null) {
    bits.push(
      `${e.targetHoursPercent}% · ≈ ${monthlyHoursLabel(e.targetHoursPercent)} h/Monat`,
    );
  } else if (e.targetHours != null && e.targetHoursPeriod === "MONTHLY") {
    bits.push(`${String(e.targetHours).replace(".", ",")} h/Monat`);
  } else if (e.targetHours != null && e.targetHoursPeriod === "WEEKLY") {
    bits.push(`${String(e.targetHours).replace(".", ",")} h/Woche`);
  }
  if (e.contractType === "MINI_JOB" && e.miniJobMaxMonthlyHours != null) {
    bits.push(
      `max. ${String(e.miniJobMaxMonthlyHours).replace(".", ",")} h/Monat (Kappung)`,
    );
  }
  if (bits.length === 0) return null;
  return bits.join(" · ");
}

function computeSuggestedProfiles(
  ct: ContractType,
  quals: QualificationCatalog[],
  allProfiles: ShiftProfileCatalog[],
): ShiftProfileCatalog[] {
  const abbrs = new Set(quals.map((q) => q.abbreviation.toUpperCase()));
  const suggestedNames = new Set<string>();

  const hasPFK = abbrs.has("PFK");
  const hasAPH = abbrs.has("APH");
  const hasKPH = abbrs.has("KPH");
  const hasPH = abbrs.has("PH");
  const hasWBL = abbrs.has("WBL");
  const hasAuxQual = hasAPH || hasKPH || hasPH;

  if (ct === "FULL_TIME") {
    suggestedNames.add("F2");
    suggestedNames.add("S1");
  } else if (ct === "PART_TIME") {
    if (hasPFK) {
      suggestedNames.add("F1");
      suggestedNames.add("S2");
    }
    if (hasAuxQual) {
      suggestedNames.add("F3");
      suggestedNames.add("S2");
    }
  }

  if (hasPFK) suggestedNames.add("N");
  if (hasAuxQual) suggestedNames.add("N1");
  if (hasWBL) suggestedNames.add("BL");

  return allProfiles.filter((p) => suggestedNames.has(p.name));
}

function extractApiError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (
      e.body &&
      typeof e.body === "object" &&
      e.body !== null &&
      "error" in e.body &&
      typeof (e.body as { error: unknown }).error === "string"
    ) {
      return (e.body as { error: string }).error;
    }
    return fallback;
  }
  return "Netzwerkfehler";
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [qualCatalog, setQualCatalog] = useState<QualificationCatalog[]>([]);
  const [shiftProfileCatalog, setShiftProfileCatalog] = useState<ShiftProfileCatalog[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contractType, setContractType] = useState<ContractType>("FULL_TIME");
  const [status, setStatus] = useState<StatusType>("ACTIVE");
  const [percentStr, setPercentStr] = useState("");
  const [miniStr, setMiniStr] = useState("");
  const [selectedQuals, setSelectedQuals] = useState<QualificationCatalog[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<ShiftProfileCatalog[]>([]);
  const [assignedStations, setAssignedStations] = useState<number[]>([]);
  const [profilesTouched, setProfilesTouched] = useState(false);
  const [isFullTimeBl, setIsFullTimeBl] = useState(false);
  const [fixedWorkingDays, setFixedWorkingDays] = useState<number[]>([]);
  const [maxConsecOverride, setMaxConsecOverride] = useState(false);
  const [maxConsecDays, setMaxConsecDays] = useState("");
  const [globalMaxConsecDays, setGlobalMaxConsecDays] = useState(7);
  const [shiftDistribution, setShiftDistribution] = useState<Record<string, string>>({});

  const [deleteTarget, setDeleteTarget] = useState<EmployeeRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [sortKey, setSortKey] = useState<"name" | "contract">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [empRes, qualRes, spRes, rulesRes] = await Promise.all([
        fetchJson<{ employees: EmployeeRow[] }>("/api/employees"),
        fetchJson<{ qualifications: QualificationCatalog[] }>("/api/qualifications"),
        fetchJson<{ shiftProfiles: ShiftProfileCatalog[] }>(
          "/api/shift-profiles?isActive=true",
        ),
        fetchJson<{ rules: { id: string; enabled: boolean; params: Record<string, unknown> }[] }>("/api/facility/rules"),
      ]);
      setEmployees(empRes.employees ?? []);
      setQualCatalog(qualRes.qualifications ?? []);
      setShiftProfileCatalog(spRes.shiftProfiles ?? []);
      const mcdRule = rulesRes.rules?.find((r) => r.id === "maxConsecutiveDays");
      if (mcdRule?.enabled) {
        setGlobalMaxConsecDays((mcdRule.params.maxDays as number) ?? 7);
      }
    } catch (e) {
      setError(extractApiError(e, "Laden fehlgeschlagen."));
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = employees.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.qualifications.some(
        (qu) =>
          qu.abbreviation.toLowerCase().includes(q) ||
          qu.name.toLowerCase().includes(q),
      )
    );
  });

  const sortedRows = useMemo(() => {
    const rows = [...filtered];
    const nameCmp = (a: EmployeeRow, b: EmployeeRow) => {
      const an = `${a.lastName} ${a.firstName}`.toLowerCase();
      const bn = `${b.lastName} ${b.firstName}`.toLowerCase();
      return an.localeCompare(bn, "de");
    };
    rows.sort((a, b) => {
      if (sortKey === "name") {
        const c = nameCmp(a, b);
        return sortDir === "asc" ? c : -c;
      }
      const ca = contractSortIndex(a.contractType);
      const cb = contractSortIndex(b.contractType);
      if (ca !== cb) {
        return sortDir === "asc" ? ca - cb : cb - ca;
      }
      return nameCmp(a, b);
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  const toggleNameSort = () => {
    if (sortKey === "name") {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey("name");
      setSortDir("asc");
    }
  };

  const toggleContractSort = () => {
    if (sortKey === "contract") {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey("contract");
      setSortDir("asc");
    }
  };

  const resetForm = () => {
    setFormError(null);
    setFirstName("");
    setLastName("");
    setContractType("FULL_TIME");
    setStatus("ACTIVE");
    setPercentStr("");
    setMiniStr("");
    setSelectedQuals([]);
    setSelectedProfiles([]);
    setAssignedStations([]);
    setEditingId(null);
    setProfilesTouched(false);
    setIsFullTimeBl(false);
    setFixedWorkingDays([]);
    setMaxConsecOverride(false);
    setMaxConsecDays(String(globalMaxConsecDays));
    setShiftDistribution({});
  };

  useEffect(() => {
    if (profilesTouched) return;
    const suggested = computeSuggestedProfiles(
      contractType,
      selectedQuals,
      shiftProfileCatalog,
    );
    setSelectedProfiles(suggested);
  }, [contractType, selectedQuals, shiftProfileCatalog, profilesTouched]);

  const openCreateDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (e: EmployeeRow) => {
    setFormError(null);
    setEditingId(e.id);
    setFirstName(e.firstName);
    setLastName(e.lastName);
    setContractType(e.contractType);
    setStatus((e.status as StatusType) || "ACTIVE");
    setPercentStr(
      e.targetHoursPercent != null
        ? String(e.targetHoursPercent).replace(".", ",")
        : "",
    );
    setMiniStr(
      e.miniJobMaxMonthlyHours != null
        ? String(e.miniJobMaxMonthlyHours).replace(".", ",")
        : "",
    );
    const matchedQuals = e.qualifications
      .map((eq) => qualCatalog.find((c) => c.id === eq.id))
      .filter((x): x is QualificationCatalog => x != null);
    setSelectedQuals(matchedQuals);
    const matchedProfiles = e.allowedShiftProfiles
      .map((sp) => shiftProfileCatalog.find((c) => c.id === sp.id))
      .filter((x): x is ShiftProfileCatalog => x != null);
    setSelectedProfiles(matchedProfiles);
    setProfilesTouched(true);
    setAssignedStations(e.assignedStations ?? []);
    setIsFullTimeBl(e.isFullTimeBl ?? false);
    setFixedWorkingDays(e.fixedWorkingDays ?? []);
    setMaxConsecOverride(e.maxConsecutiveDays != null);
    setMaxConsecDays(e.maxConsecutiveDays != null ? String(e.maxConsecutiveDays) : String(globalMaxConsecDays));
    const dist = e.shiftDistribution ?? {};
    const distStrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(dist)) {
      distStrs[k] = String(v);
    }
    setShiftDistribution(distStrs);
    setDialogOpen(true);
  };

  const buildPayload = ():
    | { ok: true; body: Record<string, unknown> }
    | { ok: false; message: string } => {
    if (!firstName.trim() || !lastName.trim()) {
      return { ok: false, message: "Vor- und Nachname sind erforderlich." };
    }

    if (selectedProfiles.length === 0) {
      return {
        ok: false,
        message: "Mindestens ein Schichtprofil muss ausgewählt werden.",
      };
    }

    let mini: number | null = null;
    if (contractType === "MINI_JOB") {
      const mj = miniStr.trim();
      if (mj) {
        const n = Number(mj.replace(",", "."));
        if (!Number.isFinite(n) || n <= 0) {
          return {
            ok: false,
            message: "Mini-Job: gültige Max-Stunden/Monat eingeben.",
          };
        }
        mini = n;
      }
    }

    const p = parsePercentInput(percentStr);
    if (percentStr.trim() !== "" && p == null) {
      return {
        ok: false,
        message: "Soll-Prozent: gültige Zahl eingeben (oder leer lassen).",
      };
    }

    const parsedDist: Record<string, number> = {};
    let distHasValues = false;
    for (const [pid, raw] of Object.entries(shiftDistribution)) {
      const n = Number(raw.replace(",", "."));
      if (Number.isFinite(n) && n > 0) {
        parsedDist[pid] = n;
        distHasValues = true;
      }
    }

    const body: Record<string, unknown> = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      contractType,
      status,
      targetHoursPercent: p,
      miniJobMaxMonthlyHours: contractType === "MINI_JOB" ? mini : null,
      assignedStations: assignedStations,
      qualificationTags: selectedQuals.map((q) => q.abbreviation),
      qualificationIds: selectedQuals.map((q) => q.id),
      allowedShiftProfileIds: selectedProfiles.map((pr) => pr.id),
      workProfileId: null,
      isFullTimeBl,
      fixedWorkingDays,
      maxConsecutiveDays: maxConsecOverride ? (parseInt(maxConsecDays, 10) || null) : null,
      shiftDistribution: distHasValues ? parsedDist : null,
    };

    return { ok: true, body };
  };

  const submitEmployee = async () => {
    setFormError(null);
    const built = buildPayload();
    if (!built.ok) {
      setFormError(built.message);
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await fetchJson(`/api/employees/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(built.body),
        });
      } else {
        await fetchJson("/api/employees", {
          method: "POST",
          body: JSON.stringify(built.body),
        });
      }
      setDialogOpen(false);
      resetForm();
      await load();
    } catch (e) {
      setFormError(extractApiError(e, "Speichern fehlgeschlagen."));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/employees/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(extractApiError(e, "Löschen fehlgeschlagen."));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <MainLayout title="Mitarbeiter">
      <Card>
        <CardContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 3,
              flexWrap: "wrap",
              gap: 2,
            }}
          >
            <TextField
              placeholder="Mitarbeiter suchen…"
              size="small"
              sx={{ width: 300 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" />
                  </InputAdornment>
                ),
              }}
            />
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={openCreateDialog}
            >
              Mitarbeiter hinzufügen
            </Button>
          </Box>

          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      <TableSortLabel
                        active={sortKey === "name"}
                        direction={sortKey === "name" ? sortDir : "asc"}
                        onClick={toggleNameSort}
                      >
                        Mitarbeiter
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      <TableSortLabel
                        active={sortKey === "contract"}
                        direction={sortKey === "contract" ? sortDir : "asc"}
                        onClick={toggleContractSort}
                      >
                        Arbeitszeit
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>Station</TableCell>
                    <TableCell>Qualifikationen</TableCell>
                    <TableCell>Schichtprofile</TableCell>
                    <TableCell>Arbeitstage</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>Max Tage</TableCell>
                    <TableCell align="right">Aktionen</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9}>
                        <Typography color="text.secondary" sx={{ py: 2 }}>
                          Keine Mitarbeiter.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedRows.map((employee) => {
                      const ct = employee.contractType as ContractType;
                      const st = (employee.status || "ACTIVE") as StatusType;
                      const hoursLine = contractHoursDetail(employee);
                      return (
                        <TableRow key={employee.id} hover>
                          <TableCell>
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 2,
                              }}
                            >
                              <Avatar sx={{ bgcolor: "primary.main" }}>
                                {(employee.firstName[0] ?? "") +
                                  (employee.lastName[0] ?? "")}
                              </Avatar>
                              <Typography variant="body2" fontWeight={500}>
                                {employee.firstName} {employee.lastName}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={STATUS_LABELS[st] ?? st}
                              color={STATUS_CHIP_COLOR[st] ?? "default"}
                              size="small"
                              variant="filled"
                              sx={{ fontWeight: 600 }}
                            />
                          </TableCell>
                          <TableCell sx={{ maxWidth: 280 }}>
                            <Chip
                              label={CONTRACT_LABELS[ct] ?? ct}
                              color={CONTRACT_CHIP_COLOR[ct] ?? "default"}
                              size="small"
                              variant="filled"
                              sx={{
                                fontWeight: 600,
                                mb: hoursLine ? 0.5 : 0,
                              }}
                            />
                            {hoursLine && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                display="block"
                              >
                                {hoursLine}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            {employee.assignedStations.length > 0 ? (
                              <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                                {employee.assignedStations.map((st) => (
                                  <Chip
                                    key={st}
                                    label={`St. ${st}`}
                                    size="small"
                                    variant="outlined"
                                    color="primary"
                                    sx={{ fontWeight: 600, fontSize: 11 }}
                                  />
                                ))}
                              </Box>
                            ) : (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                Alle
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <Box
                              sx={{
                                display: "flex",
                                gap: 0.5,
                                flexWrap: "wrap",
                              }}
                            >
                              {employee.qualifications.length === 0 ? (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  —
                                </Typography>
                              ) : (
                                employee.qualifications.map((q) => (
                                  <Chip
                                    key={q.id}
                                    label={q.abbreviation}
                                    size="small"
                                    sx={{ fontSize: 11 }}
                                  />
                                ))
                              )}
                            </Box>
                          </TableCell>
                          {/* Schichtprofile */}
                          <TableCell>
                            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                              {employee.allowedShiftProfiles.length === 0 ? (
                                <Typography variant="caption" color="text.secondary">—</Typography>
                              ) : (
                                employee.allowedShiftProfiles.map((p) => (
                                  <Chip
                                    key={p.id}
                                    label={p.name}
                                    size="small"
                                    variant="outlined"
                                    sx={{ fontSize: 10, height: 20 }}
                                  />
                                ))
                              )}
                              {employee.isFullTimeBl && (
                                <Chip label="VZ-BL" size="small" color="secondary" sx={{ fontSize: 10, height: 20 }} />
                              )}
                            </Box>
                            {employee.shiftDistribution && Object.keys(employee.shiftDistribution).length > 0 && (
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25, fontSize: 10 }}>
                                {employee.allowedShiftProfiles
                                  .filter((p) => employee.shiftDistribution?.[p.id] != null)
                                  .map((p) => `${p.name}: ${employee.shiftDistribution![p.id]}%`)
                                  .join(", ")}
                              </Typography>
                            )}
                          </TableCell>
                          {/* Arbeitstage */}
                          <TableCell>
                            {employee.fixedWorkingDays && employee.fixedWorkingDays.length > 0 ? (
                              <Typography variant="caption" sx={{ fontSize: 11 }}>
                                {employee.fixedWorkingDays.map((d) => WEEKDAY_LABELS[d] ?? d).join(", ")}
                              </Typography>
                            ) : (
                              <Typography variant="caption" color="text.secondary">Alle</Typography>
                            )}
                          </TableCell>
                          {/* Max aufeinanderfolgende Tage */}
                          <TableCell>
                            {employee.maxConsecutiveDays != null ? (
                              <Typography variant="caption" sx={{ fontSize: 11 }}>{employee.maxConsecutiveDays}</Typography>
                            ) : (
                              <Typography variant="caption" color="text.secondary">—</Typography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            <IconButton
                              size="small"
                              aria-label="Bearbeiten"
                              onClick={() => openEditDialog(employee)}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              aria-label="Löschen"
                              color="error"
                              onClick={() => setDeleteTarget(employee)}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: "divider" }}
          >
            {loading ? "…" : `${filtered.length} Mitarbeiter`}
          </Typography>
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => !saving && (setDialogOpen(false), resetForm())}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle sx={{ pb: 0.5 }}>
          {editingId ? "Mitarbeiter bearbeiten" : "Mitarbeiter hinzufügen"}
        </DialogTitle>
        <DialogContent
          sx={{
            pt: 1,
            maxHeight: "75vh",
            overflowY: "auto",
          }}
        >
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}

          <Box sx={{ display: "flex", gap: 3 }}>
            {/* ── LEFT COLUMN ── */}
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>

              {/* Section: Persönliche Daten */}
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1 }}>
                Persönliche Daten
              </Typography>
              <Box sx={{ display: "flex", gap: 2 }}>
                <TextField
                  label="Vorname"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  fullWidth
                  autoFocus
                  disabled={saving}
                  size="small"
                />
                <TextField
                  label="Nachname"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  fullWidth
                  disabled={saving}
                  size="small"
                />
              </Box>
              <Box sx={{ display: "flex", gap: 2 }}>
                <TextField
                  select
                  label="Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as StatusType)}
                  fullWidth
                  disabled={saving}
                  size="small"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <MenuItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>

              <Divider sx={{ my: 0.5 }} />

              {/* Section: Vertrag & Arbeitszeit */}
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1 }}>
                Vertrag & Arbeitszeit
              </Typography>
              <Box sx={{ display: "flex", gap: 2 }}>
                <TextField
                  select
                  label="Vertragsart"
                  value={contractType}
                  onChange={(e) => {
                    setContractType(e.target.value as ContractType);
                    if (!profilesTouched) return;
                    setProfilesTouched(false);
                  }}
                  fullWidth
                  disabled={saving}
                  size="small"
                >
                  <MenuItem value="FULL_TIME">Vollzeit</MenuItem>
                  <MenuItem value="PART_TIME">Teilzeit</MenuItem>
                  <MenuItem value="MINI_JOB">Mini-Job</MenuItem>
                  <MenuItem value="AUSBILDUNG">Ausbildung</MenuItem>
                </TextField>
                <TextField
                  label="Soll-Stunden (%)"
                  value={percentStr}
                  onChange={(e) => setPercentStr(e.target.value)}
                  fullWidth
                  disabled={saving}
                  size="small"
                  helperText={`100% = ${String(REFERENCE_FULL_TIME_MONTHLY_HOURS).replace(".", ",")} h/Monat`}
                />
              </Box>
              {contractType === "MINI_JOB" && (
                <TextField
                  label="Max. Stunden pro Monat"
                  value={miniStr}
                  onChange={(e) => setMiniStr(e.target.value)}
                  fullWidth
                  disabled={saving}
                  size="small"
                  helperText="Leer = Standard der Einrichtung"
                />
              )}

              <Divider sx={{ my: 0.5 }} />

              {/* Section: Qualifikationen */}
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1 }}>
                Qualifikationen
              </Typography>
              <Autocomplete
                multiple
                openOnFocus
                options={qualCatalog}
                value={selectedQuals}
                onChange={(_, v) => {
                  setSelectedQuals(v);
                  if (profilesTouched) setProfilesTouched(false);
                }}
                getOptionLabel={(o) => `${o.name} (${o.abbreviation})`}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                disableCloseOnSelect
                size="small"
                renderOption={(props, option, { selected }) => (
                  <li {...props} key={option.id}>
                    <Checkbox size="small" checked={selected} sx={{ mr: 1 }} />
                    {option.name} ({option.abbreviation})
                  </li>
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option.abbreviation}
                      size="small"
                      {...getTagProps({ index })}
                      key={option.id}
                    />
                  ))
                }
                renderInput={(params) => (
                  <TextField {...params} label="Qualifikationen" placeholder="Qualifikation wählen" />
                )}
                disabled={saving}
              />

            </Box>

            {/* ── RIGHT COLUMN ── */}
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>

              {/* Section: Schichtplanung */}
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1 }}>
                Schichtplanung
              </Typography>
              <Autocomplete
                multiple
                openOnFocus
                options={shiftProfileCatalog}
                value={selectedProfiles}
                onChange={(_, v) => {
                  setSelectedProfiles(v);
                  setProfilesTouched(true);
                }}
                getOptionLabel={(o) =>
                  `${o.name} (${SHIFT_TYPE_LABELS[o.shiftType] ?? o.shiftType})`
                }
                isOptionEqualToValue={(a, b) => a.id === b.id}
                disableCloseOnSelect
                size="small"
                renderOption={(props, option, { selected }) => (
                  <li {...props} key={option.id}>
                    <Checkbox size="small" checked={selected} sx={{ mr: 1 }} />
                    {option.name} ({SHIFT_TYPE_LABELS[option.shiftType] ?? option.shiftType})
                  </li>
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip variant="outlined" label={option.name} size="small" {...getTagProps({ index })} key={option.id} />
                  ))
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Erlaubte Schichtprofile"
                    placeholder="Profil wählen"
                    error={selectedProfiles.length === 0 && profilesTouched}
                    helperText={
                      selectedProfiles.length === 0 && profilesTouched
                        ? "Mindestens ein Schichtprofil erforderlich"
                        : "Automatisch aus Vertragsart + Qualifikation"
                    }
                  />
                )}
                disabled={saving}
              />

              {selectedProfiles.some((p) => p.shiftType === "BL") && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Checkbox
                    checked={isFullTimeBl}
                    onChange={(e) => setIsFullTimeBl(e.target.checked)}
                    disabled={saving}
                    size="small"
                  />
                  <Typography variant="body2">Vollzeit-BL (jeden Tag)</Typography>
                </Box>
              )}

              {selectedProfiles.length >= 2 && (
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                    Schichtverteilung (optional)
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                    {selectedProfiles.map((sp) => (
                      <TextField
                        key={sp.id}
                        label={sp.name}
                        value={shiftDistribution[sp.id] ?? ""}
                        onChange={(e) =>
                          setShiftDistribution((prev) => ({ ...prev, [sp.id]: e.target.value }))
                        }
                        size="small"
                        sx={{ width: 90 }}
                        disabled={saving}
                        slotProps={{
                          input: {
                            endAdornment: <InputAdornment position="end">%</InputAdornment>,
                          },
                        }}
                      />
                    ))}
                  </Box>
                </Box>
              )}

              <Divider sx={{ my: 0.5 }} />

              {/* Section: Einsatzregeln */}
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 1 }}>
                Einsatzregeln
              </Typography>
              <TextField
                select
                label="Feste Station(en)"
                value={assignedStations}
                onChange={(e) => {
                  const v = e.target.value;
                  setAssignedStations(
                    typeof v === "string"
                      ? v.split(",").map(Number).filter(Boolean)
                      : (v as number[]),
                  );
                }}
                fullWidth
                disabled={saving}
                size="small"
                helperText={
                  assignedStations.length === 0
                    ? "Alle Stationen möglich"
                    : `Nur Station ${assignedStations.join(" + ")}`
                }
                slotProps={{
                  select: {
                    multiple: true,
                    renderValue: (selected) => {
                      const sel = selected as number[];
                      return sel.length === 0
                        ? "Alle Stationen"
                        : sel.map((s) => `St. ${s}`).join(", ");
                    },
                  },
                }}
              >
                {[1, 2, 3].map((st) => (
                  <MenuItem key={st} value={st}>
                    <Checkbox checked={assignedStations.includes(st)} size="small" />
                    Station {st}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                select
                label="Feste Arbeitstage"
                value={fixedWorkingDays}
                onChange={(e) => {
                  const v = e.target.value;
                  setFixedWorkingDays(
                    typeof v === "string"
                      ? v.split(",").map(Number).filter(Boolean)
                      : (v as number[]),
                  );
                }}
                fullWidth
                disabled={saving}
                size="small"
                helperText={
                  fixedWorkingDays.length === 0
                    ? "Alle Tage"
                    : `Nur: ${fixedWorkingDays.map((d) => WEEKDAY_LABELS[d]).join(", ")}`
                }
                slotProps={{
                  select: {
                    multiple: true,
                    renderValue: (selected) => {
                      const sel = selected as number[];
                      return sel.length === 0
                        ? "Alle Tage"
                        : sel.map((d) => WEEKDAY_LABELS[d] ?? d).join(", ");
                    },
                  },
                }}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <MenuItem key={d} value={d}>
                    <Checkbox checked={fixedWorkingDays.includes(d)} size="small" />
                    {WEEKDAY_LABELS[d]}
                  </MenuItem>
                ))}
              </TextField>

              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Checkbox
                  checked={maxConsecOverride}
                  onChange={(e) => {
                    setMaxConsecOverride(e.target.checked);
                    if (e.target.checked && !maxConsecDays) {
                      setMaxConsecDays(String(globalMaxConsecDays));
                    }
                  }}
                  disabled={saving}
                  size="small"
                />
                <Typography variant="body2">Max. aufeinanderfolgende Tage</Typography>
                {maxConsecOverride && (
                  <TextField
                    value={maxConsecDays}
                    onChange={(e) => setMaxConsecDays(e.target.value)}
                    size="small"
                    disabled={saving}
                    type="number"
                    sx={{ width: 70 }}
                    slotProps={{ htmlInput: { min: 1, max: 31 } }}
                  />
                )}
              </Box>

            </Box>
          </Box>

        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDialogOpen(false);
              resetForm();
            }}
            disabled={saving}
          >
            Abbrechen
          </Button>
          <Button
            variant="contained"
            onClick={() => void submitEmployee()}
            disabled={saving}
          >
            {saving ? <CircularProgress size={22} /> : "Speichern"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteTarget !== null}
        onClose={() => !deleteBusy && setDeleteTarget(null)}
      >
        <DialogTitle>Mitarbeiter löschen?</DialogTitle>
        <DialogContent>
          <Typography>
            {deleteTarget
              ? `„${deleteTarget.firstName} ${deleteTarget.lastName}" wirklich löschen? Zugehörige Zuweisungen und Wünsche werden mit entfernt.`
              : ""}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
            Abbrechen
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void confirmDelete()}
            disabled={deleteBusy}
          >
            {deleteBusy ? (
              <CircularProgress size={22} color="inherit" />
            ) : (
              "Löschen"
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </MainLayout>
  );
}
