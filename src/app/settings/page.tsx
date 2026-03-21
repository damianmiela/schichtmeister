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
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import GridOnIcon from "@mui/icons-material/GridOn";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

const SHIFT_TYPES = ["EARLY", "LATE", "NIGHT"] as const;
type ShiftTypeValue = (typeof SHIFT_TYPES)[number];

type StaffingRow = {
  id: string;
  shiftType: string;
  minStaffCount: number;
  requiredQualificationTags: string[];
};

type EmployeeTagSource = { qualificationTags: string[] };

function shiftSortIndex(st: string): number {
  const i = SHIFT_TYPES.indexOf(st as ShiftTypeValue);
  return i === -1 ? 99 : i;
}

export default function SettingsPage() {
  const [staffing, setStaffing] = useState<StaffingRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeTagSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [tagSelections, setTagSelections] = useState<Record<string, string[]>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [newShift, setNewShift] = useState<ShiftTypeValue>("EARLY");
  const [newMin, setNewMin] = useState("1");
  const [newTags, setNewTags] = useState<string[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const qualificationTagOptions = useMemo(() => {
    const s = new Set<string>();
    for (const e of employees) {
      for (const t of e.qualificationTags) {
        if (t.trim()) s.add(t.trim());
      }
    }
    return [...s].sort((a, b) => a.localeCompare(b, "de"));
  }, [employees]);

  const load = useCallback(async () => {
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
      const ts: Record<string, string[]> = {};
      for (const r of staffRes.staffingRequirements) {
        d[r.id] = String(r.minStaffCount);
        ts[r.id] = [...r.requiredQualificationTags];
      }
      setDraft(d);
      setTagSelections(ts);
    } catch (e) {
      if (e instanceof ApiError) {
        const msg =
          e.body &&
          typeof e.body === "object" &&
          e.body !== null &&
          "error" in e.body &&
          typeof (e.body as { error: unknown }).error === "string"
            ? (e.body as { error: string }).error
            : "Laden fehlgeschlagen.";
        setError(msg);
      } else setError("Netzwerkfehler");
      setStaffing([]);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedStaffing = useMemo(
    () =>
      [...staffing].sort(
        (a, b) => shiftSortIndex(a.shiftType) - shiftSortIndex(b.shiftType),
      ),
    [staffing],
  );

  const missingShiftTypes = useMemo(() => {
    const have = new Set(staffing.map((r) => r.shiftType));
    return SHIFT_TYPES.filter((st) => !have.has(st));
  }, [staffing]);

  const saveRow = async (id: string) => {
    const raw = draft[id];
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      setError("Mindestanzahl: gültige Zahl ≥ 0.");
      return;
    }
    const tags = (tagSelections[id] ?? []).filter((t) => qualificationTagOptions.includes(t));
    setSavingId(id);
    setError(null);
    try {
      await fetchJson(`/api/staffing-requirements/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          minStaffCount: n,
          requiredQualificationTags: tags,
        }),
      });
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        const msg =
          e.body &&
          typeof e.body === "object" &&
          e.body !== null &&
          "error" in e.body &&
          typeof (e.body as { error: unknown }).error === "string"
            ? (e.body as { error: string }).error
            : "Speichern fehlgeschlagen.";
        setError(msg);
      } else setError("Netzwerkfehler");
    } finally {
      setSavingId(null);
    }
  };

  const applyAllShiftsTemplate = async () => {
    setTemplateBusy(true);
    setError(null);
    try {
      const have = new Set(staffing.map((r) => r.shiftType));
      for (const st of SHIFT_TYPES) {
        if (have.has(st)) continue;
        await fetchJson("/api/staffing-requirements", {
          method: "POST",
          body: JSON.stringify({
            shiftType: st,
            minStaffCount: 1,
            requiredQualificationTags: [],
          }),
        });
        have.add(st);
      }
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        const msg =
          e.body &&
          typeof e.body === "object" &&
          e.body !== null &&
          "error" in e.body &&
          typeof (e.body as { error: unknown }).error === "string"
            ? (e.body as { error: string }).error
            : "Anlegen fehlgeschlagen.";
        setError(msg);
      } else setError("Netzwerkfehler");
    } finally {
      setTemplateBusy(false);
    }
  };

  const openAddDialog = () => {
    if (missingShiftTypes.length === 0) return;
    setAddFormError(null);
    setNewShift(missingShiftTypes[0] ?? "EARLY");
    setNewMin("1");
    setNewTags([]);
    setAddOpen(true);
  };

  const submitAdd = async () => {
    const n = Number(newMin.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      setAddFormError("Minimum: gültige Zahl ≥ 0.");
      return;
    }
    if (staffing.some((r) => r.shiftType === newShift)) {
      setAddFormError("Für diesen Schichttyp existiert bereits ein Eintrag.");
      return;
    }
    const tags = newTags.filter((t) => qualificationTagOptions.includes(t));
    setAddBusy(true);
    setAddFormError(null);
    setError(null);
    try {
      await fetchJson("/api/staffing-requirements", {
        method: "POST",
        body: JSON.stringify({
          shiftType: newShift,
          minStaffCount: Math.floor(n),
          requiredQualificationTags: tags,
        }),
      });
      setAddOpen(false);
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        const msg =
          e.body &&
          typeof e.body === "object" &&
          e.body !== null &&
          "error" in e.body &&
          typeof (e.body as { error: unknown }).error === "string"
            ? (e.body as { error: string }).error
            : "Anlegen fehlgeschlagen.";
        setAddFormError(msg);
      } else setAddFormError("Netzwerkfehler");
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
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        const msg =
          e.body &&
          typeof e.body === "object" &&
          e.body !== null &&
          "error" in e.body &&
          typeof (e.body as { error: unknown }).error === "string"
            ? (e.body as { error: string }).error
            : "Löschen fehlgeschlagen.";
        setError(msg);
      } else setError("Netzwerkfehler");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <MainLayout title="Einstellungen">
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Einrichtung
              </Typography>
              <Divider sx={{ mb: 3 }} />
              <Typography variant="body2" color="text.secondary">
                Name und Adresse werden in einer späteren Version über die API gepflegt.
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Regeln
              </Typography>
              <Divider sx={{ mb: 3 }} />
              <Typography variant="body2" color="text.secondary" paragraph>
                Ruhezeiten und Planungsregeln kommen aus der Konfiguration des Servers. UI zum Bearbeiten
                folgt.
              </Typography>
              <FormControlLabel control={<Switch disabled defaultChecked />} label="Überlappende Schichten warnen" />
              <FormControlLabel control={<Switch disabled defaultChecked />} label="Unterbesetzung warnen" />
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Mindestbesetzung (Personalbedarf)
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Dieselben Mindestzahlen gelten <strong>jeden Kalendertag</strong> (kein separates Raster pro
                Wochentag). Pro Schichttyp (Früh / Spät / Nacht) gibt es höchstens einen Eintrag. Qualifikationen
                wählen Sie aus den Begriffen, die bereits bei Mitarbeitern dieser Einrichtung vorkommen.
              </Typography>
              <Divider sx={{ mb: 2 }} />
              {error && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                  {error}
                </Alert>
              )}
              {loading ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <>
                  {staffing.length === 0 && (
                    <Alert severity="info" sx={{ mb: 2 }}>
                      Noch kein Personalbedarf. „Alle Schichttypen anlegen“ erstellt Früh, Spät und Nacht je
                      mit Minimum 1 — anschließend anpassen und speichern.
                    </Alert>
                  )}
                  {qualificationTagOptions.length === 0 && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                      Noch keine Qualifikationsbegriffe bei Mitarbeitern — unter „Mitarbeiter“ Tags pflegen,
                      dann erscheinen sie hier zur Auswahl.
                    </Alert>
                  )}
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2 }}>
                    <Button
                      variant="contained"
                      startIcon={
                        templateBusy ? <CircularProgress size={18} color="inherit" /> : <GridOnIcon />
                      }
                      disabled={templateBusy || loading || missingShiftTypes.length === 0}
                      onClick={() => void applyAllShiftsTemplate()}
                    >
                      Alle Schichttypen anlegen (fehlende je 1)
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<AddIcon />}
                      disabled={loading || missingShiftTypes.length === 0}
                      onClick={openAddDialog}
                    >
                      Schichttyp hinzufügen
                    </Button>
                  </Box>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Schichttyp</TableCell>
                        <TableCell sx={{ minWidth: 100 }}>Minimum / Tag</TableCell>
                        <TableCell sx={{ minWidth: 280 }}>Qualifikationen</TableCell>
                        <TableCell align="right">Aktion</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedStaffing.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4}>
                            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                              Keine Einträge.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        sortedStaffing.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell>{shiftTypeLabel(r.shiftType)}</TableCell>
                            <TableCell>
                              <TextField
                                size="small"
                                type="number"
                                value={draft[r.id] ?? ""}
                                onChange={(ev) =>
                                  setDraft((prev) => ({ ...prev, [r.id]: ev.target.value }))
                                }
                                inputProps={{ min: 0 }}
                                sx={{ width: 88 }}
                              />
                            </TableCell>
                            <TableCell>
                              <Autocomplete
                                multiple
                                options={qualificationTagOptions}
                                value={tagSelections[r.id] ?? []}
                                onChange={(_, v) =>
                                  setTagSelections((prev) => ({ ...prev, [r.id]: v }))
                                }
                                disableCloseOnSelect
                                disabled={qualificationTagOptions.length === 0}
                                renderTags={(value, getTagProps) =>
                                  value.map((option, index) => (
                                    <Chip
                                      variant="outlined"
                                      label={option}
                                      {...getTagProps({ index })}
                                      key={option}
                                    />
                                  ))
                                }
                                renderInput={(params) => (
                                  <TextField
                                    {...params}
                                    placeholder={
                                      qualificationTagOptions.length === 0
                                        ? "Zuerst Tags bei Mitarbeitern anlegen"
                                        : "Aus Liste wählen"
                                    }
                                    size="small"
                                  />
                                )}
                              />
                            </TableCell>
                            <TableCell align="right">
                              <IconButton
                                size="small"
                                aria-label="Löschen"
                                color="error"
                                onClick={() => setDeleteId(r.id)}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={
                                  savingId === r.id ? (
                                    <CircularProgress size={16} />
                                  ) : (
                                    <SaveIcon fontSize="small" />
                                  )
                                }
                                disabled={savingId === r.id}
                                onClick={() => void saveRow(r.id)}
                                sx={{ ml: 0.5 }}
                              >
                                Speichern
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  {sortedStaffing.length > 0 && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                      {sortedStaffing.length} von {SHIFT_TYPES.length} Schichttypen · Minimum 0 = Schicht wird
                      durch Bedarf nicht erzwungen.
                    </Typography>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Benachrichtigungen
              </Typography>
              <Divider sx={{ mb: 3 }} />
              <Typography variant="body2" color="text.secondary">
                E-Mail-Benachrichtigungen können später über externe Automation (z. B. Webhooks) ergänzt werden.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Dialog open={addOpen} onClose={() => !addBusy && setAddOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Schichttyp hinzufügen</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          {addFormError && <Alert severity="error">{addFormError}</Alert>}
          <TextField
            select
            label="Schichttyp"
            value={newShift}
            onChange={(e) => setNewShift(e.target.value as ShiftTypeValue)}
            fullWidth
            disabled={addBusy}
          >
            {missingShiftTypes.map((st) => (
              <MenuItem key={st} value={st}>
                {shiftTypeLabel(st)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Mindestanzahl (pro Kalendertag)"
            type="number"
            value={newMin}
            onChange={(e) => setNewMin(e.target.value)}
            fullWidth
            disabled={addBusy}
            inputProps={{ min: 0 }}
          />
          <Autocomplete
            multiple
            options={qualificationTagOptions}
            value={newTags}
            onChange={(_, v) => setNewTags(v)}
            disableCloseOnSelect
            disabled={qualificationTagOptions.length === 0}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip variant="outlined" label={option} {...getTagProps({ index })} key={option} />
              ))
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Qualifikationen"
                placeholder={
                  qualificationTagOptions.length === 0
                    ? "Zuerst bei Mitarbeitern anlegen"
                    : "Nur aus Liste"
                }
              />
            )}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)} disabled={addBusy}>
            Abbrechen
          </Button>
          <Button variant="contained" onClick={() => void submitAdd()} disabled={addBusy}>
            {addBusy ? <CircularProgress size={22} /> : "Anlegen"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteId !== null} onClose={() => !deleteBusy && setDeleteId(null)}>
        <DialogTitle>Eintrag löschen?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Dieser Personalbedarf wird entfernt. Sie können den Schichttyp später wieder anlegen.
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
            {deleteBusy ? <CircularProgress size={22} color="inherit" /> : "Löschen"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainLayout>
  );
}
