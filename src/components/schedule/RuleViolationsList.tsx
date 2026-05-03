"use client";

import { useMemo } from "react";
import {
  Box,
  Typography,
  CircularProgress,
  alpha,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import type { RuleMessage } from "@/lib/planning/types";
import {
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  SEVERITY_TOKENS,
  severityForCode,
  type WarningSeverity,
} from "@/lib/schedule/warningSeverity";

export interface RuleViolationsListProps {
  errors: RuleMessage[];
  warnings: RuleMessage[];
  loading?: boolean;
  /** Compact mode for tight spaces — smaller font, less padding. */
  compact?: boolean;
}

/**
 * Reusable component that displays rule validation results using the same
 * 3-tier severity visuals as the main warnings drawer (red/yellow/green).
 * `errors` and `warnings` are merged and re-classified by their RuleMessage.code,
 * because the engine's hard/soft split doesn't always map to the user-facing
 * severity (e.g. INSUFFICIENT_REST is hard but yellow; OVERSTAFFED is soft but green).
 */
export default function RuleViolationsList({
  errors,
  warnings,
  loading,
  compact,
}: RuleViolationsListProps) {
  const grouped = useMemo(() => {
    const out: Record<WarningSeverity, RuleMessage[]> = { red: [], yellow: [], green: [] };
    for (const m of errors)   out[severityForCode(m.code)].push(m);
    for (const m of warnings) out[severityForCode(m.code)].push(m);
    return out;
  }, [errors, warnings]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 2 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary">
          Regeln werden geprüft…
        </Typography>
      </Box>
    );
  }

  const total = grouped.red.length + grouped.yellow.length + grouped.green.length;

  if (total === 0) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          py: compact ? 1 : 1.5,
          px: compact ? 1 : 1.5,
          bgcolor: (t) => alpha(t.palette.success.main, 0.08),
          borderRadius: 1,
        }}
      >
        <CheckCircleOutlineIcon sx={{ color: "success.main", fontSize: compact ? 18 : 20 }} />
        <Typography variant={compact ? "caption" : "body2"} color="success.dark">
          Keine Regelverletzungen
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: compact ? 0.75 : 1 }}>
      {SEVERITY_ORDER.map((sev) => {
        const items = grouped[sev];
        if (items.length === 0) return null;
        return (
          <SeverityGroup key={sev} severity={sev} items={items} compact={!!compact} />
        );
      })}
    </Box>
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

function severityIcon(s: WarningSeverity, fontSize: number) {
  const sx = { fontSize, color: SEVERITY_TOKENS[s].main };
  if (s === "red") return <ErrorOutlineIcon sx={sx} />;
  if (s === "yellow") return <WarningAmberIcon sx={sx} />;
  return <InfoOutlinedIcon sx={sx} />;
}

function SeverityGroup({
  severity,
  items,
  compact,
}: {
  severity: WarningSeverity;
  items: RuleMessage[];
  compact: boolean;
}) {
  const tokens = SEVERITY_TOKENS[severity];
  const fontSize = compact ? 11.5 : 12.5;
  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          mb: 0.5,
        }}
      >
        {severityIcon(severity, compact ? 14 : 16)}
        <Typography
          variant="caption"
          sx={{ color: tokens.main, fontWeight: 700, fontSize: compact ? 11 : 12 }}
        >
          {SEVERITY_LABEL[severity]} ({items.length})
        </Typography>
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        {items.map((m, i) => (
          <Box
            key={`${m.ruleId}-${i}`}
            sx={{
              display: "flex",
              alignItems: "flex-start",
              gap: 0.75,
              bgcolor: tokens.bg,
              border: `1px solid ${tokens.border}`,
              borderRadius: 1,
              px: 1,
              py: 0.5,
            }}
          >
            <Box sx={{ pt: "1px", flexShrink: 0 }}>
              {severityIcon(severity, compact ? 13 : 14)}
            </Box>
            <Typography
              variant="body2"
              sx={{
                fontSize,
                lineHeight: 1.35,
                color: "text.primary",
                wordBreak: "break-word",
              }}
            >
              {m.message}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
