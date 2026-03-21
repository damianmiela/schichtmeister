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
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";

type ContractType = "FULL_TIME" | "PART_TIME" | "MINI_JOB";

interface EmployeeRow {
  id: string;
  firstName: string;
  lastName: string;
  contractType: ContractType;
  targetHours: number | null;
  targetHoursPeriod: string | null;
  qualificationTags: string[];
}

const CONTRACT_LABELS: Record<ContractType, string> = {
  FULL_TIME: "Vollzeit",
  PART_TIME: "Teilzeit",
  MINI_JOB: "Mini-Job",
};

function contractChipColor(
  c: ContractType
): "success" | "info" | "warning" | "default" {
  if (c === "FULL_TIME") return "success";
  if (c === "PART_TIME") return "info";
  return "warning";
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contractType, setContractType] = useState<ContractType>("FULL_TIME");
  const [targetHours, setTargetHours] = useState("");

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

  const openDialog = () => {
    setFormError(null);
    setFirstName("");
    setLastName("");
    setContractType("FULL_TIME");
    setTargetHours("");
    setDialogOpen(true);
  };

  const submitEmployee = async () => {
    setFormError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setFormError("Vor- und Nachname sind erforderlich.");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        contractType,
        qualificationTags: [],
      };
      const th = targetHours.trim();
      if (th) {
        const n = Number(th.replace(",", "."));
        if (!Number.isFinite(n) || n <= 0) {
          setFormError("Stunden: gültige Zahl eingeben.");
          setSaving(false);
          return;
        }
        body.targetHours = n;
        body.targetHoursPeriod = "WEEKLY";
      }

      await fetchJson("/api/employees", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setDialogOpen(false);
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

  const hoursLabel = (e: EmployeeRow) => {
    if (e.targetHours != null && e.targetHoursPeriod === "WEEKLY") {
      return `${e.targetHours}h/Woche`;
    }
    if (e.targetHours != null && e.targetHoursPeriod === "MONTHLY") {
      return `${e.targetHours}h/Monat`;
    }
    if (e.contractType === "MINI_JOB") return "Mini-Job";
    return "—";
  };

  return (
    <MainLayout title="Mitarbeiter">
      <Card>
        <CardContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
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
            <Button variant="contained" startIcon={<AddIcon />} onClick={openDialog}>
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
                          <IconButton size="small" disabled>
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" disabled>
                            <MoreVertIcon fontSize="small" />
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

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Mitarbeiter hinzufügen</DialogTitle>
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
          <TextField
            label="Wochenstunden (optional)"
            value={targetHours}
            onChange={(e) => setTargetHours(e.target.value)}
            fullWidth
            disabled={saving}
            helperText="Leer lassen, wenn noch unbekannt"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Abbrechen
          </Button>
          <Button variant="contained" onClick={() => void submitEmployee()} disabled={saving}>
            {saving ? <CircularProgress size={22} /> : "Speichern"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainLayout>
  );
}
