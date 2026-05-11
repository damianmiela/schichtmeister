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
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
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
  // Page navigation (the only client-side event we still emit).
  page_view: { label: "Seite geöffnet", color: "#1565c0", icon: <VisibilityIcon sx={{ fontSize: 14 }} /> },

  // Auth.
  login:        { label: "Anmeldung",                color: "#2e7d32", icon: <LoginIcon         sx={{ fontSize: 14 }} /> },
  logout:       { label: "Abmeldung",                color: "#78909c", icon: <LoginIcon         sx={{ fontSize: 14 }} /> },
  login_failed: { label: "Anmeldung fehlgeschlagen", color: "#c62828", icon: <WarningAmberIcon  sx={{ fontSize: 14 }} /> },
  register:     { label: "Registrierung",            color: "#6a1b9a", icon: <PersonIcon        sx={{ fontSize: 14 }} /> },

  // Generation lifecycle.
  generation_start:    { label: "Dienstplan generieren — gestartet",      color: "#1565c0", icon: <PlayArrowIcon              sx={{ fontSize: 14 }} /> },
  generation_complete: { label: "Dienstplan generieren — abgeschlossen",  color: "#2e7d32", icon: <CheckCircleOutlineIcon     sx={{ fontSize: 14 }} /> },
  generation_error:    { label: "Dienstplan generieren — fehlgeschlagen", color: "#c62828", icon: <ErrorOutlineIcon           sx={{ fontSize: 14 }} /> },

  // Errors.
  api_error: { label: "API-Fehler", color: "#c62828", icon: <ErrorOutlineIcon sx={{ fontSize: 14 }} /> },

  // Legacy events from log files written before the cleanup refactor.
  // They keep rendering for the rest of the 30-day retention window but in
  // a single subdued style so they don't dominate the timeline visually.
  click:         { label: "Klick (alt)",          color: "#bdbdbd", icon: <MouseIcon       sx={{ fontSize: 14 }} /> },
  page_leave:    { label: "Seite verlassen (alt)", color: "#bdbdbd", icon: <VisibilityIcon  sx={{ fontSize: 14 }} /> },
  focus:         { label: "Fokus (alt)",          color: "#bdbdbd", icon: <VisibilityIcon  sx={{ fontSize: 14 }} /> },
  blur:          { label: "Hintergrund (alt)",     color: "#bdbdbd", icon: <VisibilityIcon  sx={{ fontSize: 14 }} /> },
  session_start: { label: "Session Start (alt)",   color: "#bdbdbd", icon: <LoginIcon       sx={{ fontSize: 14 }} /> },
  session_end:   { label: "Session Ende (alt)",    color: "#bdbdbd", icon: <LoginIcon       sx={{ fontSize: 14 }} /> },
  modal_open:    { label: "Modal geöffnet (alt)",  color: "#bdbdbd", icon: <SettingsIcon    sx={{ fontSize: 14 }} /> },
  modal_close:   { label: "Modal geschlossen (alt)", color: "#bdbdbd", icon: <SettingsIcon  sx={{ fontSize: 14 }} /> },
  form_change:   { label: "Formular (alt)",         color: "#bdbdbd", icon: <SettingsIcon    sx={{ fontSize: 14 }} /> },
};

/** Event types considered "legacy noise" — shown muted, NOT counted in the
 *  events badge, and can be hidden via the toggle in the user detail view. */
const LEGACY_EVENT_TYPES = new Set<string>([
  "click",
  "page_leave",
  "focus",
  "blur",
  "session_start",
  "session_end",
  "modal_open",
  "modal_close",
  "form_change",
]);

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

function prettyPath(path: string): string {
  if (!path || path === "/") return "Startseite";
  if (path.startsWith("/schedule")) return "Monatsplan";
  if (path.startsWith("/employees")) return "Mitarbeiter";
  if (path.startsWith("/shift-profiles")) return "Schichtprofile";
  if (path.startsWith("/admin")) return "Admin";
  if (path.startsWith("/settings")) return "Einstellungen";
  if (path.startsWith("/login")) return "Anmeldung";
  if (path.startsWith("/register")) return "Registrierung";
  if (path.startsWith("/forgot-password")) return "Passwort vergessen";
  if (path.startsWith("/reset-password")) return "Passwort zurücksetzen";
  return path;
}

function getEventDetail(entry: LogEntry): string {
  const d = entry.data as Record<string, unknown>;
  switch (entry.type) {
    case "page_view": {
      const path = d.path as string;
      return `${prettyPath(path)} (${path})`;
    }
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
    case "generation_complete": {
      const parts: string[] = [
        `${d.status}`,
        `${d.assignmentCount} Zuweisungen`,
        `${d.warningCount} Warnungen`,
        formatDuration(d.solveTimeMs as number),
      ];
      if (typeof d.objectiveValue === "number") {
        parts.push(`obj=${Math.round(d.objectiveValue as number).toLocaleString("de-DE")}`);
      }
      const qm = d.qualityMetrics as
        | {
            maxOverSollH?: number;
            avgAbsDeviationH?: number;
            blWeekViolations?: number;
          }
        | undefined;
      if (qm && typeof qm === "object") {
        const qParts: string[] = [];
        if (typeof qm.maxOverSollH === "number")
          qParts.push(`max+${qm.maxOverSollH.toFixed(1)}h`);
        if (typeof qm.avgAbsDeviationH === "number")
          qParts.push(`Ø|Δ|${qm.avgAbsDeviationH.toFixed(1)}h`);
        if (typeof qm.blWeekViolations === "number" && qm.blWeekViolations > 0)
          qParts.push(`BL-Lücken ${qm.blWeekViolations}`);
        if (qParts.length > 0) parts.push(qParts.join(" · "));
      }
      if (typeof d.randomSeed === "number") {
        parts.push(`seed=${d.randomSeed}`);
      }
      return parts.join(" · ");
    }
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
  /** Hide legacy / "noise" event types (click, focus, page_leave, …) by
   *  default. They'll disappear from the data set entirely once the
   *  30-day retention window has rolled past the refactor. */
  const [hideLegacy, setHideLegacy] = useState(true);
  const LIMIT = 100;

  // ── Load users ──
  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersResponse, statsResponse] = await Promise.all([
        fetch(`/api/admin/logs?action=users&type=${view}`),
        fetch(`/api/admin/logs?action=stats&type=${view}`),
      ]);

      if (!usersResponse.ok) {
        const text = await usersResponse.text().catch(() => "");
        setError(`Benutzer laden fehlgeschlagen: ${usersResponse.status} ${usersResponse.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`);
        setLoading(false);
        return;
      }
      if (!statsResponse.ok) {
        const text = await statsResponse.text().catch(() => "");
        setError(`Stats laden fehlgeschlagen: ${statsResponse.status} ${statsResponse.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`);
        setLoading(false);
        return;
      }

      const usersRes = await usersResponse.json();
      const statsRes = await statsResponse.json();
      setUsers(usersRes.users ?? []);
      setStats(statsRes.stats ?? null);
    } catch (err) {
      setError(`Logs konnten nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [view]);

  // ── Load entries for a user ──
  // Pulls activity + system logs in parallel and merges them into one
  // chronological timeline so "where the user was" (page_view) and "what
  // happened server-side" (login, generation, api_error) live in one feed.
  const loadEntries = useCallback(
    async (userId?: string, newOffset = 0) => {
      setLoading(true);
      setError(null);
      try {
        const fetchSlice = async (logType: LogView) => {
          const params = new URLSearchParams({
            type: logType,
            // Pull a generous slice from each side; we sort + paginate client-side.
            limit: "500",
            offset: "0",
          });
          if (userId) params.set("userId", userId);
          const r = await fetch(`/api/admin/logs?${params}`);
          if (!r.ok) {
            const text = await r.text().catch(() => "");
            throw new Error(
              `${logType}: ${r.status} ${r.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`,
            );
          }
          const j = await r.json();
          return (j.entries ?? []) as LogEntry[];
        };

        const [activity, system] = userId
          ? await Promise.all([fetchSlice("activity"), fetchSlice("system")])
          : [await fetchSlice(view), [] as LogEntry[]];

        const merged = [...activity, ...system].sort((a, b) =>
          b.ts.localeCompare(a.ts),
        );
        setTotal(merged.length);
        setEntries(merged.slice(newOffset, newOffset + LIMIT));
        setOffset(newOffset);
      } catch (err) {
        setError(
          `Einträge konnten nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setLoading(false);
      }
    },
    [view],
  );

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
              label={`${
                hideLegacy
                  ? entries.filter((e) => !LEGACY_EVENT_TYPES.has(e.type)).length +
                    " sichtbar / " +
                    total
                  : total
              } Ereignisse`}
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
          {selectedUser && (
            <Tooltip
              title={
                hideLegacy
                  ? "Klicks/Fokus/Seite-verlassen (alt) einblenden"
                  : "Alte Ereignisse ausblenden"
              }
            >
              <Button
                size="small"
                variant={hideLegacy ? "outlined" : "contained"}
                onClick={() => setHideLegacy((v) => !v)}
                sx={{ textTransform: "none", fontSize: "0.72rem", py: 0.25 }}
              >
                {hideLegacy ? "Alte einblenden" : "Alte ausblenden"}
              </Button>
            </Tooltip>
          )}
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

            {entries
              .filter((entry) => !hideLegacy || !LEGACY_EVENT_TYPES.has(entry.type))
              .map((entry, i) => {
              const meta = getEventMeta(entry.type);
              const detail = getEventDetail(entry);
              // Vergleichsmodus extras (only present on generation_complete
              // events emitted when comparisonMode was active).
              const data = entry.data as Record<string, unknown>;
              const variant = data.variant as "baseline" | "race" | undefined;
              const isWinner = data.winner === true;
              const comparisonId = data.comparisonId as string | undefined;
              const randomSeed =
                typeof data.randomSeed === "number"
                  ? (data.randomSeed as number)
                  : null;
              const vglBadgeLabel = variant
                ? variant === "baseline"
                  ? "VGL · Basis"
                  : `VGL · ${randomSeed != null ? `Seed ${randomSeed}` : "Race"}`
                : null;
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

                    {/* Vergleichsmodus variant badge */}
                    {vglBadgeLabel ? (
                      <Tooltip
                        title={
                          comparisonId
                            ? `Vergleichs-ID: ${comparisonId}`
                            : "Vergleichsmodus"
                        }
                      >
                        <Chip
                          icon={
                            <CompareArrowsIcon sx={{ fontSize: 14 }} />
                          }
                          label={vglBadgeLabel}
                          size="small"
                          variant="outlined"
                          sx={{
                            borderColor: "#0288d1",
                            color: "#0288d1",
                            fontWeight: 600,
                            fontSize: 10,
                            height: 22,
                            flexShrink: 0,
                            "& .MuiChip-icon": { color: "#0288d1" },
                          }}
                        />
                      </Tooltip>
                    ) : null}

                    {/* Winner trophy */}
                    {isWinner ? (
                      <Tooltip title="Gewinner-Lauf — dieser Plan wurde übernommen">
                        <Chip
                          icon={<EmojiEventsIcon sx={{ fontSize: 14 }} />}
                          label="Gewinner"
                          size="small"
                          sx={{
                            bgcolor: "#fff8e1",
                            color: "#ef6c00",
                            fontWeight: 700,
                            fontSize: 10,
                            height: 22,
                            flexShrink: 0,
                            "& .MuiChip-icon": { color: "#ef6c00" },
                          }}
                        />
                      </Tooltip>
                    ) : null}

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
