"use client";

import { useCallback, useEffect, useState } from "react";
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
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

const DAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

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
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson<{ staffingRequirements: StaffingRow[] }>(
        "/api/staffing-requirements",
      );
      setStaffing(res.staffingRequirements);
      const d: Record<string, string> = {};
      for (const r of res.staffingRequirements) {
        d[r.id] = String(r.minStaffCount);
      }
      setDraft(d);
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
        body: JSON.stringify({ minStaffCount: n }),
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
      }
    } finally {
      setSavingId(null);
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
                Mindestbesetzung (nach Wochentag)
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
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Tag</TableCell>
                      <TableCell>Schichttyp</TableCell>
                      <TableCell>Minimum</TableCell>
                      <TableCell align="right">Aktion</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {staffing.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{DAYS[r.dayOfWeek] ?? r.dayOfWeek}</TableCell>
                        <TableCell>{shiftTypeLabel(r.shiftType)}</TableCell>
                        <TableCell sx={{ maxWidth: 120 }}>
                          <TextField
                            size="small"
                            type="number"
                            value={draft[r.id] ?? ""}
                            onChange={(ev) =>
                              setDraft((prev) => ({ ...prev, [r.id]: ev.target.value }))
                            }
                            inputProps={{ min: 0 }}
                          />
                        </TableCell>
                        <TableCell align="right">
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
                          >
                            Speichern
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
    </MainLayout>
  );
}
