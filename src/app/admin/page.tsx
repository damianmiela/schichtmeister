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
  Tabs,
  Tab,
  Collapse,
  TablePagination,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import PersonIcon from "@mui/icons-material/Person";
import StorageIcon from "@mui/icons-material/Storage";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import RefreshIcon from "@mui/icons-material/Refresh";
import { fetchJson } from "@/lib/api/fetchJson";

/* ═══════════════════════════════════════════════
   SHARED TYPES & HELPERS
   ═══════════════════════════════════════════════ */

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "PLANNER" | "DEMO";
  lastActiveAt: string | null;
  createdAt: string;
};

const ROLE_LABELS: Record<string, { label: string; color: "error" | "primary" | "default" | "warning" }> = {
  ADMIN: { label: "Admin", color: "error" },
  PLANNER: { label: "Planer", color: "primary" },
  DEMO: { label: "Demo", color: "warning" },
};

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Nie";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Gerade eben";
  if (mins < 60) return `Vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Vor ${days} Tag${days > 1 ? "en" : ""}`;
  return new Date(iso).toLocaleDateString("de-DE");
}

/* ═══════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════ */

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [tabIndex, setTabIndex] = useState(0);

  useEffect(() => {
    if (status === "loading") return;
    if (!session || session.user.role !== "ADMIN") {
      router.replace("/");
    }
  }, [session, status, router]);

  if (status === "loading" || session?.user?.role !== "ADMIN") {
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
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3, overflowX: "auto" }}>
        <Tabs
          value={tabIndex}
          onChange={(_, v) => setTabIndex(v)}
          sx={{
            "& .MuiTab-root": { textTransform: "none", fontWeight: 600, fontSize: { xs: 12, sm: 14 } },
            minWidth: { xs: 360, sm: "auto" },
          }}
        >
          <Tab icon={<PersonIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Benutzer" />
          <Tab icon={<StorageIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Datenbank" />
        </Tabs>
      </Box>

      {tabIndex === 0 && <UsersTab session={session} />}
      {tabIndex === 1 && <DatabaseTab />}
    </MainLayout>
  );
}

/* ═══════════════════════════════════════════════
   USERS TAB
   ═══════════════════════════════════════════════ */

function UsersTab({ session }: { session: NonNullable<ReturnType<typeof useSession>["data"]> }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState<"ADMIN" | "PLANNER" | "DEMO">("PLANNER");
  const [formBusy, setFormBusy] = useState(false);

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

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  const openCreate = () => {
    setDialogMode("create");
    setEditUserId(null);
    setFormName("");
    setFormEmail("");
    setFormPassword("");
    setFormRole("PLANNER");
    setDialogOpen(true);
  };

  const openEdit = (user: UserRow) => {
    setDialogMode("edit");
    setEditUserId(user.id);
    setFormName(user.name ?? "");
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
          body: JSON.stringify({ name: formName, email: formEmail, password: formPassword, role: formRole }),
        });
        setSuccess("Benutzer erstellt");
      } else {
        const body: Record<string, unknown> = { name: formName, email: formEmail, role: formRole };
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

  return (
    <>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700} sx={{ mb: 1, fontSize: { xs: 20, sm: 24 } }}>
          Benutzerverwaltung
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Benutzer anlegen, bearbeiten und löschen. Rollen: Admin (voller Zugriff), Planer (Dienstplanung), Demo (eingeschränkt).
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}

      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>Benutzer anlegen</Button>
      </Box>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ overflowX: "auto" }}>
          <Table sx={{ minWidth: 360 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>E-Mail</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Rolle</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Letzte Aktivität</TableCell>
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
                        {u.name || <Typography variant="body2" color="text.disabled" component="span">—</Typography>}
                        {isSelf && <Chip label="Du" size="small" variant="outlined" color="info" sx={{ ml: 1, height: 20, fontSize: 11 }} />}
                      </Box>
                    </TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell><Chip label={rl.label} size="small" color={rl.color} /></TableCell>
                    <TableCell>
                      <Typography variant="body2" color={u.lastActiveAt ? "text.primary" : "text.disabled"}>
                        {formatRelativeTime(u.lastActiveAt)}
                      </Typography>
                    </TableCell>
                    <TableCell>{new Date(u.createdAt).toLocaleDateString("de-DE")}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Bearbeiten">
                        <IconButton size="small" onClick={() => openEdit(u)}><EditIcon fontSize="small" /></IconButton>
                      </Tooltip>
                      <Tooltip title={isSelf ? "Eigenen Account kann man nicht löschen" : "Löschen"}>
                        <span>
                          <IconButton size="small" color="error" disabled={isSelf} onClick={() => openDelete(u)}>
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
                  <TableCell colSpan={6} align="center">
                    <Typography color="text.secondary" sx={{ py: 4 }}>Keine Benutzer gefunden.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onClose={() => !formBusy && setDialogOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { minWidth: { xs: 280, sm: "auto" } } }}>
        <DialogTitle>{dialogMode === "create" ? "Neuen Benutzer anlegen" : "Benutzer bearbeiten"}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <TextField label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} fullWidth size="small" placeholder="z.B. Max Mustermann" />
            <TextField label="E-Mail" type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} fullWidth required size="small" />
            <TextField
              label={dialogMode === "create" ? "Passwort" : "Neues Passwort (leer = unverändert)"}
              type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)}
              fullWidth required={dialogMode === "create"} size="small"
              helperText={dialogMode === "create" ? "Mindestens 8 Zeichen" : undefined}
            />
            <TextField
              select label="Rolle" value={formRole} onChange={(e) => setFormRole(e.target.value as typeof formRole)}
              fullWidth size="small" SelectProps={{ native: true }}
              disabled={dialogMode === "edit" && editUserId === session?.user?.id}
              helperText={dialogMode === "edit" && editUserId === session?.user?.id ? "Eigene Rolle kann nicht geändert werden" : undefined}
            >
              <option value="ADMIN">Admin</option>
              <option value="PLANNER">Planer</option>
              <option value="DEMO">Demo</option>
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={formBusy}>Abbrechen</Button>
          <Button variant="contained" onClick={() => void handleSave()} disabled={formBusy || !formEmail || (dialogMode === "create" && formPassword.length < 8)}>
            {formBusy ? <CircularProgress size={20} /> : dialogMode === "create" ? "Anlegen" : "Speichern"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => !deleteBusy && setDeleteDialogOpen(false)} maxWidth="xs" PaperProps={{ sx: { minWidth: { xs: 280, sm: "auto" } } }}>
        <DialogTitle>Benutzer löschen?</DialogTitle>
        <DialogContent>
          <Typography>
            Möchten Sie den Benutzer <strong>{deleteUser?.email}</strong> wirklich löschen? Dies kann nicht rückgängig gemacht werden.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleteBusy}>Abbrechen</Button>
          <Button variant="contained" color="error" onClick={() => void handleDelete()} disabled={deleteBusy}>
            {deleteBusy ? <CircularProgress size={20} /> : "Löschen"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/* ═══════════════════════════════════════════════
   DATABASE BROWSER TAB
   ═══════════════════════════════════════════════ */

type TableInfo = { model: string; label: string; count: number };
type TableData = {
  table: string;
  label: string;
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const MAX_CELL_LENGTH = 60;

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch { return "[object]"; }
  }
  return String(value);
}

function DatabaseTab() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<Record<string, TableData>>({});
  const [tableLoading, setTableLoading] = useState<Record<string, boolean>>({});

  const loadTables = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ tables: TableInfo[] }>("/api/admin/database");
      setTables(data.tables);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTables(); }, [loadTables]);

  const loadTableData = useCallback(async (model: string, page = 1, pageSize = 20) => {
    setTableLoading((prev) => ({ ...prev, [model]: true }));
    try {
      const data = await fetchJson<TableData>(
        `/api/admin/database?table=${model}&page=${page}&pageSize=${pageSize}`,
      );
      setTableData((prev) => ({ ...prev, [model]: data }));
    } catch {
      // silently fail — table stays collapsed
    } finally {
      setTableLoading((prev) => ({ ...prev, [model]: false }));
    }
  }, []);

  const handleToggle = (model: string) => {
    if (expandedTable === model) {
      setExpandedTable(null);
    } else {
      setExpandedTable(model);
      if (!tableData[model]) {
        void loadTableData(model);
      }
    }
  };

  const handlePageChange = (model: string, newPage: number) => {
    const current = tableData[model];
    if (current) {
      void loadTableData(model, newPage + 1, current.pageSize);
    }
  };

  const handleRowsPerPageChange = (model: string, newSize: number) => {
    void loadTableData(model, 1, newSize);
  };

  if (loading) {
    return <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress /></Box>;
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3, flexDirection: { xs: "column", sm: "row" }, gap: { xs: 2, sm: 0 }, alignItems: { xs: "flex-start", sm: "center" } }}>
        <Box>
          <Typography variant="h5" fontWeight={700} sx={{ mb: 1, fontSize: { xs: 20, sm: 24 } }}>
            Datenbank-Browser
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Alle Tabellen der Anwendung. Nur Lesezugriff.
          </Typography>
        </Box>
        <Tooltip title="Tabellen neu laden">
          <IconButton onClick={() => { setTableData({}); void loadTables(); }}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {tables.map((t) => {
          const isExpanded = expandedTable === t.model;
          const data = tableData[t.model];
          const isLoading = tableLoading[t.model];

          return (
            <Paper key={t.model} variant="outlined" sx={{ overflow: "hidden" }}>
              {/* Header */}
              <Box
                onClick={() => handleToggle(t.model)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  px: 2,
                  py: 1.5,
                  cursor: "pointer",
                  bgcolor: isExpanded ? "action.selected" : "transparent",
                  "&:hover": { bgcolor: "action.hover" },
                  transition: "background-color 0.15s",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  {isExpanded ? <ExpandLessIcon sx={{ fontSize: 20 }} /> : <ExpandMoreIcon sx={{ fontSize: 20 }} />}
                  <StorageIcon sx={{ fontSize: 18, color: "primary.main" }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, fontFamily: "monospace", fontSize: 13 }}>
                    {t.label}
                  </Typography>
                </Box>
                <Chip
                  label={`${t.count} ${t.count === 1 ? "Eintrag" : "Einträge"}`}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: 11, height: 22 }}
                />
              </Box>

              {/* Collapsible content */}
              <Collapse in={isExpanded}>
                {isLoading ? (
                  <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                    <CircularProgress size={24} />
                  </Box>
                ) : data ? (
                  <Box>
                    <TableContainer sx={{ maxHeight: 480, overflowX: "auto" }}>
                      <Table size="small" stickyHeader sx={{ minWidth: 360 }}>
                        <TableHead>
                          <TableRow>
                            {data.columns.map((col) => (
                              <TableCell
                                key={col}
                                sx={{
                                  fontWeight: 700,
                                  fontSize: 11,
                                  fontFamily: "monospace",
                                  bgcolor: "grey.100",
                                  whiteSpace: "nowrap",
                                  py: 1,
                                  borderBottom: "2px solid",
                                  borderColor: "divider",
                                }}
                              >
                                {col}
                              </TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {data.rows.map((row, idx) => (
                            <TableRow key={idx} hover sx={{ "&:nth-of-type(even)": { bgcolor: "grey.50" } }}>
                              {data.columns.map((col) => {
                                const raw = formatCellValue(row[col]);
                                const truncated = raw.length > MAX_CELL_LENGTH;
                                const display = truncated ? raw.slice(0, MAX_CELL_LENGTH) + "…" : raw;
                                const isNull = row[col] === null || row[col] === undefined;

                                return (
                                  <TableCell
                                    key={col}
                                    sx={{
                                      fontSize: 12,
                                      fontFamily: "monospace",
                                      maxWidth: 240,
                                      py: 0.75,
                                      color: isNull ? "text.disabled" : "text.primary",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {truncated ? (
                                      <Tooltip
                                        title={
                                          <Typography sx={{ fontSize: 11, fontFamily: "monospace", maxWidth: 400, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                                            {raw}
                                          </Typography>
                                        }
                                        arrow
                                        placement="top-start"
                                      >
                                        <span>{display}</span>
                                      </Tooltip>
                                    ) : (
                                      display
                                    )}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          ))}
                          {data.rows.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={data.columns.length} align="center">
                                <Typography variant="body2" color="text.disabled" sx={{ py: 3 }}>
                                  Keine Daten in dieser Tabelle.
                                </Typography>
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    {data.total > 0 && (
                      <TablePagination
                        component="div"
                        count={data.total}
                        page={data.page - 1}
                        onPageChange={(_, p) => handlePageChange(t.model, p)}
                        rowsPerPage={data.pageSize}
                        onRowsPerPageChange={(e) => handleRowsPerPageChange(t.model, parseInt(e.target.value, 10))}
                        rowsPerPageOptions={[10, 20, 50, 100]}
                        labelRowsPerPage="Zeilen:"
                        labelDisplayedRows={({ from, to, count }) => `${from}-${to} von ${count}`}
                        sx={{ borderTop: "1px solid", borderColor: "divider" }}
                      />
                    )}
                  </Box>
                ) : null}
              </Collapse>
            </Paper>
          );
        })}
      </Box>
    </>
  );
}
