"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PersonIcon from "@mui/icons-material/Person";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MouseIcon from "@mui/icons-material/Mouse";
import VisibilityIcon from "@mui/icons-material/Visibility";
import LoginIcon from "@mui/icons-material/Login";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import SettingsIcon from "@mui/icons-material/Settings";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import type { LogEntry } from "@/lib/logging/logTypes";

/* ═══════════════════════════ types ═══════════════════════════ */

type LogUser = {
  userId: string;
  userName: string;
  eventCount: number;
  lastSeen: string;
};

type LogStats = {
  totalEvents: number;
  uniqueUsers: number;
  fileSize: string;
  availableDates: string[];
};

type LogView = "activity" | "system";

/* ═══════════════════════════ helpers ═══════════════════════════ */

const EVENT_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  page_view:    { label: "Seitenaufruf",   color: "#1565c0", icon: <VisibilityIcon sx={{ fontSize: 14 }} /> },
  page_leave:   { label: "Seite verlassen", color: "#78909c", icon: <VisibilityIcon sx={{ fontSize: 14 }} /> },
  click:        { label: "Klick",           color: "#6a1b9a", icon: <MouseIcon sx={{ fontSize: 14 }} /> },
  form_change:  { label: "Formular",        color: "#00838f", icon: <SettingsIcon sx={{ fontSize: 14 }} /> },
  session_start:{ label: "Session Start",   color: "#2e7d32", icon: <LoginIcon sx={{ fontSize: 14 }} /> },
  session_end:  { label: "Session Ende",    color: "#c62828", icon: <LoginIcon sx={{ fontSize: 14 }} /> },
  focus:        { label: "Fokus",           color: "#9e9e9e", icon: <VisibilityIcon sx={{ fontSize: 14 }} /> },
  blur:         { label: "Hintergrund",     color: "#bdbdbd", icon: <VisibilityIcon sx={{ fontSize: 14 }} /> },
  modal_open:   { label: "Modal geöffnet",  color: "#e65100", icon: <SettingsIcon sx={{ fontSize: 14 }} /> },
  modal_close:  { label: "Modal geschlossen", color: "#e65100", icon: <SettingsIcon sx={{ fontSize: 14 }} /> },
  // System events
  generation_start:    { label: "Generierung gestartet",  color: "#1565c0", icon: <PlayArrowIcon sx={{ fontSize: 14 }} /> },
  generation_complete: { label: "Generierung abgeschlossen", color: "#2e7d32", icon: <CheckCircleOutlineIcon sx={{ fontSize: 14 }} /> },
  generation_error:    { label: "Generierung fehlgeschlagen", color: "#c62828", icon: <ErrorOutlineIcon sx={{ fontSize: 14 }} /> },
  login:         { label: "Anmeldung",          color: "#2e7d32", icon: <LoginIcon sx={{ fontSize: 14 }} /> },
  login_failed:  { label: "Anmeldung fehlgeschlagen", color: "#c62828", icon: <WarningAmberIcon sx={{ fontSize: 14 }} /> },
  logout:        { label: "Abmeldung",          color: "#78909c", icon: <LoginIcon sx={{ fontSize: 14 }} /> },
  register:      { label: "Registrierung",      color: "#6a1b9a", icon: <PersonIcon sx={{ fontSize: 14 }} /> },
  api_error:     { label: "API-Fehler",          color: "#c62828", icon: <ErrorOutlineIcon sx={{ fontSize: 14 }} /> },
};

function getEventMeta(type: string) {
  return EVENT_LABELS[type] ?? { label: type, color: "#546e7a", icon: <SettingsIcon sx={{ fontSize: 14 }} /> };
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function getEventDetail(entry: LogEntry): string {
  const d = entry.data as Record<string, unknown>;
  switch (entry.type) {
    case "page_view":
      return `${d.path}`;
    case "page_leave":
      return `${d.path} · ${formatDuration(d.durationMs as number)} · ${d.scrollDepthPct}% gescrollt`;
    case "click":
      return `${d.text || d.element} auf ${d.path}`;
    case "form_change":
      return `Feld: ${d.fieldName} (${d.fieldType})`;
    case "session_start":
      return `${d.screenWidth}×${d.screenHeight} · ${(d.language as string)?.slice(0, 5)}`;
    case "session_end":
      return `Dauer: ${formatDuration(d.durationMs as number)}`;
    case "generation_start":
      return `Plan ${(d.month as string)} · ${d.employeeCount} MA · ${d.profileCount} Profile · Max ${d.maxSolveTimeSeconds}s`;
    case "generation_complete":
      return `${d.status} · ${d.assignmentCount} Zuweisungen · ${d.warningCount} Warnungen · ${formatDuration(d.solveTimeMs as number)}`;
    case "generation_error":
      return `${d.error}${d.status ? ` (${d.status})` : ""}`;
    case "login":
    case "login_failed":
      return `${d.email}${d.reason ? ` — ${d.reason}` : ""}`;
    case "api_error":
      return `${d.method} ${d.path} → ${d.status}`;
    default:
      return JSON.stringify(d).slice(0, 120);
  }
}

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

/* ═══════════════════════════ component ═══════════════════════════ */

export default function ActivityLogTab() {
  const [view, setView] = useState<LogView>("activity");
  const [users, setUsers] = useState<LogUser[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [selectedUser, setSelectedUser] = useState<LogUser | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const LIMIT = 100;

  // ── Load users ──
  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, statsRes] = await Promise.all([
        fetch(`/api/admin/logs?action=users&type=${view}`).then((r) => r.json()),
        fetch(`/api/admin/logs?action=stats&type=${view}`).then((r) => r.json()),
      ]);
      setUsers(usersRes.users ?? []);
      setStats(statsRes.stats ?? null);
    } catch {
      setError("Logs konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [view]);

  // ── Load entries for a user ──
  const loadEntries = useCallback(async (userId?: string, newOffset = 0) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        type: view,
        limit: String(LIMIT),
        offset: String(newOffset),
      });
      if (userId) params.set("userId", userId);
      const res = await fetch(`/api/admin/logs?${params}`).then((r) => r.json());
      setEntries(res.entries ?? []);
      setTotal(res.total ?? 0);
      setOffset(newOffset);
    } catch {
      setError("Einträge konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    setSelectedUser(null);
    setEntries([]);
    void loadUsers();
  }, [view, loadUsers]);

  const handleSelectUser = (user: LogUser) => {
    setSelectedUser(user);
    void loadEntries(user.userId, 0);
  };

  const handleBack = () => {
    setSelectedUser(null);
    setEntries([]);
  };

  // ── Render ──
  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2, flexWrap: "wrap", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {selectedUser && (
            <IconButton size="small" onClick={handleBack}>
              <ArrowBackIcon />
            </IconButton>
          )}
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {selectedUser ? selectedUser.userName : "Aktivitätslog"}
          </Typography>
          {selectedUser && (
            <Chip
              label={`${total} Ereignisse`}
              size="small"
              variant="outlined"
              sx={{ fontWeight: 600 }}
            />
          )}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ToggleButtonGroup
            value={view}
            exclusive
            onChange={(_, v) => v && setView(v)}
            size="small"
            sx={{
              "& .MuiToggleButton-root": {
                textTransform: "none",
                fontWeight: 600,
                fontSize: "0.8rem",
                px: 1.5,
              },
            }}
          >
            <ToggleButton value="activity">Benutzer</ToggleButton>
            <ToggleButton value="system">System</ToggleButton>
          </ToggleButtonGroup>
          <Tooltip title="Aktualisieren">
            <IconButton
              size="small"
              onClick={() => selectedUser ? loadEntries(selectedUser.userId, 0) : loadUsers()}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Stats bar */}
      {stats && !selectedUser && (
        <Box
          sx={{
            display: "flex",
            gap: 2,
            mb: 2,
            flexWrap: "wrap",
          }}
        >
          {[
            { label: "Ereignisse heute", value: String(stats.totalEvents) },
            { label: "Aktive Nutzer", value: String(stats.uniqueUsers) },
            { label: "Dateigröße", value: stats.fileSize },
            { label: "Verfügbare Tage", value: String(stats.availableDates.length) },
          ].map((s) => (
            <Box
              key={s.label}
              sx={{
                px: 2,
                py: 1,
                borderRadius: 2,
                bgcolor: "grey.50",
                border: "1px solid",
                borderColor: "grey.200",
                minWidth: 120,
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                {s.label}
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                {s.value}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && !entries.length && !users.length && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {/* User list view */}
      {!selectedUser && !loading && users.length === 0 && (
        <Alert severity="info">
          Noch keine Log-Daten vorhanden. Aktivitäten werden automatisch aufgezeichnet.
        </Alert>
      )}

      {!selectedUser && users.length > 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {users.map((user) => (
            <Card
              key={user.userId}
              variant="outlined"
              sx={{
                cursor: "pointer",
                transition: "all 0.15s",
                "&:hover": {
                  borderColor: "primary.main",
                  bgcolor: "action.hover",
                  transform: "translateX(4px)",
                },
              }}
              onClick={() => handleSelectUser(user)}
            >
              <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Avatar
                  sx={{
                    width: 40,
                    height: 40,
                    bgcolor: stringToColor(user.userName),
                    fontSize: 16,
                    fontWeight: 700,
                  }}
                >
                  {user.userName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "?"}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body1" sx={{ fontWeight: 600 }}>
                    {user.userName || user.userId}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Zuletzt aktiv: {formatDateTime(user.lastSeen)}
                  </Typography>
                </Box>
                <Chip
                  label={`${user.eventCount} Ereignisse`}
                  size="small"
                  variant="outlined"
                  sx={{ fontWeight: 600, minWidth: 100 }}
                />
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Event timeline view */}
      {selectedUser && entries.length > 0 && (
        <Box>
          {/* Timeline */}
          <Box sx={{ position: "relative", pl: 3 }}>
            {/* Vertical line */}
            <Box
              sx={{
                position: "absolute",
                left: 10,
                top: 0,
                bottom: 0,
                width: 2,
                bgcolor: "grey.200",
                borderRadius: 1,
              }}
            />

            {entries.map((entry, i) => {
              const meta = getEventMeta(entry.type);
              const detail = getEventDetail(entry);
              return (
                <Box
                  key={`${entry.ts}-${i}`}
                  sx={{
                    position: "relative",
                    mb: 0.75,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 1.5,
                    "&:hover": { "& .timeline-card": { borderColor: meta.color, bgcolor: `${meta.color}08` } },
                  }}
                >
                  {/* Dot */}
                  <Box
                    sx={{
                      position: "absolute",
                      left: -19,
                      top: 12,
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: meta.color,
                      border: "2px solid #fff",
                      boxShadow: "0 0 0 2px " + meta.color + "33",
                      zIndex: 1,
                    }}
                  />

                  {/* Card */}
                  <Box
                    className="timeline-card"
                    sx={{
                      flex: 1,
                      px: 1.5,
                      py: 0.75,
                      borderRadius: 1.5,
                      border: "1px solid",
                      borderColor: "grey.100",
                      bgcolor: "#fff",
                      transition: "all 0.15s",
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      minWidth: 0,
                    }}
                  >
                    {/* Time */}
                    <Typography
                      variant="caption"
                      sx={{
                        fontFamily: "monospace",
                        color: "text.secondary",
                        fontWeight: 600,
                        flexShrink: 0,
                        fontSize: 11,
                      }}
                    >
                      {formatTime(entry.ts)}
                    </Typography>

                    {/* Event badge */}
                    <Chip
                      icon={meta.icon as React.ReactElement}
                      label={meta.label}
                      size="small"
                      sx={{
                        bgcolor: `${meta.color}14`,
                        color: meta.color,
                        fontWeight: 600,
                        fontSize: 11,
                        height: 22,
                        flexShrink: 0,
                        "& .MuiChip-icon": { color: meta.color },
                      }}
                    />

                    {/* Detail */}
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {detail}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>

          {/* Pagination */}
          {total > LIMIT && (
            <Box sx={{ display: "flex", justifyContent: "center", gap: 1, mt: 2 }}>
              <Button
                size="small"
                variant="outlined"
                disabled={offset === 0}
                onClick={() => void loadEntries(selectedUser.userId, Math.max(0, offset - LIMIT))}
              >
                Zurück
              </Button>
              <Typography variant="body2" color="text.secondary" sx={{ display: "flex", alignItems: "center" }}>
                {offset + 1}–{Math.min(offset + LIMIT, total)} von {total}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                disabled={offset + LIMIT >= total}
                onClick={() => void loadEntries(selectedUser.userId, offset + LIMIT)}
              >
                Weiter
              </Button>
            </Box>
          )}
        </Box>
      )}

      {selectedUser && !loading && entries.length === 0 && (
        <Alert severity="info">
          Keine Ereignisse für diesen Benutzer gefunden.
        </Alert>
      )}
    </Box>
  );
}
