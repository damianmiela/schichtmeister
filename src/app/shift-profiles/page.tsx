"use client";

import { useCallback, useEffect, useState } from "react";
import MainLayout from "@/components/layout/MainLayout";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Chip,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  IconButton,
} from "@mui/material";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

type ShiftType = "EARLY" | "LATE" | "NIGHT";

type ShiftProfile = {
  id: string;
  name: string;
  shiftType: ShiftType;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  isActive: boolean;
};

const TYPE_BORDER: Record<string, string> = {
  EARLY: "#ff9800",
  LATE: "#2196f3",
  NIGHT: "#9c27b0",
};

export default function ShiftProfilesPage() {
  const [profiles, setProfiles] = useState<ShiftProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [shiftType, setShiftType] = useState<ShiftType>("EARLY");
  const [startTime, setStartTime] = useState("06:00");
  const [endTime, setEndTime] = useState("14:30");
  const [breakMinutes, setBreakMinutes] = useState("30");
  const [isActive, setIsActive] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<ShiftProfile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson<{ shiftProfiles: ShiftProfile[] }>("/api/shift-profiles");
      setProfiles(res.shiftProfiles);
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
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setFormError(null);
    setEditingId(null);
    setName("");
    setShiftType("EARLY");
    setStartTime("06:00");
    setEndTime("14:30");
    setBreakMinutes("30");
    setIsActive(true);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (p: ShiftProfile) => {
    setFormError(null);
    setEditingId(p.id);
    setName(p.name);
    setShiftType(p.shiftType);
    setStartTime(p.startTime);
    setEndTime(p.endTime);
    setBreakMinutes(String(p.breakMinutes));
    setIsActive(p.isActive);
    setDialogOpen(true);
  };

  const submitProfile = async () => {
    setFormError(null);
    const br = breakMinutes.trim();
    const bm = parseInt(br, 10);
    if (br === "" || !Number.isFinite(bm) || bm < 0 || bm > 24 * 60) {
      setFormError("Pause: Minuten von 0 bis 1440.");
      return;
    }
    if (!name.trim()) {
      setFormError("Name ist erforderlich.");
      return;
    }

    const body = {
      name: name.trim(),
      shiftType,
      startTime,
      endTime,
      breakMinutes: bm,
      isActive,
    };

    setSaving(true);
    try {
      if (editingId) {
        await fetchJson(`/api/shift-profiles/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await fetchJson("/api/shift-profiles", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      setDialogOpen(false);
      resetForm();
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
        setFormError(msg);
      } else setFormError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (p: ShiftProfile) => {
    setBusyId(p.id);
    try {
      await fetchJson(`/api/shift-profiles/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !p.isActive }),
      });
      await load();
    } catch {
      setError("Aktualisierung fehlgeschlagen.");
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/shift-profiles/${deleteTarget.id}`, {
        method: "DELETE",
      });
      setDeleteTarget(null);
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
    <MainLayout title="Schichtprofile">
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Schichtprofil anlegen
        </Button>
      </Box>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={3}>
          {profiles.length === 0 ? (
            <Grid size={{ xs: 12 }}>
              <Typography color="text.secondary">
                Noch keine Schichtprofile. Diese definieren nur Schichttyp, Zeiten und Pause — für
                Soll-Stunden und Vertrag nutzen Sie die Mitarbeiter-Arbeitszeit-Vorlagen.
              </Typography>
            </Grid>
          ) : (
            profiles.map((profile) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={profile.id}>
                <Card
                  sx={{
                    opacity: profile.isActive ? 1 : 0.65,
                    borderLeft: 4,
                    borderColor: TYPE_BORDER[profile.shiftType] ?? "grey.500",
                  }}
                >
                  <CardContent>
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        mb: 2,
                      }}
                    >
                      <Box>
                        <Typography variant="h6">{profile.name}</Typography>
                        <Chip
                          label={shiftTypeLabel(profile.shiftType)}
                          size="small"
                          sx={{
                            bgcolor: TYPE_BORDER[profile.shiftType] ?? "grey.500",
                            color: "white",
                            mt: 0.5,
                          }}
                        />
                      </Box>
                      <Box>
                        <IconButton
                          size="small"
                          aria-label="Bearbeiten"
                          onClick={() => openEdit(profile)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label="Löschen"
                          color="error"
                          onClick={() => setDeleteTarget(profile)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </Box>

                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                      <AccessTimeIcon fontSize="small" color="action" />
                      <Typography>
                        {profile.startTime} – {profile.endTime}
                      </Typography>
                    </Box>

                    <Typography variant="body2" color="text.secondary">
                      Pause {profile.breakMinutes} min
                    </Typography>

                    <Box sx={{ mt: 2 }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={profile.isActive}
                            disabled={busyId === profile.id}
                            onChange={() => void toggleActive(profile)}
                          />
                        }
                        label={profile.isActive ? "Aktiv" : "Inaktiv"}
                      />
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))
          )}
        </Grid>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => !saving && (setDialogOpen(false), resetForm())}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {editingId ? "Schichtprofil bearbeiten" : "Schichtprofil anlegen"}
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            autoFocus
            disabled={saving}
          />
          <TextField
            select
            label="Schichttyp"
            value={shiftType}
            onChange={(e) => setShiftType(e.target.value as ShiftType)}
            fullWidth
            disabled={saving}
          >
            <MenuItem value="EARLY">Früh</MenuItem>
            <MenuItem value="LATE">Spät</MenuItem>
            <MenuItem value="NIGHT">Nacht</MenuItem>
          </TextField>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              label="Beginn"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              fullWidth
              disabled={saving}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Ende"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              fullWidth
              disabled={saving}
              InputLabelProps={{ shrink: true }}
            />
          </Box>
          <TextField
            label="Pause (Minuten)"
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(e.target.value)}
            fullWidth
            disabled={saving}
          />
          <FormControlLabel
            control={
              <Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={saving} />
            }
            label="Profil aktiv"
          />
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
          <Button variant="contained" onClick={() => void submitProfile()} disabled={saving}>
            {saving ? <CircularProgress size={22} /> : "Speichern"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onClose={() => !deleteBusy && setDeleteTarget(null)}
      >
        <DialogTitle>Schichtprofil löschen?</DialogTitle>
        <DialogContent>
          <Typography>
            {deleteTarget
              ? `„${deleteTarget.name}“ löschen? Nur möglich, wenn das Profil in keinem Dienstplan mehr vergeben ist.`
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
            {deleteBusy ? <CircularProgress size={22} color="inherit" /> : "Löschen"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainLayout>
  );
}
