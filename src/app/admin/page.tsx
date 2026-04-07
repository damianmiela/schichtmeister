"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import MainLayout from "@/components/layout/MainLayout";
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import PersonIcon from "@mui/icons-material/Person";
import { fetchJson } from "@/lib/api/fetchJson";

type UserRow = {
  id: string;
  email: string;
  role: "ADMIN" | "PLANNER" | "EMPLOYEE";
  employeeId: string | null;
  createdAt: string;
  employee?: { id: string; firstName: string; lastName: string } | null;
};

const ROLE_LABELS: Record<string, { label: string; color: "error" | "primary" | "default" }> = {
  ADMIN: { label: "Admin", color: "error" },
  PLANNER: { label: "Planer", color: "primary" },
  EMPLOYEE: { label: "Mitarbeiter", color: "default" },
};

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState<"ADMIN" | "PLANNER" | "EMPLOYEE">("PLANNER");
  const [formBusy, setFormBusy] = useState(false);

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteUser, setDeleteUser] = useState<UserRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ users: UserRow[] }>("/api/admin/users");
      setUsers(data.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session || session.user.role !== "ADMIN") {
      router.replace("/");
      return;
    }
    void loadUsers();
  }, [session, status, router, loadUsers]);

  const openCreate = () => {
    setDialogMode("create");
    setEditUserId(null);
    setFormEmail("");
    setFormPassword("");
    setFormRole("PLANNER");
    setDialogOpen(true);
  };

  const openEdit = (user: UserRow) => {
    setDialogMode("edit");
    setEditUserId(user.id);
    setFormEmail(user.email);
    setFormPassword("");
    setFormRole(user.role);
    setDialogOpen(true);
  };

  const openDelete = (user: UserRow) => {
    setDeleteUser(user);
    setDeleteDialogOpen(true);
  };

  const handleSave = async () => {
    setFormBusy(true);
    setError(null);
    setSuccess(null);
    try {
      if (dialogMode === "create") {
        await fetchJson("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({ email: formEmail, password: formPassword, role: formRole }),
        });
        setSuccess("Benutzer erstellt");
      } else {
        const body: Record<string, unknown> = { email: formEmail, role: formRole };
        if (formPassword) body.password = formPassword;
        await fetchJson(`/api/admin/users/${editUserId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        setSuccess("Benutzer aktualisiert");
      }
      setDialogOpen(false);
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setFormBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteUser) return;
    setDeleteBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await fetchJson(`/api/admin/users/${deleteUser.id}`, { method: "DELETE" });
      setSuccess("Benutzer gelöscht");
      setDeleteDialogOpen(false);
      setDeleteUser(null);
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Löschen fehlgeschlagen");
    } finally {
      setDeleteBusy(false);
    }
  };

  if (status === "loading" || (session?.user?.role !== "ADMIN")) {
    return (
      <MainLayout title="Admin-Tools">
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      </MainLayout>
    );
  }

  return (
    <MainLayout title="Admin-Tools">
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>
          Benutzerverwaltung
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Benutzer anlegen, bearbeiten und löschen. Rollen: Admin (voller Zugriff), Planer (Dienstplanung), Mitarbeiter (Ansicht).
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Benutzer anlegen
        </Button>
      </Box>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>E-Mail</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Rolle</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Verknüpfter Mitarbeiter</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Erstellt</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>Aktionen</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((u) => {
                const rl = ROLE_LABELS[u.role] ?? { label: u.role, color: "default" as const };
                const isSelf = u.id === session?.user?.id;
                return (
                  <TableRow key={u.id} hover>
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <PersonIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                        {u.email}
                        {isSelf && (
                          <Chip label="Du" size="small" variant="outlined" color="info" sx={{ ml: 1, height: 20, fontSize: 11 }} />
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip label={rl.label} size="small" color={rl.color} />
                    </TableCell>
                    <TableCell>
                      {u.employee
                        ? `${u.employee.firstName} ${u.employee.lastName}`
                        : <Typography variant="caption" color="text.disabled">—</Typography>}
                    </TableCell>
                    <TableCell>
                      {new Date(u.createdAt).toLocaleDateString("de-DE")}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Bearbeiten">
                        <IconButton size="small" onClick={() => openEdit(u)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={isSelf ? "Eigenen Account kann man nicht löschen" : "Löschen"}>
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={isSelf}
                            onClick={() => openDelete(u)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography color="text.secondary" sx={{ py: 4 }}>
                      Keine Benutzer gefunden.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onClose={() => !formBusy && setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{dialogMode === "create" ? "Neuen Benutzer anlegen" : "Benutzer bearbeiten"}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <TextField
              label="E-Mail"
              type="email"
              value={formEmail}
              onChange={(e) => setFormEmail(e.target.value)}
              fullWidth
              required
              size="small"
            />
            <TextField
              label={dialogMode === "create" ? "Passwort" : "Neues Passwort (leer = unverändert)"}
              type="password"
              value={formPassword}
              onChange={(e) => setFormPassword(e.target.value)}
              fullWidth
              required={dialogMode === "create"}
              size="small"
              helperText={dialogMode === "create" ? "Mindestens 8 Zeichen" : undefined}
            />
            <TextField
              select
              label="Rolle"
              value={formRole}
              onChange={(e) => setFormRole(e.target.value as typeof formRole)}
              fullWidth
              size="small"
              SelectProps={{ native: true }}
              disabled={dialogMode === "edit" && editUserId === session?.user?.id}
              helperText={dialogMode === "edit" && editUserId === session?.user?.id ? "Eigene Rolle kann nicht geändert werden" : undefined}
            >
              <option value="ADMIN">Admin</option>
              <option value="PLANNER">Planer</option>
              <option value="EMPLOYEE">Mitarbeiter</option>
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={formBusy}>Abbrechen</Button>
          <Button
            variant="contained"
            onClick={() => void handleSave()}
            disabled={formBusy || !formEmail || (dialogMode === "create" && formPassword.length < 8)}
          >
            {formBusy ? <CircularProgress size={20} /> : dialogMode === "create" ? "Anlegen" : "Speichern"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => !deleteBusy && setDeleteDialogOpen(false)} maxWidth="xs">
        <DialogTitle>Benutzer löschen?</DialogTitle>
        <DialogContent>
          <Typography>
            Möchten Sie den Benutzer <strong>{deleteUser?.email}</strong> wirklich löschen?
            Dies kann nicht rückgängig gemacht werden.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleteBusy}>Abbrechen</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => void handleDelete()}
            disabled={deleteBusy}
          >
            {deleteBusy ? <CircularProgress size={20} /> : "Löschen"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainLayout>
  );
}
