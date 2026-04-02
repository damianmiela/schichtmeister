"use client";

import {
  Box,
  Typography,
  Alert,
  CircularProgress,
  alpha,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import type { RuleMessage } from "@/lib/planning/types";

export interface RuleViolationsListProps {
  errors: RuleMessage[];
  warnings: RuleMessage[];
  loading?: boolean;
  /** Compact mode for tight spaces — smaller font, less padding. */
  compact?: boolean;
}

/**
 * Reusable component that displays rule validation results.
 * Shows hard errors (red) and soft warnings (amber).
 * Designed to be used across different views in the app.
 */
export default function RuleViolationsList({
  errors,
  warnings,
  loading,
  compact,
}: RuleViolationsListProps) {
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

  const hasViolations = errors.length > 0 || warnings.length > 0;

  if (!hasViolations) {
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

  const py = compact ? 0 : 0.25;
  const fontSize = compact ? 12 : undefined;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      {errors.map((e, i) => (
        <Alert
          key={`err-${e.ruleId}-${i}`}
          severity="error"
          sx={{
            py,
            "& .MuiAlert-message": { fontSize },
          }}
        >
          {e.message}
        </Alert>
      ))}
      {warnings.map((w, i) => (
        <Alert
          key={`warn-${w.ruleId}-${i}`}
          severity="warning"
          sx={{
            py,
            "& .MuiAlert-message": { fontSize },
          }}
        >
          {w.message}
        </Alert>
      ))}
    </Box>
  );
}
