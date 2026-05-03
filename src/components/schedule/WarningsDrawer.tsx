"use client";

import { useMemo, useState } from "react";
import {
  Box,
  Chip,
  Collapse,
  Divider,
  Drawer,
  IconButton,
  Typography,
  alpha,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import {
  countBySeverity,
  groupWarningsBySeverity,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  SEVERITY_TOKENS,
  type WarningSeverity,
  type ClassifiedWarning,
} from "@/lib/schedule/warningSeverity";

export interface WarningsDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Title for the drawer header. */
  title: string;
  /** Empty-state text shown when `warnings` is []. */
  emptyText: string;
  /** Already-formatted German warning strings (existing schedule.warnings). */
  warnings: readonly string[];
}

const severityIcon = (s: WarningSeverity, fontSize = 18) => {
  const sx = { fontSize, color: SEVERITY_TOKENS[s].main };
  if (s === "red") return <ErrorOutlineIcon sx={sx} />;
  if (s === "yellow") return <WarningAmberIcon sx={sx} />;
  return <InfoOutlinedIcon sx={sx} />;
};

/**
 * Active-filter state. `null` means "all severities visible".
 * Set to a single severity to filter to just that one.
 */
type SeverityFilter = WarningSeverity | null;

export default function WarningsDrawer({
  open,
  onClose,
  title,
  emptyText,
  warnings,
}: WarningsDrawerProps) {
  const counts = useMemo(() => countBySeverity(warnings), [warnings]);
  const grouped = useMemo(() => groupWarningsBySeverity(warnings), [warnings]);

  const [filter, setFilter] = useState<SeverityFilter>(null);

  // Per-section + per-group collapse state. Defaults: severity sections open,
  // category groups open. Stored by composite key.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const isCollapsed = (key: string) => collapsed.has(key);
  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const total = counts.red + counts.yellow + counts.green;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="temporary"
      PaperProps={{
        sx: { width: { xs: "100%", sm: 420 }, p: 0, display: "flex", flexDirection: "column" },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1.5,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <WarningAmberIcon sx={{ color: "text.secondary" }} />
          <Typography variant="h6" sx={{ fontSize: "1rem" }}>
            {title}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Filter chips */}
      {total > 0 && (
        <>
          <Box
            sx={{
              display: "flex",
              gap: 0.75,
              alignItems: "center",
              px: 2,
              py: 1,
              flexWrap: "wrap",
            }}
          >
            <SeverityChip
              active={filter === null}
              onClick={() => setFilter(null)}
              label={`Alle ${total}`}
              color={null}
            />
            {SEVERITY_ORDER.map((s) =>
              counts[s] > 0 ? (
                <SeverityChip
                  key={s}
                  active={filter === s}
                  onClick={() => setFilter((prev) => (prev === s ? null : s))}
                  label={`${SEVERITY_LABEL[s]} ${counts[s]}`}
                  color={s}
                />
              ) : null,
            )}
          </Box>
          <Divider />
        </>
      )}

      {/* Body */}
      <Box sx={{ p: 2, overflow: "auto", flex: 1 }}>
        {total === 0 ? (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              p: 2,
              borderRadius: 1,
              bgcolor: (t) => alpha(t.palette.success.main, 0.08),
              color: "success.dark",
            }}
          >
            <CheckCircleOutlineIcon sx={{ color: "success.main" }} />
            <Typography variant="body2">{emptyText}</Typography>
          </Box>
        ) : (
          SEVERITY_ORDER.map((sev) => {
            if (filter !== null && filter !== sev) return null;
            const groups = grouped[sev];
            if (groups.size === 0) return null;
            const sectionKey = `sec:${sev}`;
            const sectionOpen = !isCollapsed(sectionKey);
            const tokens = SEVERITY_TOKENS[sev];
            return (
              <Box key={sev} sx={{ mb: 1.5 }}>
                {/* Section header */}
                <Box
                  onClick={() => toggleCollapsed(sectionKey)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                    px: 1,
                    py: 0.75,
                    borderRadius: 1,
                    bgcolor: tokens.bg,
                    border: `1px solid ${tokens.border}`,
                    "&:hover": { filter: "brightness(0.97)" },
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    {severityIcon(sev, 18)}
                    <Typography
                      variant="subtitle2"
                      sx={{ color: tokens.main, fontWeight: 700, fontSize: "0.85rem" }}
                    >
                      {SEVERITY_LABEL[sev]} ({counts[sev]})
                    </Typography>
                  </Box>
                  {sectionOpen ? (
                    <ExpandLessIcon sx={{ fontSize: 18, color: tokens.main }} />
                  ) : (
                    <ExpandMoreIcon sx={{ fontSize: 18, color: tokens.main }} />
                  )}
                </Box>

                <Collapse in={sectionOpen} unmountOnExit>
                  <Box sx={{ mt: 0.75, display: "flex", flexDirection: "column", gap: 0.5 }}>
                    {[...groups.entries()].map(([groupKey, items]) =>
                      renderGroup(sev, groupKey, items, isCollapsed, toggleCollapsed),
                    )}
                  </Box>
                </Collapse>
              </Box>
            );
          })
        )}
      </Box>
    </Drawer>
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

function SeverityChip({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color: WarningSeverity | null;
}) {
  const tokens = color ? SEVERITY_TOKENS[color] : null;
  return (
    <Chip
      size="small"
      label={label}
      onClick={onClick}
      sx={{
        fontWeight: 700,
        fontSize: "0.72rem",
        height: 24,
        cursor: "pointer",
        ...(active
          ? {
              bgcolor: tokens?.main ?? "primary.main",
              color: "#fff",
              "&:hover": { bgcolor: tokens?.main ?? "primary.dark", filter: "brightness(0.95)" },
            }
          : {
              bgcolor: tokens?.bg ?? "grey.100",
              color: tokens?.main ?? "text.primary",
              border: `1px solid ${tokens?.border ?? "rgba(0,0,0,0.12)"}`,
              "&:hover": { bgcolor: tokens?.bg ?? "grey.200", filter: "brightness(0.97)" },
            }),
      }}
    />
  );
}

function renderGroup(
  sev: WarningSeverity,
  groupKey: string,
  items: ClassifiedWarning[],
  isCollapsed: (k: string) => boolean,
  toggleCollapsed: (k: string) => void,
) {
  const tokens = SEVERITY_TOKENS[sev];
  const composite = `grp:${sev}:${groupKey}`;
  const open = !isCollapsed(composite);
  // Single-item groups don't need a collapsible wrapper — render the message directly.
  if (items.length === 1) {
    return (
      <WarningCard key={composite} sev={sev} text={items[0]!.message} />
    );
  }
  const cat = items[0]!.category;
  return (
    <Box key={composite}>
      <Box
        onClick={() => toggleCollapsed(composite)}
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          px: 1,
          py: 0.5,
          borderRadius: 1,
          bgcolor: alpha(tokens.main, 0.06),
          border: `1px dashed ${tokens.border}`,
          "&:hover": { bgcolor: alpha(tokens.main, 0.1) },
        }}
      >
        <Typography
          variant="caption"
          sx={{ color: tokens.main, fontWeight: 700, fontSize: "0.72rem" }}
        >
          {cat} ({items.length})
        </Typography>
        {open ? (
          <ExpandLessIcon sx={{ fontSize: 16, color: tokens.main }} />
        ) : (
          <ExpandMoreIcon sx={{ fontSize: 16, color: tokens.main }} />
        )}
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ mt: 0.5, ml: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
          {items.map((it, i) => (
            <WarningCard key={`${composite}:${i}`} sev={sev} text={it.message} />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

/**
 * A single bullet line parsed from an aggregated multi-employee/multi-station
 * warning. Format expected: "• <label>: <stats> — <dates>" (the em-dash and
 * stats are optional). The drawer renders these as structured mini-rows
 * instead of plain pre-line text so dense lists stay scannable.
 */
type BulletEntry = {
  label: string;
  stats?: string;
  dates?: string;
};

function parseBulletLine(line: string): BulletEntry | null {
  if (!line.startsWith("•")) return null;
  const rest = line.slice(1).trim(); // drop the • and surrounding space
  if (!rest) return null;

  // Split off " — <dates>" if present.
  const emDashIdx = rest.indexOf(" — ");
  const beforeDash = emDashIdx >= 0 ? rest.slice(0, emDashIdx) : rest;
  const dates = emDashIdx >= 0 ? rest.slice(emDashIdx + 3).trim() : undefined;

  // Split off "<label>: <stats>" if a colon is present in the head.
  const colonIdx = beforeDash.indexOf(":");
  if (colonIdx >= 0) {
    return {
      label: beforeDash.slice(0, colonIdx).trim(),
      stats: beforeDash.slice(colonIdx + 1).trim() || undefined,
      dates,
    };
  }
  return { label: beforeDash, dates };
}

function WarningCard({ sev, text }: { sev: WarningSeverity; text: string }) {
  const tokens = SEVERITY_TOKENS[sev];
  // Multi-line aggregations use "\n" between header and bullet entries.
  const newlineIdx = text.indexOf("\n");
  const hasMultiline = newlineIdx >= 0;
  const head = hasMultiline ? text.slice(0, newlineIdx) : text;
  const body = hasMultiline ? text.slice(newlineIdx + 1) : "";

  // Try to parse the body as a list of "• ..." bullets. If every non-empty
  // line is a bullet, we render a structured layout; otherwise we fall back
  // to the original whiteSpace: "pre-line" rendering.
  const bulletEntries: BulletEntry[] = [];
  let allBullets = false;
  if (hasMultiline) {
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    const parsed = lines.map(parseBulletLine);
    if (lines.length > 0 && parsed.every((e) => e !== null)) {
      allBullets = true;
      for (const e of parsed) bulletEntries.push(e!);
    }
  }

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: 0.75,
        bgcolor: tokens.bg,
        border: `1px solid ${tokens.border}`,
        borderRadius: 1,
        px: 1,
        py: 0.6,
      }}
    >
      <Box sx={{ pt: "1px", flexShrink: 0 }}>{severityIcon(sev, 16)}</Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="body2"
          sx={{
            fontSize: "0.78rem",
            lineHeight: 1.35,
            color: "text.primary",
            fontWeight: hasMultiline ? 600 : 400,
            wordBreak: "break-word",
          }}
        >
          {head}
        </Typography>

        {hasMultiline && allBullets && (
          <Box
            sx={{
              mt: 0.5,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {bulletEntries.map((e, i) => (
              <BulletRow
                key={i}
                sev={sev}
                entry={e}
                divider={i < bulletEntries.length - 1}
              />
            ))}
          </Box>
        )}

        {hasMultiline && !allBullets && (
          <Typography
            variant="body2"
            component="div"
            sx={{
              mt: 0.4,
              fontSize: "0.72rem",
              lineHeight: 1.5,
              color: "text.secondary",
              whiteSpace: "pre-line",
              wordBreak: "break-word",
            }}
          >
            {body}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

/**
 * One row inside an aggregated card. Layout:
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  Name                              [stats badge]    │
 *   │  09.05. (Sa+So) · 16.05. (Sa) · 23.05. …            │
 *   └─────────────────────────────────────────────────────┘
 *
 * The stats badge is omitted when there is no stats text. The dates row is
 * omitted when there are no dates.
 */
function BulletRow({
  sev,
  entry,
  divider,
}: {
  sev: WarningSeverity;
  entry: BulletEntry;
  divider: boolean;
}) {
  const tokens = SEVERITY_TOKENS[sev];
  // Render each comma-separated entry as its own pill so a long list still
  // wraps cleanly across the card width.
  const dateChunks = entry.dates
    ? entry.dates.split(",").map((c) => c.trim()).filter(Boolean)
    : [];

  return (
    <Box
      sx={{
        py: 0.45,
        // Hairline divider between rows (drawn via top border on rows 2+ would
        // also work; using bottom border on all but last keeps padding tidy).
        borderBottom: divider ? `1px solid ${alpha(tokens.main, 0.18)}` : "none",
      }}
    >
      {/* Name + inline stats chip on the same wrap-line. */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 0.6,
          rowGap: 0.25,
        }}
      >
        <Typography
          component="span"
          sx={{
            fontSize: "0.74rem",
            fontWeight: 600,
            color: "text.primary",
            lineHeight: 1.3,
            wordBreak: "break-word",
          }}
        >
          {entry.label}
        </Typography>
        {entry.stats && (
          <Typography
            component="span"
            sx={{
              fontSize: "0.66rem",
              fontWeight: 700,
              color: tokens.main,
              bgcolor: alpha(tokens.main, 0.12),
              border: `1px solid ${alpha(tokens.main, 0.3)}`,
              borderRadius: "9px",
              px: 0.7,
              py: "1px",
              lineHeight: 1.25,
              whiteSpace: "nowrap",
              letterSpacing: 0.1,
            }}
          >
            {entry.stats}
          </Typography>
        )}
      </Box>
      {dateChunks.length > 0 && (
        <Box
          sx={{
            mt: 0.3,
            display: "flex",
            flexWrap: "wrap",
            gap: 0.35,
          }}
        >
          {dateChunks.map((d, i) => {
            // "!" suffix = this entry is a violation (e.g. consecutive worked
            // weekend) and should be rendered in red so it's spottable.
            const isViolation = d.endsWith("!");
            const text = isViolation ? d.slice(0, -1) : d;
            const redTokens = SEVERITY_TOKENS.red;
            return (
              <Typography
                key={i}
                component="span"
                sx={{
                  fontSize: "0.66rem",
                  lineHeight: 1.3,
                  color: isViolation ? redTokens.main : "text.secondary",
                  bgcolor: isViolation ? alpha(redTokens.main, 0.12) : "rgba(0,0,0,0.045)",
                  border: isViolation ? `1px solid ${redTokens.border}` : "1px solid transparent",
                  fontWeight: isViolation ? 600 : 400,
                  borderRadius: "6px",
                  px: 0.55,
                  py: "1px",
                  whiteSpace: "nowrap",
                }}
              >
                {text}
              </Typography>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
