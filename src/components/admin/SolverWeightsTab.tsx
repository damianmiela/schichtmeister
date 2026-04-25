"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SaveIcon from "@mui/icons-material/Save";
import ScienceIcon from "@mui/icons-material/Science";
import { fetchJson } from "@/lib/api/fetchJson";
import {
  DEFAULT_WEIGHTS,
  TIER_LABELS,
  WEIGHT_DEFINITIONS,
  type WeightDef,
  type WeightKey,
  type WeightMap,
  type WeightTier,
  validateWeights,
} from "@/lib/solver/weights";

type LoadResponse = {
  defaults: typeof DEFAULT_WEIGHTS;
  overrides: WeightMap;
  updatedAt: string;
};

/** Group definitions by tier in display order (preserves array order
 * of WEIGHT_DEFINITIONS, which already follows tier order). */
function groupByTier(
  defs: readonly WeightDef[],
): { tier: WeightTier; items: readonly WeightDef[] }[] {
  const out: { tier: WeightTier; items: WeightDef[] }[] = [];
  for (const d of defs) {
    const last = out[out.length - 1];
    if (last && last.tier === d.tier) {
      last.items.push(d);
    } else {
      out.push({ tier: d.tier, items: [d] });
    }
  }
  return out;
}

/** Format a weight value as a German-locale integer with thousand separators. */
function fmt(n: number): string {
  return n.toLocaleString("de-DE");
}

export default function SolverWeightsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // The live form state — string values for each input so partial typing
  // ("12_") doesn't immediately trigger validation chaos.
  const [draft, setDraft] = useState<Record<WeightKey, string>>(
    () =>
      Object.fromEntries(
        Object.entries(DEFAULT_WEIGHTS).map(([k, v]) => [k, String(v)]),
      ) as Record<WeightKey, string>,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const data = await fetchJson<LoadResponse>("/api/admin/solver-weights");
      const next: Record<WeightKey, string> = { ...draft };
      for (const k of Object.keys(DEFAULT_WEIGHTS) as WeightKey[]) {
        const overridden = data.overrides[k];
        next[k] = String(overridden ?? data.defaults[k]);
      }
      setDraft(next);
      setUpdatedAt(data.updatedAt);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Laden fehlgeschlagen");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Parse the draft into numbers, build a WeightMap (only valid integers),
  // run validation against it. Memoized so it re-runs only when draft changes.
  const { parsed, errors } = useMemo(() => {
    const out: WeightMap = {};
    const localErrors: string[] = [];
    for (const k of Object.keys(DEFAULT_WEIGHTS) as WeightKey[]) {
      const raw = draft[k].trim();
      if (raw === "") {
        localErrors.push(`${k}: Wert fehlt.`);
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        localErrors.push(`${k}: Wert muss eine Ganzzahl sein.`);
        continue;
      }
      out[k] = n;
    }
    // Add invariant violations on top
    return { parsed: out, errors: [...localErrors, ...validateWeights(out)] };
  }, [draft]);

  // Per-field error map for highlighting individual rows.
  const fieldErrors = useMemo(() => {
    const map = new Map<WeightKey, string[]>();
    for (const e of errors) {
      // Heuristic: error string starts with "W_FOO:" or contains W_FOO names
      for (const k of Object.keys(DEFAULT_WEIGHTS) as WeightKey[]) {
        if (e.includes(k)) {
          if (!map.has(k)) map.set(k, []);
          map.get(k)!.push(e);
        }
      }
    }
    return map;
  }, [errors]);

  const overriddenCount = useMemo(() => {
    let n = 0;
    for (const k of Object.keys(DEFAULT_WEIGHTS) as WeightKey[]) {
      if (parsed[k] !== undefined && parsed[k] !== DEFAULT_WEIGHTS[k]) n++;
    }
    return n;
  }, [parsed]);

  const handleChange = (k: WeightKey, value: string) => {
    setDraft((prev) => ({ ...prev, [k]: value }));
    setSaveSuccess(null);
  };

  const handleResetField = (k: WeightKey) => {
    setDraft((prev) => ({ ...prev, [k]: String(DEFAULT_WEIGHTS[k]) }));
    setSaveSuccess(null);
  };

  const handleResetAll = () => {
    if (
      !confirm(
        "Alle 38 Gewichte auf Standardwerte zurücksetzen? Nicht gespeicherte Änderungen gehen verloren.",
      )
    )
      return;
    const next: Record<WeightKey, string> = { ...draft };
    for (const k of Object.keys(DEFAULT_WEIGHTS) as WeightKey[]) {
      next[k] = String(DEFAULT_WEIGHTS[k]);
    }
    setDraft(next);
    setSaveSuccess(null);
  };

  const handleSave = async () => {
    if (errors.length > 0) {
      setSaveError("Bitte zuerst die Validierungsfehler beheben.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const resp = await fetchJson<{ ok: true; overrideCount: number }>(
        "/api/admin/solver-weights",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weights: parsed }),
        },
      );
      setSaveSuccess(
        `Gespeichert (${resp.overrideCount} Abweichung${resp.overrideCount === 1 ? "" : "en"} vom Standard).`,
      );
      // Reload to refresh updatedAt
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (loadError) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {loadError}
      </Alert>
    );
  }

  const groups = groupByTier(WEIGHT_DEFINITIONS);

  return (
    <Box>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          mb: 2,
          flexWrap: "wrap",
        }}
      >
        <ScienceIcon color="primary" />
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
            Solver-Gewichte
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Live-Konfiguration der Strafen für Regelverletzungen. Änderungen
            wirken auf alle künftigen Generierungen dieses Standorts.
          </Typography>
        </Box>
        <Chip
          label={
            overriddenCount > 0
              ? `${overriddenCount} Abweichung${overriddenCount === 1 ? "" : "en"} vom Standard`
              : "Standardwerte aktiv"
          }
          color={overriddenCount > 0 ? "warning" : "success"}
          size="small"
        />
        <Tooltip title="Neu laden">
          <IconButton size="small" onClick={() => void load()}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* ── Top action bar ─────────────────────────────────────────── */}
      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
        <Button
          variant="outlined"
          color="warning"
          startIcon={<RestartAltIcon />}
          onClick={handleResetAll}
          disabled={saving}
        >
          Alle zurücksetzen
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={() => void handleSave()}
          disabled={saving || errors.length > 0}
        >
          {saving ? "Speichere…" : "Speichern"}
        </Button>
      </Box>

      {saveError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {saveError}
        </Alert>
      ) : null}
      {saveSuccess ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          {saveSuccess}
        </Alert>
      ) : null}

      {/* ── Validation summary ─────────────────────────────────────── */}
      {errors.length > 0 ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {errors.length} Validierungsfehler — Speichern blockiert:
          </Typography>
          <Box component="ul" sx={{ pl: 2, mt: 0.5, mb: 0 }}>
            {errors.slice(0, 8).map((e, i) => (
              <li key={i}>
                <Typography variant="caption">{e}</Typography>
              </li>
            ))}
            {errors.length > 8 ? (
              <li>
                <Typography variant="caption" color="text.secondary">
                  … und {errors.length - 8} weitere.
                </Typography>
              </li>
            ) : null}
          </Box>
        </Alert>
      ) : null}

      {/* ── Tier groups ────────────────────────────────────────────── */}
      {groups.map(({ tier, items }) => (
        <Paper key={tier} sx={{ mb: 2, p: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            {TIER_LABELS[tier]}
          </Typography>
          <Divider sx={{ mb: 1 }} />
          {items.map((def) => {
            const fErr = fieldErrors.get(def.key);
            const isOverride =
              parsed[def.key] !== undefined &&
              parsed[def.key] !== DEFAULT_WEIGHTS[def.key];
            return (
              <Box
                key={def.key}
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "1fr 160px 40px" },
                  alignItems: "center",
                  gap: 1.5,
                  py: 1,
                  borderBottom: 1,
                  borderColor: "divider",
                  "&:last-child": { borderBottom: 0 },
                }}
              >
                <Box>
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: isOverride ? 600 : 400,
                      color: fErr ? "error.main" : "text.primary",
                    }}
                  >
                    {def.label}
                    {isOverride ? (
                      <Chip
                        label="abweichend"
                        size="small"
                        color="warning"
                        sx={{ ml: 1, height: 18, fontSize: "0.65rem" }}
                      />
                    ) : null}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block" }}
                  >
                    <code style={{ fontSize: "0.7rem" }}>{def.key}</code>
                    {" · "}Standard: {fmt(DEFAULT_WEIGHTS[def.key])}
                    {def.perHourCost !== undefined
                      ? ` · ≈ ${fmt(def.perHourCost)} pro Stunde`
                      : ""}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 0.25 }}
                  >
                    {def.description}
                  </Typography>
                  {fErr ? (
                    <Typography
                      variant="caption"
                      color="error.main"
                      sx={{ display: "block", mt: 0.25 }}
                    >
                      {fErr.join(" · ")}
                    </Typography>
                  ) : null}
                </Box>
                <TextField
                  size="small"
                  type="number"
                  value={draft[def.key]}
                  onChange={(e) => handleChange(def.key, e.target.value)}
                  error={!!fErr}
                  inputProps={{
                    min: 0,
                    step: 1,
                    style: { fontVariantNumeric: "tabular-nums", textAlign: "right" },
                  }}
                  fullWidth
                />
                <Tooltip title="Auf Standard zurücksetzen">
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => handleResetField(def.key)}
                      disabled={!isOverride}
                    >
                      <RestartAltIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            );
          })}
        </Paper>
      ))}

      {updatedAt ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
          Standort zuletzt aktualisiert: {new Date(updatedAt).toLocaleString("de-DE")}
        </Typography>
      ) : null}
    </Box>
  );
}
