"use client";

import { useCallback, useEffect, useState } from "react";
import MainLayout from "@/components/layout/MainLayout";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Avatar,
  Chip,
  IconButton,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from "@mui/material";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

type SwapRow = {
  id: string;
  status: string;
  fromAssignmentId: string;
  toEmployeeId: string | null;
  assignmentDate: string;
  shiftType: string;
  shiftLabel: string;
  fromEmployeeName: string;
  toEmployeeName: string | null;
  plannerDecisionReason: string | null;
  createdAt: string;
};

function statusDe(s: string) {
  if (s === "REQUESTED") return "Offen";
  if (s === "APPROVED") return "Genehmigt";
  if (s === "REJECTED") return "Abgelehnt";
  if (s === "CANCELLED") return "Storniert";
  return s;
}

export default function SwapsPage() {
  const [swaps, setSwaps] = useState<SwapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [approveToId, setApproveToId] = useState("");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [employeeOptions, setEmployeeOptions] = useState<{ id: string; label: string }[]>(
    [],
  );

  const loadEmployees = useCallback(async () => {
    try {
      const r = await fetchJson<{
        employees: { id: string; firstName: string; lastName: string }[];
      }>("/api/employees");
      setEmployeeOptions(
        r.employees.map((e) => ({
          id: e.id,
          label: `${e.firstName} ${e.lastName}`.trim(),
        })),
      );
    } catch {
      setEmployeeOptions([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson<{ swaps: SwapRow[] }>("/api/swaps");
      setSwaps(res.swaps);
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
      setSwaps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadEmployees();
  }, [load, loadEmployees]);

  const openApprove = (s: SwapRow) => {
    setApproveId(s.id);
    setApproveToId(s.toEmployeeId ?? "");
  };

  const submitApprove = async () => {
    if (!approveId) return;
    const swap = swaps.find((x) => x.id === approveId);
    if (!swap) return;
    const body: Record<string, string> = {};
    if (!swap.toEmployeeId) {
      if (!approveToId.trim()) {
        setError("Ziel-Mitarbeiter-ID erforderlich (Anfrage ohne Ziel).");
        return;
      }
      body.toEmployeeId = approveToId.trim();
    }
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/swaps/${approveId}/approve`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setApproveId(null);
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
            : "Freigabe fehlgeschlagen.";
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitReject = async () => {
    if (!rejectId) return;
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/swaps/${rejectId}/reject`, {
        method: "PATCH",
        body: JSON.stringify({ plannerDecisionReason: rejectReason.trim() || null }),
      });
      setRejectId(null);
      setRejectReason("");
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
            : "Ablehnen fehlgeschlagen.";
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const shiftColor = (t: string) =>
    t === "EARLY" ? "warning" : t === "LATE" ? "info" : t === "NIGHT" ? "secondary" : "default";

  return (
    <MainLayout title="Tausch-Anfragen">
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {swaps.map((swap) => (
            <Card key={swap.id}>
              <CardContent>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 2,
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2, flex: 1, minWidth: 200 }}>
                    <Avatar sx={{ bgcolor: "primary.main" }}>
                      {swap.fromEmployeeName
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </Avatar>
                    <Box>
                      <Typography variant="body1" fontWeight={500}>
                        {swap.fromEmployeeName}
                      </Typography>
                      <Box sx={{ display: "flex", gap: 1, mt: 0.5, flexWrap: "wrap" }}>
                        <Chip label={swap.assignmentDate} size="small" variant="outlined" />
                        <Chip
                          label={shiftTypeLabel(swap.shiftType)}
                          size="small"
                          color={shiftColor(swap.shiftType) as "warning" | "info" | "secondary"}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
                          {swap.shiftLabel}
                        </Typography>
                      </Box>
                    </Box>
                  </Box>

                  <Box sx={{ px: 2 }}>
                    <SwapHorizIcon sx={{ fontSize: 32, color: "text.secondary" }} />
                  </Box>

                  <Box sx={{ display: "flex", alignItems: "center", gap: 2, flex: 1, minWidth: 200 }}>
                    <Avatar sx={{ bgcolor: "secondary.main" }}>
                      {(swap.toEmployeeName ?? "?")
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </Avatar>
                    <Box>
                      <Typography variant="body1" fontWeight={500}>
                        {swap.toEmployeeName ?? "— (offen)"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Ziel-Mitarbeiter
                      </Typography>
                    </Box>
                  </Box>

                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      pl: 2,
                      borderLeft: 1,
                      borderColor: "divider",
                    }}
                  >
                    <Box sx={{ textAlign: "right" }}>
                      <Chip
                        label={statusDe(swap.status)}
                        size="small"
                        color={
                          swap.status === "REQUESTED"
                            ? "warning"
                            : swap.status === "APPROVED"
                              ? "success"
                              : "default"
                        }
                      />
                      <Typography
                        variant="caption"
                        display="block"
                        color="text.secondary"
                        sx={{ mt: 0.5 }}
                      >
                        {new Date(swap.createdAt).toLocaleString("de-DE")}
                      </Typography>
                    </Box>
                    {swap.status === "REQUESTED" && (
                      <Box>
                        <IconButton color="success" onClick={() => openApprove(swap)}>
                          <CheckIcon />
                        </IconButton>
                        <IconButton color="error" onClick={() => setRejectId(swap.id)}>
                          <CloseIcon />
                        </IconButton>
                      </Box>
                    )}
                  </Box>
                </Box>
              </CardContent>
            </Card>
          ))}

          {swaps.length === 0 && (
            <Card>
              <CardContent sx={{ textAlign: "center", py: 6 }}>
                <SwapHorizIcon sx={{ fontSize: 48, color: "text.disabled", mb: 2 }} />
                <Typography color="text.secondary">Keine Tausch-Anfragen vorhanden</Typography>
              </CardContent>
            </Card>
          )}
        </Box>
      )}

      <Dialog open={approveId !== null} onClose={() => !busy && setApproveId(null)} fullWidth maxWidth="sm">
        <DialogTitle>Tausch genehmigen</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          {approveId &&
            !swaps.find((s) => s.id === approveId)?.toEmployeeId && (
              <FormControl fullWidth disabled={busy}>
                <InputLabel id="swap-to-emp">Ziel-Mitarbeiter</InputLabel>
                <Select
                  labelId="swap-to-emp"
                  label="Ziel-Mitarbeiter"
                  value={approveToId}
                  onChange={(e) => setApproveToId(e.target.value)}
                >
                  {employeeOptions.map((o) => (
                    <MenuItem key={o.id} value={o.id}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApproveId(null)} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="contained" onClick={() => void submitApprove()} disabled={busy}>
            {busy ? <CircularProgress size={22} /> : "Genehmigen"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rejectId !== null} onClose={() => !busy && setRejectId(null)} fullWidth maxWidth="sm">
        <DialogTitle>Tausch ablehnen</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <TextField
            label="Begründung (optional)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            disabled={busy}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectId(null)} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="contained" color="error" onClick={() => void submitReject()} disabled={busy}>
            {busy ? <CircularProgress size={22} /> : "Ablehnen"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainLayout>
  );
}
