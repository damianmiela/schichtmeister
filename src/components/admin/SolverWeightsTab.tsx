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
import GroupsIcon from "@mui/icons-material/Groups";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import { fetchJson } from "@/lib/api/fetchJson";
import {
  DEFAULT_WEIGHTS,
  TIER_LABELS,
  WEIGHT_DEFINITIONS,
  STRATEGY_SPECIFIC_KEYS,
  isStrategySpecific,
  type WeightDef,
  type WeightKey,
  type WeightMap,
  type WeightTier,
  validateWeightsConfig,
  type WeightsConfig,
} from "@/lib/solver/weights";

type LoadResponse = {
  factoryDefaults: typeof DEFAULT_WEIGHTS;
  factoryTemplateA: Record<WeightKey, number>;
  factoryTemplateB: Record<WeightKey, number>;
  strategySpecificKeys: readonly WeightKey[];
  overrides: WeightsConfig;
  updatedAt: string;
};

/** Group definitions by tier (preserves WEIGHT_DEFINITIONS order). */
function groupByTier(
  defs: readonly WeightDef[],
): { tier: WeightTier; items: readonly WeightDef[] }[] {
  const out: { tier: WeightTier; items: WeightDef[] }[] = [];
  for (const d of defs) {
    const last = out[out.length - 1];
    if (last && last.tier === d.tier) last.items.push(d);
    else out.push({ tier: d.tier, items: [d] });
  }
  return out;
}

function fmt(n: number): string {
  return n.toLocaleString("de-DE");
}

/** ────────────────── single-input row used by all 3 zones ────────────────── */
function WeightRow(props: {
  def: WeightDef;
  value: string;
  factoryDefault: number;
  errors: string[];
  onChange: (v: string) => void;
  onReset: () => void;
}) {
  const { def, value, factoryDefault, errors, onChange, onReset } = props;
  const parsed = Number(value);
  const isValid =
    value.trim() !== "" && Number.isFinite(parsed) && Number.isInteger(parsed);
  const isOverride = isValid && parsed !== factoryDefault;
  const hasErr = errors.length > 0 || !isValid;

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr 130px 36px",
        alignItems: "center",
        gap: 1,
        py: 0.75,
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
            color: hasErr ? "error.main" : "text.primary",
            lineHeight: 1.3,
          }}
        >
          {def.label}
          {isOverride ? (
            <Chip
              label="abweichend"
              size="small"
              color="warning"
              sx={{ ml: 1, height: 17, fontSize: "0.62rem" }}
            />
          ) : null}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          <code style={{ fontSize: "0.68rem" }}>{def.key}</code>
          {" · "}Standard: {fmt(factoryDefault)}
          {def.perHourCost !== undefined ? ` · ≈ ${fmt(def.perHourCost)} €/h` : ""}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
          {def.description}
        </Typography>
        {errors.length > 0 ? (
          <Typography variant="caption" color="error.main" sx={{ display: "block", mt: 0.25 }}>
            {errors.join(" · ")}
          </Typography>
        ) : null}
      </Box>
      <TextField
        size="small"
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={hasErr}
        inputProps={{
          min: 0,
          step: 1,
          style: { fontVariantNumeric: "tabular-nums", textAlign: "right" },
        }}
        fullWidth
      />
      <Tooltip title="Auf Standard zurücksetzen">
        <span>
          <IconButton size="small" onClick={onReset} disabled={!isOverride}>
            <RestartAltIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}

export default function SolverWeightsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // Factory defaults pulled from server (matches src/lib/solver/weights.ts).
  const [factoryDefaults, setFactoryDefaults] = useState<typeof DEFAULT_WEIGHTS>(
    DEFAULT_WEIGHTS,
  );
  const [factoryTemplateA, setFactoryTemplateA] = useState<Record<WeightKey, number> | null>(null);
  const [factoryTemplateB, setFactoryTemplateB] = useState<Record<WeightKey, number> | null>(null);

  // Drafts: separate maps for common, templateA, templateB. Each value
  // stored as a string so partial typing doesn't trigger validation chaos.
  const [commonDraft, setCommonDraft] = useState<Record<WeightKey, string>>(
    () =>
      Object.fromEntries(
        Object.entries(DEFAULT_WEIGHTS).map(([k, v]) => [k, String(v)]),
      ) as Record<WeightKey, string>,
  );
  const [templateADraft, setTemplateADraft] = useState<Record<WeightKey, string>>(
    () =>
      Object.fromEntries(
        Object.entries(DEFAULT_WEIGHTS).map(([k, v]) => [k, String(v)]),
      ) as Record<WeightKey, string>,
  );
  const [templateBDraft, setTemplateBDraft] = useState<Record<WeightKey, string>>(
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
      setFactoryDefaults(data.factoryDefaults);
      setFactoryTemplateA(data.factoryTemplateA);
      setFactoryTemplateB(data.factoryTemplateB);

      // Hydrate drafts: factory defaults first, then layer overrides.
      const newCommon: Record<WeightKey, string> = { ...commonDraft };
      const newA: Record<WeightKey, string> = { ...templateADraft };
      const newB: Record<WeightKey, string> = { ...templateBDraft };

      for (const k of Object.keys(data.factoryDefaults) as WeightKey[]) {
        const wk = k;
        // Common: defaults to factoryDefaults; overridden by config.common
        const commonOverride = data.overrides.common?.[wk];
        newCommon[wk] = String(commonOverride ?? data.factoryDefaults[wk]);
        // Templates: defaults to their factory template (only meaningful for
        // strategy-specific keys, but we fill all keys for type symmetry).
        const aOverride = data.overrides.templateA?.[wk];
        const bOverride = data.overrides.templateB?.[wk];
        newA[wk] = String(aOverride ?? data.factoryTemplateA[wk]);
        newB[wk] = String(bOverride ?? data.factoryTemplateB[wk]);
      }
      setCommonDraft(newCommon);
      setTemplateADraft(newA);
      setTemplateBDraft(newB);
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

  // Build the live config from drafts, run validation across both strategies.
  const { config, errors } = useMemo(() => {
    const cfg: WeightsConfig = { common: {}, templateA: {}, templateB: {} };
    const localErrors: string[] = [];

    for (const k of Object.keys(DEFAULT_WEIGHTS) as WeightKey[]) {
      // Strategy-specific keys: read from templateA/B drafts.
      // Common keys: read from commonDraft.
      if (isStrategySpecific(k)) {
        const aRaw = templateADraft[k].trim();
        const bRaw = templateBDraft[k].trim();
        if (aRaw === "") localErrors.push(`Slot leer / ${k}: Wert fehlt.`);
        else {
          const an = Number(aRaw);
          if (!Number.isFinite(an) || !Number.isInteger(an))
            localErrors.push(`Slot leer / ${k}: muss Ganzzahl sein.`);
          else cfg.templateA![k] = an;
        }
        if (bRaw === "") localErrors.push(`Vollabdeckung / ${k}: Wert fehlt.`);
        else {
          const bn = Number(bRaw);
          if (!Number.isFinite(bn) || !Number.isInteger(bn))
            localErrors.push(`Vollabdeckung / ${k}: muss Ganzzahl sein.`);
          else cfg.templateB![k] = bn;
        }
      } else {
        const cRaw = commonDraft[k].trim();
        if (cRaw === "") localErrors.push(`Allgemein / ${k}: Wert fehlt.`);
        else {
          const cn = Number(cRaw);
          if (!Number.isFinite(cn) || !Number.isInteger(cn))
            localErrors.push(`Allgemein / ${k}: muss Ganzzahl sein.`);
          else cfg.common![k] = cn;
        }
      }
    }

    return { config: cfg, errors: [...localErrors, ...validateWeightsConfig(cfg)] };
  }, [commonDraft, templateADraft, templateBDraft]);

  // Per-field error map for inline highlighting. Tag prefixes from
  // validateWeightsConfig: "Vollabdeckung: …" / "Slot leer: …".
  const fieldErrors = useMemo(() => {
    const map = new Map<string, string[]>();
    const push = (zone: "common" | "A" | "B", key: WeightKey, msg: string) => {
      const id = `${zone}:${key}`;
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(msg);
    };
    for (const e of errors) {
      // Heuristic: prefix tells us which zone, then we scan the message
      // body for any W_* key it mentions.
      let zone: "common" | "A" | "B" | null = null;
      let body = e;
      if (body.startsWith("Slot leer:")) {
        zone = "A";
        body = body.slice("Slot leer:".length).trim();
      } else if (body.startsWith("Vollabdeckung:")) {
        zone = "B";
        body = body.slice("Vollabdeckung:".length).trim();
      } else if (body.startsWith("Allgemein /")) {
        zone = "common";
      } else if (body.startsWith("Slot leer /")) {
        zone = "A";
      } else if (body.startsWith("Vollabdeckung /")) {
        zone = "B";
      }
      for (const k of Object.keys(DEFAULT_WEIGHTS) as WeightKey[]) {
        if (body.includes(k)) {
          if (zone) push(zone, k, body);
          else {
            // Untagged → mark in all zones it could apply to
            if (isStrategySpecific(k)) {
              push("A", k, body);
              push("B", k, body);
            } else {
              push("common", k, body);
            }
          }
        }
      }
    }
    return map;
  }, [errors]);

  // Aggregate: how many fields differ from their factory default?
  const overrideCounts = useMemo(() => {
    let c = 0,
      a = 0,
      b = 0;
    if (factoryTemplateA && factoryTemplateB) {
      for (const k of Object.keys(DEFAULT_WEIGHTS) as WeightKey[]) {
        if (isStrategySpecific(k)) {
          const av = Number(templateADraft[k]);
          const bv = Number(templateBDraft[k]);
          if (Number.isFinite(av) && av !== factoryTemplateA[k]) a++;
          if (Number.isFinite(bv) && bv !== factoryTemplateB[k]) b++;
        } else {
          const cv = Number(commonDraft[k]);
          if (Number.isFinite(cv) && cv !== factoryDefaults[k]) c++;
        }
      }
    }
    return { common: c, templateA: a, templateB: b };
  }, [commonDraft, templateADraft, templateBDraft, factoryDefaults, factoryTemplateA, factoryTemplateB]);

  const totalOverrides =
    overrideCounts.common + overrideCounts.templateA + overrideCounts.templateB;

  const handleResetAll = () => {
    if (
      !confirm(
        "Alle Gewichte (Allgemein + beide Templates) auf Standardwerte zurücksetzen? Nicht gespeicherte Änderungen gehen verloren.",
      )
    )
      return;
    if (!factoryTemplateA || !factoryTemplateB) return;
    const newCommon: Record<WeightKey, string> = { ...commonDraft };
    const newA: Record<WeightKey, string> = { ...templateADraft };
    const newB: Record<WeightKey, string> = { ...templateBDraft };
    for (const k of Object.keys(factoryDefaults) as WeightKey[]) {
      newCommon[k] = String(factoryDefaults[k]);
      newA[k] = String(factoryTemplateA[k]);
      newB[k] = String(factoryTemplateB[k]);
    }
    setCommonDraft(newCommon);
    setTemplateADraft(newA);
    setTemplateBDraft(newB);
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
      const resp = await fetchJson<{
        ok: true;
        counts: { common: number; templateA: number; templateB: number };
      }>("/api/admin/solver-weights", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          common: config.common,
          templateA: config.templateA,
          templateB: config.templateB,
        }),
      });
      const total = resp.counts.common + resp.counts.templateA + resp.counts.templateB;
      setSaveSuccess(
        total === 0
          ? "Gespeichert (alle Werte = Standard)."
          : `Gespeichert (${resp.counts.common} allgemein · ${resp.counts.templateA} Slot leer · ${resp.counts.templateB} Vollabdeckung).`,
      );
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

  if (!factoryTemplateA || !factoryTemplateB) {
    return null; // unreachable after load resolves
  }

  // Group all definitions by tier, then split each tier's items into
  // common-row and strategy-row arrays.
  const groups = groupByTier(WEIGHT_DEFINITIONS);

  return (
    <Box>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <ScienceIcon color="primary" />
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
            Solver-Gewichte
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Allgemeine Gewichte + beide Strategie-Templates ("Vollabdeckung" / "Lieber Slot leer"). Der Planer wählt die Strategie pro Generierung.
          </Typography>
        </Box>
        <Chip
          label={
            totalOverrides > 0
              ? `${totalOverrides} Abweichung${totalOverrides === 1 ? "" : "en"}`
              : "Standardwerte aktiv"
          }
          color={totalOverrides > 0 ? "warning" : "success"}
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
      {groups.map(({ tier, items }) => {
        const commonItems = items.filter((d) => !isStrategySpecific(d.key));
        const strategyItems = items.filter((d) => isStrategySpecific(d.key));

        return (
          <Paper key={tier} sx={{ mb: 2, p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              {TIER_LABELS[tier]}
            </Typography>
            <Divider sx={{ mb: 1 }} />

            {/* Common (single-input) rows */}
            {commonItems.length > 0 ? (
              <Box>
                {commonItems.map((def) => (
                  <WeightRow
                    key={`common-${def.key}`}
                    def={def}
                    value={commonDraft[def.key]}
                    factoryDefault={factoryDefaults[def.key]}
                    errors={fieldErrors.get(`common:${def.key}`) ?? []}
                    onChange={(v) =>
                      setCommonDraft((prev) => ({ ...prev, [def.key]: v }))
                    }
                    onReset={() =>
                      setCommonDraft((prev) => ({
                        ...prev,
                        [def.key]: String(factoryDefaults[def.key]),
                      }))
                    }
                  />
                ))}
              </Box>
            ) : null}

            {/* Strategy-specific rows: side-by-side columns */}
            {strategyItems.length > 0 ? (
              <Box sx={{ mt: commonItems.length > 0 ? 2 : 0 }}>
                {commonItems.length > 0 ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", fontWeight: 600, mb: 0.5 }}
                  >
                    Strategie-spezifisch:
                  </Typography>
                ) : null}
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                    gap: 2,
                  }}
                >
                  {/* Column A: Slot leer */}
                  <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: "warning.50", border: 1, borderColor: "warning.200" }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                      <EventBusyIcon fontSize="small" color="warning" />
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Lieber Slot leer lassen
                      </Typography>
                    </Box>
                    {strategyItems.map((def) => (
                      <WeightRow
                        key={`a-${def.key}`}
                        def={def}
                        value={templateADraft[def.key]}
                        factoryDefault={factoryTemplateA[def.key]}
                        errors={fieldErrors.get(`A:${def.key}`) ?? []}
                        onChange={(v) =>
                          setTemplateADraft((prev) => ({ ...prev, [def.key]: v }))
                        }
                        onReset={() =>
                          setTemplateADraft((prev) => ({
                            ...prev,
                            [def.key]: String(factoryTemplateA[def.key]),
                          }))
                        }
                      />
                    ))}
                  </Box>

                  {/* Column B: Vollabdeckung */}
                  <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: "info.50", border: 1, borderColor: "info.200" }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                      <GroupsIcon fontSize="small" color="info" />
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Vollabdeckung anstreben
                      </Typography>
                    </Box>
                    {strategyItems.map((def) => (
                      <WeightRow
                        key={`b-${def.key}`}
                        def={def}
                        value={templateBDraft[def.key]}
                        factoryDefault={factoryTemplateB[def.key]}
                        errors={fieldErrors.get(`B:${def.key}`) ?? []}
                        onChange={(v) =>
                          setTemplateBDraft((prev) => ({ ...prev, [def.key]: v }))
                        }
                        onReset={() =>
                          setTemplateBDraft((prev) => ({
                            ...prev,
                            [def.key]: String(factoryTemplateB[def.key]),
                          }))
                        }
                      />
                    ))}
                  </Box>
                </Box>
              </Box>
            ) : null}
          </Paper>
        );
      })}

      {updatedAt ? (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 2 }}
        >
          Standort zuletzt aktualisiert: {new Date(updatedAt).toLocaleString("de-DE")}
        </Typography>
      ) : null}
    </Box>
  );
}
