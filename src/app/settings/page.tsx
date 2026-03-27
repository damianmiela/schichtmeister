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
  Switch,
  FormControlLabel,
  Button,
  Divider,
  Grid,
  Alert,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  IconButton,
  Autocomplete,
  Chip,
  Collapse,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import GridOnIcon from "@mui/icons-material/GridOn";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

const SHIFT_TYPES = ["EARLY", "LATE", "NIGHT"] as const;
type ShiftTypeValue = (typeof SHIFT_TYPES)[number];

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

function shiftSortIndex(st: string): number {
  const i = SHIFT_TYPES.indexOf(st as ShiftTypeValue);
  return i === -1 ? 99 : i;
}

function extractApiError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    const b = e.body;
    if (b && typeof b === "object" && b !== null && "error" in b && typeof (b as { error: unknown }).error === "string") {
      return (b as { error: string }).error;
    }
    return fallback;
  }
  return "Netzwerkfehler";
}

export default function SettingsPage() {
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // --- Qualification sub-row add state ---
  const [addQualSrId, setAddQualSrId] = useState<string | null>(null);
  const [newQualTag, setNewQualTag] = useState("");
  const [newQualMin, setNewQualMin] = useState("1");
  const [addQualBusy, setAddQualBusy] = useState(false);
  const [addQualError, setAddQualError] = useState<string | null>(null);

  // --- Planning rules state ---
  const [rulesData, setRulesData] = useState<FacilityRulesResponse | null>(null);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesDraft, setRulesDraft] = useState<Record<string, { enabled: boolean; params: Record<string, string> }>>({});
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
        fetchJson<{ staffingRequirements: StaffingRow[] }>("/api/staffing-requirements"),
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
      const data = await fetchJson<FacilityRulesResponse>("/api/facility/rules");
      setRulesData(data);
      const draft: Record<string, { enabled: boolean; params: Record<string, string> }> = {};
      for (const r of data.rules) {
        const params: Record<string, string> = {};
        for (const [k, v] of Object.entries(r.params)) {
          params[k] = String(v ?? "");
        }
        draft[r.id] = { enabled: r.enabled, params };
      }
      setRulesDraft(draft);
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

  const sortedStaffing = useMemo(
    () => [...staffing].sort((a, b) => {
      const sd = a.stationNumber - b.stationNumber;
      if (sd !== 0) return sd;
      return shiftSortIndex(a.shiftType) - shiftSortIndex(b.shiftType);
    }),
    [staffing],
  );

  const STATIONS = [1, 2, 3] as const;

  const missingCombos = useMemo(() => {
    const have = new Set(staffing.map((r) => `${r.shiftType}:${r.stationNumber}`));
    const missing: { shiftType: ShiftTypeValue; stationNumber: number }[] = [];
    for (const st of STATIONS) {
      for (const shift of SHIFT_TYPES) {
        if (!have.has(`${shift}:${st}`)) missing.push({ shiftType: shift, stationNumber: st });
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
      const have = new Set(staffing.map((r) => `${r.shiftType}:${r.stationNumber}`));
      for (const station of STATIONS) {
        for (const st of SHIFT_TYPES) {
          const key = `${st}:${station}`;
          if (have.has(key)) continue;
          await fetchJson("/api/staffing-requirements", {
            method: "POST",
            body: JSON.stringify({ shiftType: st, stationNumber: station, minTotalCount: 1 }),
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
    if (staffing.some((r) => r.shiftType === newShift && r.stationNumber === newStation)) {
      setAddFormError("Für diesen Schichttyp und Station existiert bereits ein Eintrag.");
      return;
    }
    setAddBusy(true);
    setAddFormError(null);
    setError(null);
    try {
      await fetchJson("/api/staffing-requirements", {
        method: "POST",
        body: JSON.stringify({ shiftType: newShift, stationNumber: newStation, minTotalCount: Math.floor(n) }),
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
      await fetchJson(`/api/staffing-requirements/${deleteId}`, { method: "DELETE" });
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
      await fetchJson(`/api/staffing-requirements/${addQualSrId}/qualifications`, {
        method: "POST",
        body: JSON.stringify({ qualificationTag: newQualTag.trim(), minCount: Math.floor(minVal) }),
      });
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
      await fetchJson(`/api/staffing-requirements/${srId}/qualifications/${qId}`, { method: "DELETE" });
      await loadStaffing();
    } catch (e) {
      setError(extractApiError(e, "Löschen fehlgeschlagen."));
    }
  };

  const updateQualMinCount = async (srId: string, qId: string, minCount: number) => {
    if (minCount < 1) return;
    setError(null);
    try {
      await fetchJson(`/api/staffing-requirements/${srId}/qualifications/${qId}`, {
        method: "PATCH",
        body: JSON.stringify({ minCount }),
      });
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
      const overrides: Record<string, { enabled?: boolean; params?: Record<string, unknown> }> = {};
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
      await fetchJson("/api/facility/rules", {
        method: "PATCH",
        body: JSON.stringify({ ruleOverrides: overrides }),
      });
      setRulesSuccess(true);
      await loadRules();
    } catch (e) {
      setRulesError(extractApiError(e, "Speichern fehlgeschlagen."));
    } finally {
      setRulesSaving(false);
    }
  };

  return (
    <MainLayout title="Einstellungen">
      <Grid container spacing={3}>
        {/* Facility info card */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Einrichtung</Typography>
              <Divider sx={{ mb: 3 }} />
              <Typography variant="body2" color="text.secondary">
                Name und Adresse werden in einer späteren Version über die API gepflegt.
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Notifications card */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Benachrichtigungen</Typography>
              <Divider sx={{ mb: 3 }} />
              <Typography variant="body2" color="text.secondary">
                E-Mail-Benachrichtigungen können später über externe Automation (z.B. Webhooks) ergänzt werden.
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Staffing requirements */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Mindestbesetzung (Personalbedarf)</Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Dieselben Mindestzahlen gelten <strong>jeden Kalendertag</strong>.
                Pro Schichttyp und Station (1–3) gibt es höchstens einen Eintrag mit der Gesamtbesetzung.
                Darunter können Sie Qualifikationsanforderungen hinzufügen (z.B. &quot;3 Fachkraft&quot;).
              </Typography>
              <Divider sx={{ mb: 2 }} />
              {error && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
              )}
              {loading ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <>
                  {staffing.length === 0 && (
                    <Alert severity="info" sx={{ mb: 2 }}>
                      Noch kein Personalbedarf. &quot;Alle Schichttypen × Stationen anlegen&quot; erstellt 9 Einträge (Früh/Spät/Nacht × 3 Stationen) je mit Minimum 1.
                    </Alert>
                  )}
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2 }}>
                    <Button
                      variant="contained"
                      startIcon={templateBusy ? <CircularProgress size={18} color="inherit" /> : <GridOnIcon />}
                      disabled={templateBusy || loading || missingCombos.length === 0}
                      onClick={() => void applyAllShiftsTemplate()}
                    >
                      Alle Schichttypen × Stationen anlegen (fehlende je 1)
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<AddIcon />}
                      disabled={loading || missingCombos.length === 0}
                      onClick={openAddDialog}
                    >
                      Eintrag hinzufügen
                    </Button>
                  </Box>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 40 }} />
                        <TableCell>Schichttyp</TableCell>
                        <TableCell>Station</TableCell>
                        <TableCell sx={{ minWidth: 100 }}>Minimum Gesamt / Tag</TableCell>
                        <TableCell>Qualifikationen</TableCell>
                        <TableCell align="right">Aktion</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedStaffing.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6}>
                            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>Keine Einträge.</Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        sortedStaffing.map((r) => {
                          const isExpanded = !!expanded[r.id];
                          return (
                            <Box component="tbody" key={r.id}>
                              <TableRow>
                                <TableCell sx={{ px: 0.5 }}>
                                  <IconButton size="small" onClick={() => setExpanded((p) => ({ ...p, [r.id]: !isExpanded }))}>
                                    {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                                  </IconButton>
                                </TableCell>
                                <TableCell>{shiftTypeLabel(r.shiftType)}</TableCell>
                                <TableCell>{r.stationNumber}</TableCell>
                                <TableCell>
                                  <TextField
                                    size="small"
                                    type="number"
                                    value={draft[r.id] ?? ""}
                                    onChange={(ev) => setDraft((prev) => ({ ...prev, [r.id]: ev.target.value }))}
                                    inputProps={{ min: 0 }}
                                    sx={{ width: 88 }}
                                  />
                                </TableCell>
                                <TableCell>
                                  {r.qualificationRequirements.length === 0 ? (
                                    <Typography variant="body2" color="text.secondary">Keine</Typography>
                                  ) : (
                                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                                      {r.qualificationRequirements.map((q) => (
                                        <Chip key={q.id} label={`${q.qualificationTag} (min ${q.minCount})`} size="small" variant="outlined" />
                                      ))}
                                    </Box>
                                  )}
                                </TableCell>
                                <TableCell align="right">
                                  <IconButton size="small" color="error" onClick={() => setDeleteId(r.id)}>
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={savingId === r.id ? <CircularProgress size={16} /> : <SaveIcon fontSize="small" />}
                                    disabled={savingId === r.id}
                                    onClick={() => void saveRow(r.id)}
                                    sx={{ ml: 0.5 }}
                                  >
                                    Speichern
                                  </Button>
                                </TableCell>
                              </TableRow>
                              <TableRow>
                                <TableCell colSpan={6} sx={{ py: 0, borderBottom: isExpanded ? undefined : "none" }}>
                                  <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                                    <Box sx={{ py: 1, pl: 4 }}>
                                      <Typography variant="subtitle2" gutterBottom>
                                        Qualifikationsanforderungen
                                      </Typography>
                                      {r.qualificationRequirements.length > 0 && (
                                        <Table size="small" sx={{ mb: 1 }}>
                                          <TableHead>
                                            <TableRow>
                                              <TableCell>Tag</TableCell>
                                              <TableCell sx={{ width: 100 }}>Min. Anzahl</TableCell>
                                              <TableCell sx={{ width: 60 }} />
                                            </TableRow>
                                          </TableHead>
                                          <TableBody>
                                            {r.qualificationRequirements.map((q) => (
                                              <TableRow key={q.id}>
                                                <TableCell>{q.qualificationTag}</TableCell>
                                                <TableCell>
                                                  <TextField
                                                    size="small"
                                                    type="number"
                                                    defaultValue={q.minCount}
                                                    inputProps={{ min: 1 }}
                                                    sx={{ width: 72 }}
                                                    onBlur={(e) => {
                                                      const val = Number(e.target.value);
                                                      if (val !== q.minCount && val >= 1) {
                                                        void updateQualMinCount(r.id, q.id, val);
                                                      }
                                                    }}
                                                  />
                                                </TableCell>
                                                <TableCell>
                                                  <IconButton size="small" color="error" onClick={() => void deleteQualification(r.id, q.id)}>
                                                    <DeleteIcon fontSize="small" />
                                                  </IconButton>
                                                </TableCell>
                                              </TableRow>
                                            ))}
                                          </TableBody>
                                        </Table>
                                      )}
                                      <Button
                                        size="small"
                                        variant="outlined"
                                        startIcon={<AddIcon />}
                                        onClick={() => {
                                          setAddQualSrId(r.id);
                                          setNewQualTag("");
                                          setNewQualMin("1");
                                          setAddQualError(null);
                                        }}
                                      >
                                        Qualifikation hinzufügen
                                      </Button>
                                    </Box>
                                  </Collapse>
                                </TableCell>
                              </TableRow>
                            </Box>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Planning rules */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Planungsregeln</Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Aktivieren oder deaktivieren Sie Planungsregeln und passen Sie deren Parameter an.
                Änderungen wirken sich auf die nächste Plangenerierung aus.
              </Typography>
              <Divider sx={{ mb: 2 }} />
              {rulesError && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setRulesError(null)}>{rulesError}</Alert>
              )}
              {rulesSuccess && (
                <Alert severity="success" sx={{ mb: 2 }} onClose={() => setRulesSuccess(false)}>
                  Regeln gespeichert.
                </Alert>
              )}
              {rulesLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                  <CircularProgress />
                </Box>
              ) : rulesData ? (
                <>
                  {rulesData.rules.map((rule) => {
                    const d = rulesDraft[rule.id];
                    if (!d) return null;
                    const paramKeys = Object.keys(rule.params);
                    return (
                      <Box key={rule.id} sx={{ mb: 2, p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <Box>
                            <Typography variant="subtitle2">{rule.id}</Typography>
                            <Typography variant="body2" color="text.secondary">{rule.description}</Typography>
                            <Box sx={{ display: "flex", gap: 1, mt: 0.5 }}>
                              <Chip label={rule.severity} size="small" color={rule.severity === "hard" ? "error" : "warning"} variant="outlined" />
                              <Chip label={rule.scope} size="small" variant="outlined" />
                            </Box>
                          </Box>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={d.enabled}
                                onChange={(_, checked) =>
                                  setRulesDraft((prev) => ({
                                    ...prev,
                                    [rule.id]: { ...prev[rule.id], enabled: checked },
                                  }))
                                }
                              />
                            }
                            label={d.enabled ? "Aktiv" : "Inaktiv"}
                          />
                        </Box>
                        {paramKeys.length > 0 && (
                          <Box sx={{ display: "flex", gap: 2, mt: 1.5, flexWrap: "wrap" }}>
                            {paramKeys.map((k) => (
                              <TextField
                                key={k}
                                label={k}
                                size="small"
                                value={d.params[k] ?? ""}
                                onChange={(e) =>
                                  setRulesDraft((prev) => ({
                                    ...prev,
                                    [rule.id]: {
                                      ...prev[rule.id],
                                      params: { ...prev[rule.id].params, [k]: e.target.value },
                                    },
                                  }))
                                }
                                sx={{ width: 160 }}
                              />
                            ))}
                          </Box>
                        )}
                      </Box>
                    );
                  })}
                  <Button
                    variant="contained"
                    startIcon={rulesSaving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
                    disabled={rulesSaving}
                    onClick={() => void saveRules()}
                    sx={{ mt: 1 }}
                  >
                    Regeln speichern
                  </Button>
                </>
              ) : (
                <Alert severity="warning">Regeln konnten nicht geladen werden.</Alert>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Add shift type dialog */}
      <Dialog open={addOpen} onClose={() => !addBusy && setAddOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Personalbedarfs-Eintrag hinzufügen</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
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
                <MenuItem key={st} value={st}>{shiftTypeLabel(st)}</MenuItem>
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
          <Button onClick={() => setAddOpen(false)} disabled={addBusy}>Abbrechen</Button>
          <Button variant="contained" onClick={() => void submitAdd()} disabled={addBusy}>
            {addBusy ? <CircularProgress size={22} /> : "Anlegen"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteId !== null} onClose={() => !deleteBusy && setDeleteId(null)}>
        <DialogTitle>Eintrag löschen?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Dieser Personalbedarf und alle zugehörigen Qualifikationsanforderungen werden entfernt.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)} disabled={deleteBusy}>Abbrechen</Button>
          <Button color="error" variant="contained" onClick={() => void confirmDelete()} disabled={deleteBusy}>
            {deleteBusy ? <CircularProgress size={22} color="inherit" /> : "Löschen"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add qualification dialog */}
      <Dialog open={addQualSrId !== null} onClose={() => !addQualBusy && setAddQualSrId(null)} fullWidth maxWidth="xs">
        <DialogTitle>Qualifikation hinzufügen</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
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
          <Button onClick={() => setAddQualSrId(null)} disabled={addQualBusy}>Abbrechen</Button>
          <Button variant="contained" onClick={() => void addQualification()} disabled={addQualBusy || !newQualTag.trim()}>
            {addQualBusy ? <CircularProgress size={22} /> : "Hinzufügen"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainLayout>
  );
}
