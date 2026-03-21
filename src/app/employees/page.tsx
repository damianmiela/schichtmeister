"use client";

import { useCallback, useEffect, useState } from "react";
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
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import { REFERENCE_FULL_TIME_WEEKLY_HOURS } from "@/lib/employeeShiftProfileSync";

type ContractType = "FULL_TIME" | "PART_TIME" | "MINI_JOB";

interface ShiftProfileOption {
  id: string;
  name: string;
  targetHoursPercent: number;
  contractType: ContractType;
  isActive: boolean;
}

interface EmployeeRow {
  id: string;
  firstName: string;
  lastName: string;
  shiftProfile: {
    id: string;
    name: string;
    shiftType: string;
    targetHoursPercent: number;
    contractType: ContractType;
  } | null;
  qualificationTags: string[];
}

const CONTRACT_LABELS: Record<ContractType, string> = {
  FULL_TIME: "Vollzeit",
  PART_TIME: "Teilzeit",
  MINI_JOB: "Mini-Job",
};

function parseQualificationTags(input: string): string[] {
  return input
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function formatQualificationTags(tags: string[]): string {
  return tags.join(", ");
}

function weeklyHoursLabel(percent: number): string {
  const h = (percent / 100) * REFERENCE_FULL_TIME_WEEKLY_HOURS;
  const rounded = Math.round(h * 100) / 100;
  return String(rounded).replace(".", ",");
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [shiftProfiles, setShiftProfiles] = useState<ShiftProfileOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [shiftProfileId, setShiftProfileId] = useState("");
  const [qualificationsText, setQualificationsText] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<EmployeeRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [empRes, profRes] = await Promise.all([
        fetchJson<{ employees: EmployeeRow[] }>("/api/employees"),
        fetchJson<{ shiftProfiles: ShiftProfileOption[] }>("/api/shift-profiles"),
      ]);
      setEmployees(empRes.employees ?? []);
      setShiftProfiles(profRes.shiftProfiles ?? []);
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
      setEmployees([]);
      setShiftProfiles([]);
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
    const profName = e.shiftProfile?.name.toLowerCase() ?? "";
    return (
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.qualificationTags.some((t) => t.toLowerCase().includes(q)) ||
      profName.includes(q)
    );
  });

  const resetForm = () => {
    setFormError(null);
    setFirstName("");
    setLastName("");
    setShiftProfileId("");
    setQualificationsText("");
    setEditingId(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (e: EmployeeRow) => {
    setFormError(null);
    setEditingId(e.id);
    setFirstName(e.firstName);
    setLastName(e.lastName);
    setShiftProfileId(e.shiftProfile?.id ?? "");
    setQualificationsText(formatQualificationTags(e.qualificationTags));
    setDialogOpen(true);
  };

  const submitEmployee = async () => {
    setFormError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setFormError("Vor- und Nachname sind erforderlich.");
      return;
    }

    const tags = parseQualificationTags(qualificationsText);
    const body: Record<string, unknown> = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      qualificationTags: tags,
    };

    if (editingId) {
      body.shiftProfileId = shiftProfileId.trim() ? shiftProfileId.trim() : null;
    } else if (shiftProfileId.trim()) {
      body.shiftProfileId = shiftProfileId.trim();
    }

    setSaving(true);
    try {
      if (editingId) {
        await fetchJson(`/api/employees/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await fetchJson("/api/employees", {
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
      } else {
        setFormError("Netzwerkfehler");
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/employees/${deleteTarget.id}`, {
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
            <Box sx={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
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
            </Box>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateDialog}>
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
                    <TableCell>Mitarbeiter</TableCell>
                    <TableCell>Schichtprofil</TableCell>
                    <TableCell>Qualifikationen</TableCell>
                    <TableCell align="right">Aktionen</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Typography color="text.secondary" sx={{ py: 2 }}>
                          Keine Mitarbeiter. Legen Sie den ersten Datensatz an.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((employee) => (
                      <TableRow key={employee.id} hover>
                        <TableCell>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <Avatar sx={{ bgcolor: "primary.main" }}>
                              {(employee.firstName[0] ?? "") + (employee.lastName[0] ?? "")}
                            </Avatar>
                            <Typography variant="body2" fontWeight={500}>
                              {employee.firstName} {employee.lastName}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell sx={{ maxWidth: 280 }}>
                          {employee.shiftProfile ? (
                            <Box>
                              <Typography variant="body2">{employee.shiftProfile.name}</Typography>
                              <Typography variant="caption" color="text.secondary" display="block">
                                {employee.shiftProfile.targetHoursPercent}% Soll · ≈{" "}
                                {weeklyHoursLabel(employee.shiftProfile.targetHoursPercent)} h/Woche (
                                {REFERENCE_FULL_TIME_WEEKLY_HOURS}h = 100%) ·{" "}
                                {CONTRACT_LABELS[employee.shiftProfile.contractType]}
                              </Typography>
                            </Box>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              Kein Profil
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                            {employee.qualificationTags.length === 0 ? (
                              <Typography variant="caption" color="text.secondary">
                                —
                              </Typography>
                            ) : (
                              employee.qualificationTags.map((qual) => (
                                <Chip key={qual} label={qual} size="small" sx={{ fontSize: 11 }} />
                              ))
                            )}
                          </Box>
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
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mt: 2,
              pt: 2,
              borderTop: 1,
              borderColor: "divider",
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {loading ? "…" : `${filtered.length} Mitarbeiter`}
            </Typography>
          </Box>
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onClose={() => !saving && (setDialogOpen(false), resetForm())}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {editingId ? "Mitarbeiter bearbeiten" : "Mitarbeiter hinzufügen"}
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField
            label="Vorname"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            fullWidth
            autoFocus
            disabled={saving}
          />
          <TextField
            label="Nachname"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            fullWidth
            disabled={saving}
          />
          <TextField
            select
            label="Schichtprofil"
            value={shiftProfileId}
            onChange={(e) => setShiftProfileId(e.target.value)}
            fullWidth
            disabled={saving}
            helperText="Optional. Soll-Stunden und Vertrag kommen aus dem Profil; später zuweisen oder ändern."
          >
            <MenuItem value="">
              <em>Kein Profil</em>
            </MenuItem>
            {shiftProfiles.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name} — {p.targetHoursPercent}% · {CONTRACT_LABELS[p.contractType]}
                {!p.isActive ? " (inaktiv)" : ""}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Qualifikationen"
            value={qualificationsText}
            onChange={(e) => setQualificationsText(e.target.value)}
            fullWidth
            disabled={saving}
            multiline
            minRows={2}
            placeholder="z. B. NurseQualified, Hilfskraft"
            helperText="Mehrere Einträge durch Komma oder Zeilenumbruch trennen"
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
          <Button variant="contained" onClick={() => void submitEmployee()} disabled={saving}>
            {saving ? <CircularProgress size={22} /> : "Speichern"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onClose={() => !deleteBusy && setDeleteTarget(null)}
      >
        <DialogTitle>Mitarbeiter löschen?</DialogTitle>
        <DialogContent>
          <Typography>
            {deleteTarget
              ? `„${deleteTarget.firstName} ${deleteTarget.lastName}“ wirklich löschen? Zugehörige Zuweisungen und Wünsche werden mit entfernt.`
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
