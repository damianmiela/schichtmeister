"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MainLayout from "@/components/layout/MainLayout";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Divider,
  Grid,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  IconButton,
  Autocomplete,
  Chip,
  Tooltip,
  alpha,
  useTheme,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import GridOnIcon from "@mui/icons-material/GridOn";
import WbSunnyIcon from "@mui/icons-material/WbSunny";
import WbTwilightIcon from "@mui/icons-material/WbTwilight";
import NightsStayIcon from "@mui/icons-material/NightsStay";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

const SHIFT_TYPES = ["EARLY", "LATE", "NIGHT"] as const;
type ShiftTypeValue = (typeof SHIFT_TYPES)[number];
const STATIONS = [1, 2, 3] as const;

const SHIFT_ICON: Record<string, React.ReactNode> = {
  EARLY: <WbSunnyIcon fontSize="small" sx={{ color: "warning.main" }} />,
  LATE: <WbTwilightIcon fontSize="small" sx={{ color: "info.main" }} />,
  NIGHT: <NightsStayIcon fontSize="small" sx={{ color: "secondary.main" }} />,
};

type QualificationRow = {
  id: string;
  qualificationTag: string;
  minCount: number;
};

type StaffingRow = {
  id: string;
  shiftType: string;
  stationNumber: number;
  minTotalCount: number;
  qualificationRequirements: QualificationRow[];
};

type RuleEntry = {
  id: string;
  description: string;
  severity: string;
  scope: string;
  enabled: boolean;
  params: Record<string, unknown>;
};

type FacilityRulesResponse = {
  minRestHours: number;
  miniJobMaxMonthlyHours: number;
  rules: RuleEntry[];
};

type EmployeeTagSource = { qualificationTags: string[] };

const HIDDEN_RULES = new Set([
  "noOverlap",
  "miniJobMonthlyHours",
  "staffingMinimum",
  "qualificationCoverage",
  "wishFulfillment",
  "fairnessCounters",
  "targetHoursBalance",
]);

const RULE_LABELS: Record<string, string> = {
  minRestBetweenShifts: "Mindestruhezeit zwischen Schichten",
  maxConsecutiveNights: "Max. aufeinanderfolgende Nachtschichten",
  maxConsecutiveDays: "Max. aufeinanderfolgende Arbeitstage",
};

const PARAM_LABELS: Record<string, string> = {
  maxCount: "Maximale Nächte",
  maxDays: "Maximale Tage",
  requiredRestDays: "Erforderliche Ruhetage danach",
};

function extractApiError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    const b = e.body;
    if (
      b &&
      typeof b === "object" &&
      b !== null &&
      "error" in b &&
      typeof (b as { error: unknown }).error === "string"
    ) {
      return (b as { error: string }).error;
    }
    return fallback;
  }
  return "Netzwerkfehler";
}

export default function SettingsPage() {
  const theme = useTheme();

  // --- Staffing state ---
  const [staffing, setStaffing] = useState<StaffingRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeTagSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [newShift, setNewShift] = useState<ShiftTypeValue>("EARLY");
  const [newStation, setNewStation] = useState(1);
  const [newMin, setNewMin] = useState("1");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // --- Qualification sub-row add state ---
  const [addQualSrId, setAddQualSrId] = useState<string | null>(null);
  const [newQualTag, setNewQualTag] = useState("");
  const [newQualMin, setNewQualMin] = useState("1");
  const [addQualBusy, setAddQualBusy] = useState(false);
  const [addQualError, setAddQualError] = useState<string | null>(null);

  // --- Planning rules state ---
  const [rulesData, setRulesData] = useState<FacilityRulesResponse | null>(
    null,
  );
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesDraft, setRulesDraft] = useState<
    Record<string, { enabled: boolean; params: Record<string, string> }>
  >({});
  const [minRestHoursDraft, setMinRestHoursDraft] = useState("");
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesSuccess, setRulesSuccess] = useState(false);

  const qualificationTagOptions = useMemo(() => {
    const s = new Set<string>();
    for (const e of employees) {
      for (const t of e.qualificationTags) {
        if (t.trim()) s.add(t.trim());
      }
    }
    return [...s].sort((a, b) => a.localeCompare(b, "de"));
  }, [employees]);

  // --- Load staffing ---
  const loadStaffing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [staffRes, empRes] = await Promise.all([
        fetchJson<{ staffingRequirements: StaffingRow[] }>(
          "/api/staffing-requirements",
        ),
        fetchJson<{ employees: EmployeeTagSource[] }>("/api/employees"),
      ]);
      setStaffing(staffRes.staffingRequirements);
      setEmployees(empRes.employees ?? []);
      const d: Record<string, string> = {};
      for (const r of staffRes.staffingRequirements) {
        d[r.id] = String(r.minTotalCount);
      }
      setDraft(d);
    } catch (e) {
      setError(extractApiError(e, "Laden fehlgeschlagen."));
      setStaffing([]);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // --- Load rules ---
  const loadRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      const data = await fetchJson<FacilityRulesResponse>(
        "/api/facility/rules",
      );
      setRulesData(data);
      setMinRestHoursDraft(String(data.minRestHours));
      const d: Record<
        string,
        { enabled: boolean; params: Record<string, string> }
      > = {};
      for (const r of data.rules) {
        const params: Record<string, string> = {};
        for (const [k, v] of Object.entries(r.params)) {
          params[k] = String(v ?? "");
        }
        d[r.id] = { enabled: r.enabled, params };
      }
      setRulesDraft(d);
    } catch {
      setRulesData(null);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStaffing();
    void loadRules();
  }, [loadStaffing, loadRules]);

  // --- Staffing grouped by station ---
  const staffingByStation = useMemo(() => {
    const map = new Map<number, Map<string, StaffingRow>>();
    for (const st of STATIONS) map.set(st, new Map());
    for (const r of staffing) {
      map.get(r.stationNumber)?.set(r.shiftType, r);
    }
    return map;
  }, [staffing]);

  const missingCombos = useMemo(() => {
    const have = new Set(
      staffing.map((r) => `${r.shiftType}:${r.stationNumber}`),
    );
    const missing: { shiftType: ShiftTypeValue; stationNumber: number }[] = [];
    for (const st of STATIONS) {
      for (const shift of SHIFT_TYPES) {
        if (!have.has(`${shift}:${st}`))
          missing.push({ shiftType: shift, stationNumber: st });
      }
    }
    return missing;
  }, [staffing]);

  // --- Staffing actions ---
  const saveRow = async (id: string) => {
    const raw = draft[id];
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      setError("Mindestanzahl: gültige Zahl >= 0.");
      return;
    }
    setSavingId(id);
    setError(null);
    try {
      await fetchJson(`/api/staffing-requirements/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ minTotalCount: Math.floor(n) }),
      });
      await loadStaffing();
    } catch (e) {
      setError(extractApiError(e, "Speichern fehlgeschlagen."));
    } finally {
      setSavingId(null);
    }
  };

  const applyAllShiftsTemplate = async () => {
    setTemplateBusy(true);
    setError(null);
    try {
      const have = new Set(
        staffing.map((r) => `${r.shiftType}:${r.stationNumber}`),
      );
      for (const station of STATIONS) {
        for (const st of SHIFT_TYPES) {
          const key = `${st}:${station}`;
          if (have.has(key)) continue;
          await fetchJson("/api/staffing-requirements", {
            method: "POST",
            body: JSON.stringify({
              shiftType: st,
              stationNumber: station,
              minTotalCount: 1,
            }),
          });
          have.add(key);
        }
      }
      await loadStaffing();
    } catch (e) {
      setError(extractApiError(e, "Anlegen fehlgeschlagen."));
    } finally {
      setTemplateBusy(false);
    }
  };

  const openAddDialog = () => {
    if (missingCombos.length === 0) return;
    setAddFormError(null);
    setNewShift(missingCombos[0]?.shiftType ?? "EARLY");
    setNewStation(missingCombos[0]?.stationNumber ?? 1);
    setNewMin("1");
    setAddOpen(true);
  };

  const submitAdd = async () => {
    const n = Number(newMin.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      setAddFormError("Minimum: gültige Zahl >= 0.");
      return;
    }
    if (
      staffing.some(
        (r) => r.shiftType === newShift && r.stationNumber === newStation,
      )
    ) {
      setAddFormError(
        "Für diesen Schichttyp und Station existiert bereits ein Eintrag.",
      );
      return;
    }
    setAddBusy(true);
    setAddFormError(null);
    setError(null);
    try {
      await fetchJson("/api/staffing-requirements", {
        method: "POST",
        body: JSON.stringify({
          shiftType: newShift,
          stationNumber: newStation,
          minTotalCount: Math.floor(n),
        }),
      });
      setAddOpen(false);
      await loadStaffing();
    } catch (e) {
      setAddFormError(extractApiError(e, "Anlegen fehlgeschlagen."));
    } finally {
      setAddBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/staffing-requirements/${deleteId}`, {
        method: "DELETE",
      });
      setDeleteId(null);
      await loadStaffing();
    } catch (e) {
      setError(extractApiError(e, "Löschen fehlgeschlagen."));
    } finally {
      setDeleteBusy(false);
    }
  };

  // --- Qualification sub-row actions ---
  const addQualification = async () => {
    if (!addQualSrId || !newQualTag.trim()) return;
    const minVal = Number(newQualMin);
    if (!Number.isFinite(minVal) || minVal < 1) {
      setAddQualError("Mindestens 1.");
      return;
    }
    setAddQualBusy(true);
    setAddQualError(null);
    try {
      await fetchJson(
        `/api/staffing-requirements/${addQualSrId}/qualifications`,
        {
          method: "POST",
          body: JSON.stringify({
            qualificationTag: newQualTag.trim(),
            minCount: Math.floor(minVal),
          }),
        },
      );
      setAddQualSrId(null);
      setNewQualTag("");
      setNewQualMin("1");
      await loadStaffing();
    } catch (e) {
      setAddQualError(extractApiError(e, "Anlegen fehlgeschlagen."));
    } finally {
      setAddQualBusy(false);
    }
  };

  const deleteQualification = async (srId: string, qId: string) => {
    setError(null);
    try {
      await fetchJson(
        `/api/staffing-requirements/${srId}/qualifications/${qId}`,
        { method: "DELETE" },
      );
      await loadStaffing();
    } catch (e) {
      setError(extractApiError(e, "Löschen fehlgeschlagen."));
    }
  };

  const updateQualMinCount = async (
    srId: string,
    qId: string,
    minCount: number,
  ) => {
    if (minCount < 1) return;
    setError(null);
    try {
      await fetchJson(
        `/api/staffing-requirements/${srId}/qualifications/${qId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ minCount }),
        },
      );
      await loadStaffing();
    } catch (e) {
      setError(extractApiError(e, "Speichern fehlgeschlagen."));
    }
  };

  // --- Rules actions ---
  const saveRules = async () => {
    setRulesSaving(true);
    setRulesError(null);
    setRulesSuccess(false);
    try {
      const overrides: Record<
        string,
        { enabled?: boolean; params?: Record<string, unknown> }
      > = {};
      for (const [ruleId, d] of Object.entries(rulesDraft)) {
        const original = rulesData?.rules.find((r) => r.id === ruleId);
        if (!original) continue;
        const params: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(d.params)) {
          const num = Number(v);
          params[k] = Number.isFinite(num) ? num : v;
        }
        overrides[ruleId] = { enabled: d.enabled, params };
      }

      const minRestVal = Number(minRestHoursDraft);
      await fetchJson("/api/facility/rules", {
        method: "PATCH",
        body: JSON.stringify({
          ruleOverrides: overrides,
          ...(Number.isFinite(minRestVal) && minRestVal >= 0
            ? { minRestHours: minRestVal }
            : {}),
        }),
      });
      setRulesSuccess(true);
      await loadRules();
    } catch (e) {
      setRulesError(extractApiError(e, "Speichern fehlgeschlagen."));
    } finally {
      setRulesSaving(false);
    }
  };

  const visibleRules = useMemo(
    () => (rulesData?.rules ?? []).filter((r) => !HIDDEN_RULES.has(r.id)),
    [rulesData],
  );

  // --- Shift row component inside a station card ---
  const renderShiftRow = (station: number, shiftType: ShiftTypeValue) => {
    const row = staffingByStation.get(station)?.get(shiftType);
    if (!row) {
      return (
        <Box
          key={shiftType}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            py: 1.5,
            px: 2,
            borderBottom: "1px solid",
            borderColor: "divider",
            opacity: 0.5,
          }}
        >
          {SHIFT_ICON[shiftType]}
          <Typography variant="body2" sx={{ minWidth: 60 }}>
            {shiftTypeLabel(shiftType)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Nicht konfiguriert
          </Typography>
        </Box>
      );
    }

    return (
      <Box
        key={shiftType}
        sx={{
          py: 1.5,
          px: 2,
          borderBottom: "1px solid",
          borderColor: "divider",
          "&:last-child": { borderBottom: "none" },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          {SHIFT_ICON[shiftType]}
          <Typography variant="body2" fontWeight={600} sx={{ minWidth: 60 }}>
            {shiftTypeLabel(shiftType)}
          </Typography>

          <Tooltip title="Mindestbesetzung pro Tag" arrow>
            <TextField
              size="small"
              type="number"
              value={draft[row.id] ?? ""}
              onChange={(ev) =>
                setDraft((prev) => ({ ...prev, [row.id]: ev.target.value }))
              }
              inputProps={{ min: 0, style: { textAlign: "center" } }}
              sx={{ width: 64 }}
            />
          </Tooltip>

          <Typography variant="caption" color="text.secondary">
            MA / Tag
          </Typography>

          <Box sx={{ flex: 1 }} />

          <Button
            size="small"
            variant="text"
            disabled={savingId === row.id}
            onClick={() => void saveRow(row.id)}
            sx={{ minWidth: 0, px: 1 }}
          >
            {savingId === row.id ? (
              <CircularProgress size={16} />
            ) : (
              <SaveIcon fontSize="small" />
            )}
          </Button>

          <IconButton
            size="small"
            color="error"
            onClick={() => setDeleteId(row.id)}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* Qualification chips */}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 1, ml: 4.5 }}>
          {row.qualificationRequirements.map((q) => (
            <Chip
              key={q.id}
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <span>{q.qualificationTag}</span>
                  <TextField
                    size="small"
                    type="number"
                    defaultValue={q.minCount}
                    inputProps={{
                      min: 1,
                      style: {
                        width: 28,
                        padding: "1px 2px",
                        textAlign: "center",
                        fontSize: 12,
                      },
                    }}
                    variant="standard"
                    sx={{ "& .MuiInput-underline:before": { borderBottom: "none" } }}
                    onBlur={(e) => {
                      const val = Number(e.target.value);
                      if (val !== q.minCount && val >= 1) {
                        void updateQualMinCount(row.id, q.id, val);
                      }
                    }}
                  />
                </Box>
              }
              size="small"
              variant="outlined"
              onDelete={() => void deleteQualification(row.id, q.id)}
              sx={{ height: 28 }}
            />
          ))}
          <Chip
            icon={<AddIcon sx={{ fontSize: 16 }} />}
            label="Qualifikation"
            size="small"
            variant="outlined"
            onClick={() => {
              setAddQualSrId(row.id);
              setNewQualTag("");
              setNewQualMin("1");
              setAddQualError(null);
            }}
            sx={{
              height: 28,
              borderStyle: "dashed",
              cursor: "pointer",
              "&:hover": { borderStyle: "solid" },
            }}
          />
        </Box>
      </Box>
    );
  };

  return (
    <MainLayout title="Einstellungen">
      <Grid container spacing={3}>
        {/* Facility info card */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Einrichtung
              </Typography>
              <Divider sx={{ mb: 3 }} />
              <Typography variant="body2" color="text.secondary">
                Name und Adresse werden in einer späteren Version über die API
                gepflegt.
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Notifications card */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Benachrichtigungen
              </Typography>
              <Divider sx={{ mb: 3 }} />
              <Typography variant="body2" color="text.secondary">
                E-Mail-Benachrichtigungen können später über externe Automation
                (z.B. Webhooks) ergänzt werden.
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Staffing requirements - grouped by station */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  mb: 1,
                }}
              >
                <Typography variant="h6">
                  Mindestbesetzung (Personalbedarf)
                </Typography>
                <Box sx={{ display: "flex", gap: 1 }}>
                  {missingCombos.length > 0 && (
                    <>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<AddIcon />}
                        disabled={loading}
                        onClick={openAddDialog}
                      >
                        Einzeln hinzufügen
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={
                          templateBusy ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <GridOnIcon />
                          )
                        }
                        disabled={templateBusy || loading}
                        onClick={() => void applyAllShiftsTemplate()}
                      >
                        Fehlende anlegen
                      </Button>
                    </>
                  )}
                </Box>
              </Box>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 2 }}
              >
                Mindestanzahl Mitarbeiter pro Schicht und Station, die jeden
                Kalendertag benötigt wird. Qualifikationsanforderungen (z.B.
                &quot;mind. 1 Fachkraft&quot;) können pro Schicht hinzugefügt
                werden.
              </Typography>
              <Divider sx={{ mb: 2 }} />

              {error && (
                <Alert
                  severity="error"
                  sx={{ mb: 2 }}
                  onClose={() => setError(null)}
                >
                  {error}
                </Alert>
              )}

              {loading ? (
                <Box
                  sx={{ display: "flex", justifyContent: "center", py: 4 }}
                >
                  <CircularProgress />
                </Box>
              ) : staffing.length === 0 ? (
                <Alert severity="info">
                  Noch kein Personalbedarf konfiguriert. Klicken Sie auf
                  &quot;Fehlende anlegen&quot; um alle 9 Einträge (Früh / Spät
                  / Nacht × 3 Stationen) mit Minimum 1 zu erstellen.
                </Alert>
              ) : (
                <Grid container spacing={2}>
                  {STATIONS.map((station) => {
                    const stationShifts = staffingByStation.get(station);
                    const totalMin = SHIFT_TYPES.reduce((sum, st) => {
                      const row = stationShifts?.get(st);
                      return sum + (row?.minTotalCount ?? 0);
                    }, 0);

                    return (
                      <Grid key={station} size={{ xs: 12, md: 4 }}>
                        <Card
                          variant="outlined"
                          sx={{
                            borderColor: alpha(theme.palette.primary.main, 0.3),
                          }}
                        >
                          <Box
                            sx={{
                              px: 2,
                              py: 1.5,
                              bgcolor: alpha(theme.palette.primary.main, 0.06),
                              borderBottom: "1px solid",
                              borderColor: "divider",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <Typography variant="subtitle1" fontWeight={700}>
                              Station {station}
                            </Typography>
                            <Chip
                              label={`${totalMin} MA / Tag`}
                              size="small"
                              color="primary"
                              variant="outlined"
                              sx={{ fontWeight: 600 }}
                            />
                          </Box>
                          {SHIFT_TYPES.map((st) => renderShiftRow(station, st))}
                        </Card>
                      </Grid>
                    );
                  })}
                </Grid>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Planning rules */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Planungsregeln
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 2 }}
              >
                Passen Sie die Parameter der Planungsregeln an. Änderungen
                wirken sich auf die nächste Plangenerierung aus.
              </Typography>
              <Divider sx={{ mb: 2 }} />

              {rulesError && (
                <Alert
                  severity="error"
                  sx={{ mb: 2 }}
                  onClose={() => setRulesError(null)}
                >
                  {rulesError}
                </Alert>
              )}
              {rulesSuccess && (
                <Alert
                  severity="success"
                  sx={{ mb: 2 }}
                  onClose={() => setRulesSuccess(false)}
                >
                  Regeln gespeichert.
                </Alert>
              )}

              {rulesLoading ? (
                <Box
                  sx={{ display: "flex", justifyContent: "center", py: 4 }}
                >
                  <CircularProgress />
                </Box>
              ) : rulesData ? (
                <>
                  {/* minRestBetweenShifts — special: value comes from Facility.minRestHours */}
                  <Box
                    sx={{
                      mb: 2,
                      p: 2,
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1,
                    }}
                  >
                    <Typography variant="subtitle2" gutterBottom>
                      {RULE_LABELS["minRestBetweenShifts"]}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mb: 1.5 }}
                    >
                      Mindestanzahl Stunden Ruhezeit zwischen dem Ende einer
                      Schicht und dem Beginn der nächsten.
                    </Typography>
                    <TextField
                      label="Mindestruhezeit (Stunden)"
                      size="small"
                      type="number"
                      value={minRestHoursDraft}
                      onChange={(e) => setMinRestHoursDraft(e.target.value)}
                      inputProps={{ min: 0, step: 1 }}
                      sx={{ width: 200 }}
                    />
                  </Box>

                  {/* Other configurable rules (maxConsecutiveNights, maxConsecutiveDays) */}
                  {visibleRules
                    .filter((r) => r.id !== "minRestBetweenShifts")
                    .map((rule) => {
                      const d = rulesDraft[rule.id];
                      if (!d) return null;
                      const paramKeys = Object.keys(rule.params);
                      if (paramKeys.length === 0) return null;

                      return (
                        <Box
                          key={rule.id}
                          sx={{
                            mb: 2,
                            p: 2,
                            border: "1px solid",
                            borderColor: "divider",
                            borderRadius: 1,
                          }}
                        >
                          <Typography variant="subtitle2" gutterBottom>
                            {RULE_LABELS[rule.id] ?? rule.id}
                          </Typography>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ mb: 1.5 }}
                          >
                            {rule.description}
                          </Typography>
                          <Box
                            sx={{
                              display: "flex",
                              gap: 2,
                              flexWrap: "wrap",
                            }}
                          >
                            {paramKeys.map((k) => (
                              <TextField
                                key={k}
                                label={PARAM_LABELS[k] ?? k}
                                size="small"
                                type="number"
                                value={d.params[k] ?? ""}
                                onChange={(e) =>
                                  setRulesDraft((prev) => ({
                                    ...prev,
                                    [rule.id]: {
                                      ...prev[rule.id],
                                      params: {
                                        ...prev[rule.id].params,
                                        [k]: e.target.value,
                                      },
                                    },
                                  }))
                                }
                                inputProps={{ min: 0 }}
                                sx={{ width: 200 }}
                              />
                            ))}
                          </Box>
                        </Box>
                      );
                    })}

                  <Button
                    variant="contained"
                    startIcon={
                      rulesSaving ? (
                        <CircularProgress size={18} color="inherit" />
                      ) : (
                        <SaveIcon />
                      )
                    }
                    disabled={rulesSaving}
                    onClick={() => void saveRules()}
                    sx={{ mt: 1 }}
                  >
                    Regeln speichern
                  </Button>
                </>
              ) : (
                <Alert severity="warning">
                  Regeln konnten nicht geladen werden.
                </Alert>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Add shift type dialog */}
      <Dialog
        open={addOpen}
        onClose={() => !addBusy && setAddOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Personalbedarfs-Eintrag hinzufügen</DialogTitle>
        <DialogContent
          sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}
        >
          {addFormError && <Alert severity="error">{addFormError}</Alert>}
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              select
              label="Schichttyp"
              value={newShift}
              onChange={(e) => setNewShift(e.target.value as ShiftTypeValue)}
              fullWidth
              disabled={addBusy}
            >
              {SHIFT_TYPES.map((st) => (
                <MenuItem key={st} value={st}>
                  {shiftTypeLabel(st)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Station"
              value={newStation}
              onChange={(e) => setNewStation(Number(e.target.value))}
              fullWidth
              disabled={addBusy}
            >
              <MenuItem value={1}>Station 1</MenuItem>
              <MenuItem value={2}>Station 2</MenuItem>
              <MenuItem value={3}>Station 3</MenuItem>
            </TextField>
          </Box>
          <TextField
            label="Mindestanzahl (pro Kalendertag)"
            type="number"
            value={newMin}
            onChange={(e) => setNewMin(e.target.value)}
            fullWidth
            disabled={addBusy}
            inputProps={{ min: 0 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)} disabled={addBusy}>
            Abbrechen
          </Button>
          <Button
            variant="contained"
            onClick={() => void submitAdd()}
            disabled={addBusy}
          >
            {addBusy ? <CircularProgress size={22} /> : "Anlegen"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={deleteId !== null}
        onClose={() => !deleteBusy && setDeleteId(null)}
      >
        <DialogTitle>Eintrag löschen?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Dieser Personalbedarf und alle zugehörigen
            Qualifikationsanforderungen werden entfernt.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)} disabled={deleteBusy}>
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

      {/* Add qualification dialog */}
      <Dialog
        open={addQualSrId !== null}
        onClose={() => !addQualBusy && setAddQualSrId(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Qualifikation hinzufügen</DialogTitle>
        <DialogContent
          sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}
        >
          {addQualError && <Alert severity="error">{addQualError}</Alert>}
          <Autocomplete
            freeSolo
            options={qualificationTagOptions}
            value={newQualTag}
            onInputChange={(_, v) => setNewQualTag(v)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Qualifikations-Tag"
                placeholder="z.B. Fachkraft, PDL..."
                disabled={addQualBusy}
              />
            )}
          />
          <TextField
            label="Min. Anzahl"
            type="number"
            value={newQualMin}
            onChange={(e) => setNewQualMin(e.target.value)}
            fullWidth
            disabled={addQualBusy}
            inputProps={{ min: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddQualSrId(null)} disabled={addQualBusy}>
            Abbrechen
          </Button>
          <Button
            variant="contained"
            onClick={() => void addQualification()}
            disabled={addQualBusy || !newQualTag.trim()}
          >
            {addQualBusy ? <CircularProgress size={22} /> : "Hinzufügen"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainLayout>
  );
}
