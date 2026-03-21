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
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import GridOnIcon from "@mui/icons-material/GridOn";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

const DAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const DAY_OPTIONS = DAYS.map((label, value) => ({ value, label }));

const SHIFT_TYPES = ["EARLY", "LATE", "NIGHT"] as const;
type ShiftTypeValue = (typeof SHIFT_TYPES)[number];

type StaffingRow = {
  id: string;
  dayOfWeek: number;
  shiftType: string;
  minStaffCount: number;
  requiredQualificationTags: string[];
};

export default function SettingsPage() {
  const [staffing, setStaffing] = useState<StaffingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [draftTags, setDraftTags] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [newDay, setNewDay] = useState(1);
  const [newShift, setNewShift] = useState<ShiftTypeValue>("EARLY");
  const [newMin, setNewMin] = useState("1");
  const [newTags, setNewTags] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson<{ staffingRequirements: StaffingRow[] }>(
        "/api/staffing-requirements",
      );
      setStaffing(res.staffingRequirements);
      const d: Record<string, string> = {};
      const t: Record<string, string> = {};
      for (const r of res.staffingRequirements) {
        d[r.id] = String(r.minStaffCount);
        t[r.id] = r.requiredQualificationTags.join(", ");
      }
      setDraft(d);
      setDraftTags(t);
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const parseTags = (raw: string): string[] => [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  ];

  const saveRow = async (id: string) => {
    const raw = draft[id];
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      setError("Mindestanzahl: gültige Zahl ≥ 0.");
      return;
    }
    setSavingId(id);
    setError(null);
    try {
      await fetchJson(`/api/staffing-requirements/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          minStaffCount: n,
          requiredQualificationTags: parseTags(draftTags[id] ?? ""),
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

  const applyWeekTemplate = async () => {
    setTemplateBusy(true);
    setError(null);
    try {
      const existing = new Set(staffing.map((r) => `${r.dayOfWeek}:${r.shiftType}`));
      for (let dow = 0; dow <= 6; dow++) {
        for (const st of SHIFT_TYPES) {
          if (existing.has(`${dow}:${st}`)) continue;
          await fetchJson("/api/staffing-requirements", {
            method: "POST",
            body: JSON.stringify({
              dayOfWeek: dow,
              shiftType: st,
              minStaffCount: 1,
              requiredQualificationTags: [],
            }),
          });
          existing.add(`${dow}:${st}`);
        }
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
    setAddFormError(null);
    setNewDay(1);
    setNewShift("EARLY");
    setNewMin("1");
    setNewTags("");
    setAddOpen(true);
  };

  const submitAdd = async () => {
    const n = Number(newMin.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      setAddFormError("Minimum: gültige Zahl ≥ 0.");
      return;
    }
    if (staffing.some((r) => r.dayOfWeek === newDay && r.shiftType === newShift)) {
      setAddFormError("Diese Kombination aus Wochentag und Schicht gibt es bereits.");
      return;
    }
    setAddBusy(true);
    setAddFormError(null);
    setError(null);
    try {
      await fetchJson("/api/staffing-requirements", {
        method: "POST",
        body: JSON.stringify({
          dayOfWeek: newDay,
          shiftType: newShift,
          minStaffCount: Math.floor(n),
          requiredQualificationTags: parseTags(newTags),
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

  const sortedStaffing = useMemo(
    () =>
      [...staffing].sort((a, b) =>
        a.dayOfWeek !== b.dayOfWeek
          ? a.dayOfWeek - b.dayOfWeek
          : a.shiftType.localeCompare(b.shiftType),
      ),
    [staffing],
  );

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
                Für jeden Wochentag und Schichttyp legen Sie fest, wie viele Personen mindestens eingeplant
                werden sollen. Optional: Qualifikationsbegriffe (wie bei Mitarbeitern) — nur Mitarbeiter mit
                allen genannten Tags werden für diese Slots bevorzugt. Ohne Einträge kann „Entwurf füllen“ im
                Monatplan nichts erzeugen.
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
                      Noch keine Personalbedarfs-Einträge. Nutzen Sie „Grundraster anlegen“, um alle
                      Kombinationen (7 Tage × Früh/Spät/Nacht) mit Minimum 1 anzulegen — oder fügen Sie einzelne
                      Zeilen hinzu.
                    </Alert>
                  )}
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2 }}>
                    <Button
                      variant="contained"
                      startIcon={
                        templateBusy ? <CircularProgress size={18} color="inherit" /> : <GridOnIcon />
                      }
                      disabled={templateBusy || loading}
                      onClick={() => void applyWeekTemplate()}
                    >
                      Grundraster anlegen (7×3, fehlende je 1)
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<AddIcon />}
                      disabled={loading}
                      onClick={openAddDialog}
                    >
                      Eintrag hinzufügen
                    </Button>
                  </Box>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Tag</TableCell>
                        <TableCell>Schichttyp</TableCell>
                        <TableCell sx={{ minWidth: 100 }}>Minimum</TableCell>
                        <TableCell sx={{ minWidth: 220 }}>
                          Qualifikationen (kommagetrennt)
                        </TableCell>
                        <TableCell align="right">Aktion</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sortedStaffing.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5}>
                            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                              Keine Zeilen — Raster anlegen oder Eintrag hinzufügen.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        sortedStaffing.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell>{DAYS[r.dayOfWeek] ?? r.dayOfWeek}</TableCell>
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
                              <TextField
                                size="small"
                                fullWidth
                                placeholder="z. B. NurseQualified, Hilfskraft"
                                value={draftTags[r.id] ?? ""}
                                onChange={(ev) =>
                                  setDraftTags((prev) => ({ ...prev, [r.id]: ev.target.value }))
                                }
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
                      {sortedStaffing.length} Einträge · Minimum 0 = Schicht an diesem Tag nicht durch
                      Personalbedarf erzwungen.
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
        <DialogTitle>Personalbedarf hinzufügen</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          {addFormError && <Alert severity="error">{addFormError}</Alert>}
          <TextField
            select
            label="Wochentag"
            value={String(newDay)}
            onChange={(e) => setNewDay(Number(e.target.value))}
            fullWidth
            disabled={addBusy}
          >
            {DAY_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={String(o.value)}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
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
            label="Mindestanzahl"
            type="number"
            value={newMin}
            onChange={(e) => setNewMin(e.target.value)}
            fullWidth
            disabled={addBusy}
            inputProps={{ min: 0 }}
          />
          <TextField
            label="Qualifikationen (optional)"
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
            fullWidth
            disabled={addBusy}
            placeholder="Kommagetrennt, wie bei Mitarbeitern"
            helperText="Nur Kandidaten mit allen Tags werden für diesen Bedarf bevorzugt."
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
            Dieser Personalbedarf wird entfernt. Sie können ihn später neu anlegen.
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
