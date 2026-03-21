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
  Autocomplete,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import { REFERENCE_FULL_TIME_WEEKLY_HOURS } from "@/lib/employeeContractDenorm";

type ContractType = "FULL_TIME" | "PART_TIME" | "MINI_JOB";

type WorkProfileOption = {
  id: string;
  name: string;
  targetHoursPercent: number;
  contractType: ContractType;
  miniJobMaxMonthlyHours: number | null;
};

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

function parsePercentInput(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) return null;
  return n;
}

function valuesMatchTemplate(
  wp: WorkProfileOption,
  contractType: ContractType,
  percentStr: string,
  miniStr: string,
): boolean {
  if (wp.contractType !== contractType) return false;
  const pct = parsePercentInput(percentStr);
  if (pct == null || Math.abs(wp.targetHoursPercent - pct) > 0.001) return false;
  const m = miniStr.trim() === "" ? null : Number(miniStr.replace(",", "."));
  const wm = wp.miniJobMaxMonthlyHours;
  if (m === null && wm === null) return true;
  if (m === null || wm === null) return false;
  return Math.abs(m - wm) < 0.001;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [workProfiles, setWorkProfiles] = useState<WorkProfileOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [initialWorkProfileId, setInitialWorkProfileId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contractType, setContractType] = useState<ContractType>("FULL_TIME");
  const [percentStr, setPercentStr] = useState("");
  const [miniStr, setMiniStr] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<WorkProfileOption | null>(null);
  const [qualificationsText, setQualificationsText] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<EmployeeRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const loadWorkProfiles = useCallback(async () => {
    try {
      const res = await fetchJson<{ workProfiles: WorkProfileOption[] }>(
        "/api/employee-work-profiles",
      );
      setWorkProfiles(res.workProfiles ?? []);
    } catch {
      setWorkProfiles([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const empRes = await fetchJson<{ employees: EmployeeRow[] }>("/api/employees");
      setEmployees(empRes.employees ?? []);
      await loadWorkProfiles();
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
  }, [loadWorkProfiles]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = employees.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const tpl = e.workProfile?.name.toLowerCase() ?? "";
    return (
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.qualificationTags.some((t) => t.toLowerCase().includes(q)) ||
      tpl.includes(q)
    );
  });

  const resetForm = () => {
    setFormError(null);
    setFirstName("");
    setLastName("");
    setContractType("FULL_TIME");
    setPercentStr("");
    setMiniStr("");
    setSelectedTemplate(null);
    setQualificationsText("");
    setEditingId(null);
    setInitialWorkProfileId(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = async (e: EmployeeRow) => {
    setFormError(null);
    setEditingId(e.id);
    setInitialWorkProfileId(e.workProfile?.id ?? null);
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
    let profiles = workProfiles;
    if (e.workProfile != null && profiles.every((w) => w.id !== e.workProfile!.id)) {
      try {
        const res = await fetchJson<{ workProfiles: WorkProfileOption[] }>(
          "/api/employee-work-profiles",
        );
        profiles = res.workProfiles ?? [];
        setWorkProfiles(profiles);
      } catch {
        /* keep existing list */
      }
    }
    const tpl =
      e.workProfile != null ? profiles.find((w) => w.id === e.workProfile!.id) ?? null : null;
    setSelectedTemplate(tpl);
    setQualificationsText(formatQualificationTags(e.qualificationTags));
    setDialogOpen(true);
  };

  const buildContractPayload = (): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } => {
    const tags = parseQualificationTags(qualificationsText);
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

    let pct: number | null = null;
    if (contractType !== "MINI_JOB") {
      const p = parsePercentInput(percentStr);
      if (percentStr.trim() !== "" && p == null) {
        return { ok: false, message: "Soll-Prozent: gültige Zahl eingeben (oder leer lassen)." };
      }
      pct = p;
    }

    const match =
      selectedTemplate != null &&
      valuesMatchTemplate(selectedTemplate, contractType, percentStr, miniStr);

    const body: Record<string, unknown> = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      qualificationTags: tags,
    };

    if (editingId) {
      if (match && selectedTemplate) {
        body.workProfileId = selectedTemplate.id;
      } else if (initialWorkProfileId && !match) {
        body.workProfileId = null;
      }
      if (!match || !selectedTemplate) {
        body.contractType = contractType;
        body.targetHoursPercent = pct;
        body.miniJobMaxMonthlyHours = contractType === "MINI_JOB" ? mini : null;
      }
    } else {
      if (match && selectedTemplate) {
        body.workProfileId = selectedTemplate.id;
      } else {
        body.contractType = contractType;
        body.targetHoursPercent = pct;
        body.miniJobMaxMonthlyHours = contractType === "MINI_JOB" ? mini : null;
      }
    }

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

  const saveNewTemplate = async () => {
    setTemplateError(null);
    const name = templateName.trim();
    if (!name) {
      setTemplateError("Name für die Vorlage eingeben.");
      return;
    }
    const pct = parsePercentInput(percentStr);
    if (contractType !== "MINI_JOB" && (percentStr.trim() === "" || pct == null)) {
      setTemplateError("Soll-Prozent angeben, um eine Vorlage zu speichern.");
      return;
    }
    let mini: number | null = null;
    if (contractType === "MINI_JOB") {
      const mj = miniStr.trim();
      if (mj) {
        const n = Number(mj.replace(",", "."));
        if (!Number.isFinite(n) || n <= 0) {
          setTemplateError("Mini-Job: gültige Max-Stunden/Monat.");
          return;
        }
        mini = n;
      }
    }

    setTemplateSaving(true);
    try {
      await fetchJson("/api/employee-work-profiles", {
        method: "POST",
        body: JSON.stringify({
          name,
          targetHoursPercent: contractType === "MINI_JOB" ? 0 : (pct as number),
          contractType,
          miniJobMaxMonthlyHours: contractType === "MINI_JOB" ? mini : null,
        }),
      });
      setTemplateDialogOpen(false);
      setTemplateName("");
      await loadWorkProfiles();
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
        setTemplateError(msg);
      } else setTemplateError("Netzwerkfehler");
    } finally {
      setTemplateSaving(false);
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
    if (e.contractType === "MINI_JOB") {
      return e.miniJobMaxMonthlyHours != null
        ? `Mini-Job · max. ${e.miniJobMaxMonthlyHours} h/Monat`
        : "Mini-Job";
    }
    if (e.targetHoursPercent != null) {
      return `${e.targetHoursPercent}% · ≈ ${weeklyHoursLabel(e.targetHoursPercent)} h/Woche (${REFERENCE_FULL_TIME_WEEKLY_HOURS}h = 100%)`;
    }
    if (e.targetHours != null && e.targetHoursPeriod === "WEEKLY") {
      return `${e.targetHours} h/Woche`;
    }
    if (e.targetHours != null && e.targetHoursPeriod === "MONTHLY") {
      return `${e.targetHours} h/Monat`;
    }
    return `${CONTRACT_LABELS[e.contractType]} · kein Soll-%`;
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
                    <TableCell>Gespeicherte Vorlage</TableCell>
                    <TableCell>Qualifikationen</TableCell>
                    <TableCell align="right">Aktionen</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5}>
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
                          {employee.workProfile ? (
                            <Typography variant="body2">{employee.workProfile.name}</Typography>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              —
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
                            onClick={() => void openEditDialog(employee)}
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

          <Autocomplete
            options={workProfiles}
            getOptionLabel={(o) =>
              o.contractType === "MINI_JOB"
                ? `${o.name} (Mini-Job${o.miniJobMaxMonthlyHours != null ? ` · max ${o.miniJobMaxMonthlyHours} h/Mo` : ""})`
                : `${o.name} (${o.targetHoursPercent}% · ${CONTRACT_LABELS[o.contractType]})`
            }
            value={selectedTemplate}
            onChange={(_, v) => {
              setSelectedTemplate(v);
              if (v) {
                setContractType(v.contractType);
                setPercentStr(
                  Number.isInteger(v.targetHoursPercent)
                    ? String(v.targetHoursPercent)
                    : String(v.targetHoursPercent).replace(".", ","),
                );
                setMiniStr(
                  v.miniJobMaxMonthlyHours != null
                    ? String(v.miniJobMaxMonthlyHours).replace(".", ",")
                    : "",
                );
              }
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Gespeicherte Arbeitszeit-Vorlage"
                helperText="Aus Liste wählen oder unten manuell eintragen. Änderungen an den Feldern lösen die Auswahl."
              />
            )}
            disabled={saving}
          />

          <TextField
            select
            label="Vertragsart"
            value={contractType}
            onChange={(e) => {
              setContractType(e.target.value as ContractType);
              setSelectedTemplate(null);
            }}
            fullWidth
            disabled={saving}
          >
            <MenuItem value="FULL_TIME">Vollzeit</MenuItem>
            <MenuItem value="PART_TIME">Teilzeit</MenuItem>
            <MenuItem value="MINI_JOB">Mini-Job</MenuItem>
          </TextField>

          {contractType !== "MINI_JOB" && (
            <TextField
              label="Soll-Stunden (Prozent)"
              value={percentStr}
              onChange={(e) => {
                setPercentStr(e.target.value);
                setSelectedTemplate(null);
              }}
              fullWidth
              disabled={saving}
              helperText={`Bezug: ${REFERENCE_FULL_TIME_WEEKLY_HOURS}h/Woche = 100%. Leer = kein wöchentliches Soll im Planungsbonus.`}
            />
          )}

          {contractType === "MINI_JOB" && (
            <TextField
              label="Max. Stunden pro Monat (optional)"
              value={miniStr}
              onChange={(e) => {
                setMiniStr(e.target.value);
                setSelectedTemplate(null);
              }}
              fullWidth
              disabled={saving}
              helperText="Leer = Standard der Einrichtung bei Prüfregeln"
            />
          )}

          <Button variant="outlined" size="small" onClick={() => setTemplateDialogOpen(true)} disabled={saving}>
            Aktuelle Werte als Vorlage speichern…
          </Button>

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

      <Dialog open={templateDialogOpen} onClose={() => !templateSaving && setTemplateDialogOpen(false)}>
        <DialogTitle>Vorlage speichern</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1, minWidth: 320 }}>
          {templateError && <Alert severity="error">{templateError}</Alert>}
          <TextField
            label="Name der Vorlage"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            fullWidth
            disabled={templateSaving}
            autoFocus
          />
          <Typography variant="caption" color="text.secondary">
            Wird in der Autovervollständigung für weitere Mitarbeiter angeboten (eindeutiger Name pro Einrichtung).
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTemplateDialogOpen(false)} disabled={templateSaving}>
            Abbrechen
          </Button>
          <Button variant="contained" onClick={() => void saveNewTemplate()} disabled={templateSaving}>
            {templateSaving ? <CircularProgress size={22} /> : "Vorlage anlegen"}
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
