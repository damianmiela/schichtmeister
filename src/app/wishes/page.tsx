"use client";

import { useCallback, useEffect, useState } from "react";
import MainLayout from "@/components/layout/MainLayout";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
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
  TextField,
  InputAdornment,
  Tab,
  Tabs,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

type WishRow = {
  id: string;
  employeeId: string;
  employeeName?: string;
  date: string;
  shiftType: string | null;
  shiftProfileId: string | null;
  priority: string;
  status: string;
  note: string | null;
  decisionReason: string | null;
};

function priorityLabel(p: string) {
  return p === "STRONG" ? "Stark" : "Normal";
}

function statusLabel(s: string) {
  if (s === "OPEN") return "Offen";
  if (s === "FULFILLED") return "Erfüllt";
  if (s === "NOT_FULFILLED") return "Abgelehnt";
  return s;
}

export default function WishesPage() {
  const [wishes, setWishes] = useState<WishRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState(0);
  const [decideId, setDecideId] = useState<string | null>(null);
  const [decideKind, setDecideKind] = useState<"FULFILLED" | "NOT_FULFILLED" | null>(null);
  const [reason, setReason] = useState("");
  const [decideBusy, setDecideBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson<{ wishes: WishRow[] }>("/api/wishes");
      setWishes(res.wishes);
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
      setWishes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = wishes.filter((w) => {
    if (tab === 1 && w.status !== "FULFILLED") return false;
    if (tab === 2 && w.status !== "NOT_FULFILLED") return false;
    if (tab === 0 && w.status !== "OPEN") return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const name = (w.employeeName ?? "").toLowerCase();
    return name.includes(q) || w.date.includes(q);
  });

  const openCount = wishes.filter((w) => w.status === "OPEN").length;
  const okCount = wishes.filter((w) => w.status === "FULFILLED").length;
  const noCount = wishes.filter((w) => w.status === "NOT_FULFILLED").length;

  const openDecide = (id: string, kind: "FULFILLED" | "NOT_FULFILLED") => {
    setDecideId(id);
    setDecideKind(kind);
    setReason("");
  };

  const submitDecide = async () => {
    if (!decideId || !decideKind) return;
    setDecideBusy(true);
    try {
      await fetchJson(`/api/wishes/${decideId}/decide`, {
        method: "PATCH",
        body: JSON.stringify({
          status: decideKind,
          decisionReason: reason.trim() || null,
        }),
      });
      setDecideId(null);
      setDecideKind(null);
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
      setDecideBusy(false);
    }
  };

  const shiftChip = (w: WishRow) => {
    const t = w.shiftType ? shiftTypeLabel(w.shiftType) : w.shiftProfileId ? "Profil" : "—";
    const color =
      w.shiftType === "EARLY" ? "warning" : w.shiftType === "LATE" ? "info" : w.shiftType === "NIGHT" ? "secondary" : "default";
    return <Chip label={t} size="small" color={color as "warning" | "info" | "secondary" | "default"} />;
  };

  return (
    <MainLayout title="Dienstwünsche">
      <Card>
        <CardContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab label={`Offen (${openCount})`} />
              <Tab label={`Erfüllt (${okCount})`} />
              <Tab label={`Abgelehnt (${noCount})`} />
              <Tab label={`Alle (${wishes.length})`} />
            </Tabs>
          </Box>

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
              placeholder="Suchen…"
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
                    <TableCell>Datum</TableCell>
                    <TableCell>Wunsch</TableCell>
                    <TableCell>Priorität</TableCell>
                    <TableCell>Notiz</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Aktionen</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Typography color="text.secondary" sx={{ py: 2 }}>
                          Keine Einträge.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((wish) => (
                      <TableRow key={wish.id} hover>
                        <TableCell>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <Avatar sx={{ bgcolor: "primary.main", width: 32, height: 32 }}>
                              {(wish.employeeName ?? "?")
                                .split(" ")
                                .map((n) => n[0])
                                .join("")
                                .slice(0, 2)}
                            </Avatar>
                            <Typography variant="body2">
                              {wish.employeeName ?? wish.employeeId}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          {new Date(`${wish.date}T12:00:00`).toLocaleDateString("de-DE")}
                        </TableCell>
                        <TableCell>{shiftChip(wish)}</TableCell>
                        <TableCell>
                          <Chip
                            label={priorityLabel(wish.priority)}
                            size="small"
                            variant="outlined"
                            color={wish.priority === "STRONG" ? "error" : "default"}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}
                          >
                            {wish.note || "—"}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={statusLabel(wish.status)}
                            size="small"
                            color={
                              wish.status === "OPEN"
                                ? "warning"
                                : wish.status === "FULFILLED"
                                  ? "success"
                                  : "error"
                            }
                          />
                        </TableCell>
                        <TableCell align="right">
                          {wish.status === "OPEN" && (
                            <>
                              <IconButton
                                size="small"
                                color="success"
                                onClick={() => openDecide(wish.id, "FULFILLED")}
                              >
                                <CheckIcon fontSize="small" />
                              </IconButton>
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => openDecide(wish.id, "NOT_FULFILLED")}
                              >
                                <CloseIcon fontSize="small" />
                              </IconButton>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={decideId !== null}
        onClose={() => !decideBusy && setDecideId(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {decideKind === "FULFILLED" ? "Wunsch erfüllen" : "Wunsch ablehnen"}
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <TextField
            label="Begründung (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            disabled={decideBusy}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDecideId(null)} disabled={decideBusy}>
            Abbrechen
          </Button>
          <Button variant="contained" onClick={() => void submitDecide()} disabled={decideBusy}>
            {decideBusy ? <CircularProgress size={22} /> : "Speichern"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainLayout>
  );
}
