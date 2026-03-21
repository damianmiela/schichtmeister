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
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import { REFERENCE_FULL_TIME_MONTHLY_HOURS } from "@/lib/employeeContractDenorm";

type ContractType = "FULL_TIME" | "PART_TIME" | "MINI_JOB" | "AUSBILDUNG";

interface EmployeeRow {
  id: string;
  firstName: string;
  lastName: string;
  contractType: ContractType;
  targetHours: number | null;
  targetHoursPeriod: string | null;
  miniJobMaxMonthlyHours: number | null;
  targetHoursPercent: number | null;
  workProfile: { id: string; name: string } | null;
  qualificationTags: string[];
}

const CONTRACT_LABELS: Record<ContractType, string> = {
  FULL_TIME: "Vollzeit",
  PART_TIME: "Teilzeit",
  MINI_JOB: "Mini-Job",
  AUSBILDUNG: "Ausbildung",
};

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
  const [percentStr, setPercentStr] = useState("");
  const [miniStr, setMiniStr] = useState("");
  const [qualificationTags, setQualificationTags] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<EmployeeRow | null>(null);
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
      const empRes = await fetchJson<{ employees: EmployeeRow[] }>("/api/employees");
      setEmployees(empRes.employees ?? []);
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
    setPercentStr("");
    setMiniStr("");
    setQualificationTags([]);
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
    setQualificationTags([...e.qualificationTags]);
    setDialogOpen(true);
  };

  const buildContractPayload = (): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } => {
    if (!firstName.trim() || !lastName.trim()) {
      return { ok: false, message: "Vor- und Nachname sind erforderlich." };
    }

    let mini: number | null = null;
    if (contractType === "MINI_JOB") {
      const mj = miniStr.trim();
      if (mj) {
        const n = Number(mj.replace(",", "."));
        if (!Number.isFinite(n) || n <= 0) {
          return { ok: false, message: "Mini-Job: gültige Max-Stunden/Monat eingeben." };
        }
        mini = n;
      }
    }

    const p = parsePercentInput(percentStr);
    if (percentStr.trim() !== "" && p == null) {
      return { ok: false, message: "Soll-Prozent: gültige Zahl eingeben (oder leer lassen)." };
    }
    const pct = p;

    const body: Record<string, unknown> = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      qualificationTags: qualificationTags,
      workProfileId: null,
      contractType,
      targetHoursPercent: pct,
      miniJobMaxMonthlyHours: contractType === "MINI_JOB" ? mini : null,
    };

    return { ok: true, body };
  };

  const submitEmployee = async () => {
    setFormError(null);
    const built = buildContractPayload();
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

  const contractSummary = (e: EmployeeRow) => {
    const label =
      CONTRACT_LABELS[e.contractType as ContractType] ?? e.contractType;
    const bits: string[] = [];
    if (e.targetHoursPercent != null) {
      bits.push(
        `${e.targetHoursPercent}% · ≈ ${monthlyHoursLabel(e.targetHoursPercent)} h/Monat`,
      );
    } else if (e.targetHours != null && e.targetHoursPeriod === "MONTHLY") {
      bits.push(`${e.targetHours} h/Monat`);
    } else if (e.targetHours != null && e.targetHoursPeriod === "WEEKLY") {
      bits.push(`${e.targetHours} h/Woche`);
    }
    if (e.contractType === "MINI_JOB" && e.miniJobMaxMonthlyHours != null) {
      bits.push(`max. ${e.miniJobMaxMonthlyHours} h/Monat (Kappung)`);
    }
    if (bits.length === 0) {
      return `${label} · kein Soll-%`;
    }
    return `${label} · ${bits.join(" · ")} · Bezug 100 % = ${String(REFERENCE_FULL_TIME_MONTHLY_HOURS).replace(".", ",")} h/Monat`;
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
                    <TableCell>Arbeitszeit</TableCell>
                    <TableCell>Qualifikationen</TableCell>
                    <TableCell align="right">Aktionen</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Typography color="text.secondary" sx={{ py: 2 }}>
                          Keine Mitarbeiter.
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
                          <Typography variant="body2">{CONTRACT_LABELS[employee.contractType]}</Typography>
                          <Typography variant="caption" color="text.secondary" display="block">
                            {contractSummary(employee)}
                          </Typography>
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

          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: "divider" }}>
            {loading ? "…" : `${filtered.length} Mitarbeiter`}
          </Typography>
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
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField
            label="Vorname"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            fullWidth
            autoFocus
            disabled={saving}
            sx={{ mt: 0.5 }}
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
            <MenuItem value="AUSBILDUNG">Ausbildung</MenuItem>
          </TextField>

          <TextField
            label="Soll-Stunden (Prozent)"
            value={percentStr}
            onChange={(e) => setPercentStr(e.target.value)}
            fullWidth
            disabled={saving}
            helperText={`Bezug: ${String(REFERENCE_FULL_TIME_MONTHLY_HOURS).replace(".", ",")} h/Monat = 100 %. Leer = kein monatliches Soll im Planungsbonus.`}
          />

          {contractType === "MINI_JOB" && (
            <TextField
              label="Max. Stunden pro Monat (optional)"
              value={miniStr}
              onChange={(e) => setMiniStr(e.target.value)}
              fullWidth
              disabled={saving}
              helperText="Leer = Standard der Einrichtung bei Prüfregeln"
            />
          )}

          <Autocomplete
            multiple
            freeSolo
            openOnFocus
            options={qualificationTagOptions}
            value={qualificationTags}
            onChange={(_, v) => {
              const next = [
                ...new Set(
                  v
                    .map((x) => String(x).trim())
                    .filter((s) => s.length > 0),
                ),
              ];
              setQualificationTags(next);
            }}
            filterSelectedOptions
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip variant="outlined" label={option} {...getTagProps({ index })} key={`${option}-${index}`} />
              ))
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Qualifikationen"
                placeholder="Tippen oder aus bestehenden wählen"
                helperText="Vorschläge aus allen Mitarbeitern dieser Einrichtung; neue Begriffe möglich."
              />
            )}
            disabled={saving}
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
