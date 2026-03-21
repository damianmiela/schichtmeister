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

type ContractType = "FULL_TIME" | "PART_TIME" | "MINI_JOB";
type TargetHoursPeriod = "WEEKLY" | "MONTHLY";

interface EmployeeRow {
  id: string;
  firstName: string;
  lastName: string;
  contractType: ContractType;
  targetHours: number | null;
  targetHoursPeriod: string | null;
  miniJobMaxMonthlyHours: number | null;
  qualificationTags: string[];
}

const CONTRACT_LABELS: Record<ContractType, string> = {
  FULL_TIME: "Vollzeit",
  PART_TIME: "Teilzeit",
  MINI_JOB: "Mini-Job",
};

function contractChipColor(
  c: ContractType,
): "success" | "info" | "warning" | "default" {
  if (c === "FULL_TIME") return "success";
  if (c === "PART_TIME") return "info";
  return "warning";
}

function parseQualificationTags(input: string): string[] {
  return input
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function formatQualificationTags(tags: string[]): string {
  return tags.join(", ");
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contractType, setContractType] = useState<ContractType>("FULL_TIME");
  const [targetHours, setTargetHours] = useState("");
  const [targetHoursPeriod, setTargetHoursPeriod] =
    useState<TargetHoursPeriod>("WEEKLY");
  const [miniJobMaxMonthlyHours, setMiniJobMaxMonthlyHours] = useState("");
  const [qualificationsText, setQualificationsText] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<EmployeeRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ employees: EmployeeRow[] }>("/api/employees");
      setEmployees(data.employees ?? []);
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
      e.qualificationTags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const resetForm = () => {
    setFormError(null);
    setFirstName("");
    setLastName("");
    setContractType("FULL_TIME");
    setTargetHours("");
    setTargetHoursPeriod("WEEKLY");
    setMiniJobMaxMonthlyHours("");
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
    setContractType(e.contractType);
    setTargetHours(
      e.targetHours != null ? String(e.targetHours).replace(".", ",") : "",
    );
    setTargetHoursPeriod(
      e.targetHoursPeriod === "MONTHLY" ? "MONTHLY" : "WEEKLY",
    );
    setMiniJobMaxMonthlyHours(
      e.miniJobMaxMonthlyHours != null
        ? String(e.miniJobMaxMonthlyHours).replace(".", ",")
        : "",
    );
    setQualificationsText(formatQualificationTags(e.qualificationTags));
    setDialogOpen(true);
  };

  const buildPayload = ():
    | { ok: true; body: Record<string, unknown> }
    | { ok: false; message: string } => {
    if (!firstName.trim() || !lastName.trim()) {
      return { ok: false, message: "Vor- und Nachname sind erforderlich." };
    }

    const tags = parseQualificationTags(qualificationsText);

    const thRaw = targetHours.trim();
    let targetHoursNum: number | null = null;
    if (thRaw) {
      const n = Number(thRaw.replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) {
        return { ok: false, message: "Stunden: gültige Zahl eingeben." };
      }
      targetHoursNum = n;
    }

    let miniJobNum: number | null = null;
    if (contractType === "MINI_JOB") {
      const mj = miniJobMaxMonthlyHours.trim();
      if (mj) {
        const n = Number(mj.replace(",", "."));
        if (!Number.isFinite(n) || n <= 0) {
          return {
            ok: false,
            message: "Mini-Job: gültige Max-Stunden/Monat eingeben.",
          };
        }
        miniJobNum = n;
      }
    }

    const body: Record<string, unknown> = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      contractType,
      qualificationTags: tags,
    };

    if (targetHoursNum != null) {
      body.targetHours = targetHoursNum;
      body.targetHoursPeriod = targetHoursPeriod;
    } else {
      body.targetHours = null;
      body.targetHoursPeriod = null;
    }

    if (contractType === "MINI_JOB") {
      body.miniJobMaxMonthlyHours = miniJobNum;
    } else {
      body.miniJobMaxMonthlyHours = null;
    }

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
        const createBody = { ...built.body };
        if (createBody.targetHours == null) {
          delete createBody.targetHours;
          delete createBody.targetHoursPeriod;
        }
        if (contractType !== "MINI_JOB" || createBody.miniJobMaxMonthlyHours == null) {
          delete createBody.miniJobMaxMonthlyHours;
        }
        await fetchJson("/api/employees", {
          method: "POST",
          body: JSON.stringify(createBody),
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

  const hoursLabel = (e: EmployeeRow) => {
    if (e.contractType === "MINI_JOB") {
      if (e.miniJobMaxMonthlyHours != null) {
        return `max. ${e.miniJobMaxMonthlyHours}h/Monat`;
      }
      return "Mini-Job";
    }
    if (e.targetHours != null && e.targetHoursPeriod === "WEEKLY") {
      return `${e.targetHours}h/Woche`;
    }
    if (e.targetHours != null && e.targetHoursPeriod === "MONTHLY") {
      return `${e.targetHours}h/Monat`;
    }
    return "—";
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
                    <TableCell>Vertrag</TableCell>
                    <TableCell>Stunden</TableCell>
                    <TableCell>Qualifikationen</TableCell>
                    <TableCell align="right">Aktionen</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5}>
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
                            <Box>
                              <Typography variant="body2" fontWeight={500}>
                                {employee.firstName} {employee.lastName}
                              </Typography>
                            </Box>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={CONTRACT_LABELS[employee.contractType]}
                            size="small"
                            variant="outlined"
                            color={contractChipColor(employee.contractType)}
                          />
                        </TableCell>
                        <TableCell>{hoursLabel(employee)}</TableCell>
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
            label="Vertragsart"
            value={contractType}
            onChange={(e) => setContractType(e.target.value as ContractType)}
            fullWidth
            disabled={saving}
          >
            <MenuItem value="FULL_TIME">Vollzeit</MenuItem>
            <MenuItem value="PART_TIME">Teilzeit</MenuItem>
            <MenuItem value="MINI_JOB">Mini-Job</MenuItem>
          </TextField>
          {contractType === "MINI_JOB" && (
            <TextField
              label="Max. Stunden pro Monat (Mini-Job)"
              value={miniJobMaxMonthlyHours}
              onChange={(e) => setMiniJobMaxMonthlyHours(e.target.value)}
              fullWidth
              disabled={saving}
              helperText="Optional; entspricht der geplanten Obergrenze"
            />
          )}
          <TextField
            label="Soll-Stunden (optional)"
            value={targetHours}
            onChange={(e) => setTargetHours(e.target.value)}
            fullWidth
            disabled={saving}
            helperText="Leer lassen, wenn noch unbekannt"
          />
          {targetHours.trim() !== "" && (
            <TextField
              select
              label="Bezugszeitraum"
              value={targetHoursPeriod}
              onChange={(e) => setTargetHoursPeriod(e.target.value as TargetHoursPeriod)}
              fullWidth
              disabled={saving}
            >
              <MenuItem value="WEEKLY">pro Woche</MenuItem>
              <MenuItem value="MONTHLY">pro Monat</MenuItem>
            </TextField>
          )}
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
