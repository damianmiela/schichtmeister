"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MainLayout from "@/components/layout/MainLayout";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";
import {
  Alert,
  alpha,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import SchoolIcon from "@mui/icons-material/School";
import PeopleIcon from "@mui/icons-material/People";
import TuneIcon from "@mui/icons-material/Tune";
import {
  generateColorFromAbbreviation,
  contrastTextColor,
} from "@/lib/qualificationColor";
import SaveIcon from "@mui/icons-material/Save";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import GridOnIcon from "@mui/icons-material/GridOn";
import WbSunnyIcon from "@mui/icons-material/WbSunny";
import WbTwilightIcon from "@mui/icons-material/WbTwilight";
import NightsStayIcon from "@mui/icons-material/NightsStay";
import WorkIcon from "@mui/icons-material/Work";

/* ──────────────── types ──────────────── */

type QualificationCatalog = {
  id: string;
  name: string;
  abbreviation: string;
  color: string;
  isActive: boolean;
  sortOrder: number;
};

type QualificationRow = {
  id: string;
  qualificationTag: string;
  minCount: number;
  maxCount: number | null;
};

type StaffingRow = {
  id: string;
  shiftType: string;
  stationNumber: number;
  minTotalCount: number;
  maxTotalCount: number | null;
  isFacilityWide: boolean;
  qualificationRequirements: QualificationRow[];
};

type RuleEntry = {
  id: string;
  description: string;
  severity: string;
  scope: string;
  enabled: boolean;
  params: Record<string, unknown>;
};

type FacilityRulesResponse = {
  minRestHours: number;
  miniJobMaxMonthlyHours: number;
  maxSolveTimeSeconds: number;
  rules: RuleEntry[];
};

/* ──────────────── constants ──────────────── */

const SHIFT_TYPES = ["EARLY", "LATE", "NIGHT", "BL"] as const;
type ShiftTypeValue = (typeof SHIFT_TYPES)[number];

const STATIONS = [1, 2, 3] as const;
const STATION_SHIFT_TYPES: ShiftTypeValue[] = ["EARLY", "LATE"];

const SHIFT_ICON: Record<string, React.ReactNode> = {
  EARLY: <WbSunnyIcon fontSize="small" sx={{ color: "warning.main" }} />,
  LATE: <WbTwilightIcon fontSize="small" sx={{ color: "info.main" }} />,
  NIGHT: <NightsStayIcon fontSize="small" sx={{ color: "secondary.main" }} />,
  BL: <WorkIcon fontSize="small" sx={{ color: "success.main" }} />,
};

const HIDDEN_RULES = new Set([
  "noOverlap",
  "miniJobMonthlyHours",
  "staffingMinimum",
  "qualificationCoverage",
  "wishFulfillment",
  "fairnessCounters",
  "targetHoursBalance",
  "alternatingWeekends",
  "blWeekendHoliday",
]);

const RULE_LABELS: Record<string, string> = {
  minRestBetweenShifts: "Mindestruhezeit zwischen Schichten",
  maxConsecutiveNights: "Max. aufeinanderfolgende Nachtschichten",
  maxConsecutiveDays: "Max. aufeinanderfolgende Arbeitstage",
  restAfter6Days: "Ruhetage nach 6+ Arbeitstagen",
  wblWeekendLimit: "WBL max. Wochenendtage pro Monat",
  sollDelta: "Soll-Stunden Abweichungsbereich",
};

const PARAM_LABELS: Record<string, string> = {
  maxCount: "Maximale Nächte",
  maxDays: "Maximale Tage",
  requiredRestDays: "Erforderliche Ruhetage danach",
  maxWeekendDays: "Max. Wochenendtage",
  minDelta: "Min. Abweichung (Stunden)",
  maxDelta: "Max. Abweichung (Stunden)",
};

function extractApiError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    const b = e.body;
    if (
      b &&
      typeof b === "object" &&
      b !== null &&
      "error" in b &&
      typeof (b as { error: unknown }).error === "string"
    ) {
      return (b as { error: string }).error;
    }
    return fallback;
  }
  return "Netzwerkfehler";
}

/* ──────────────── page ──────────────── */

export default function SettingsPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState(0);

  // ── Qualification catalog state ──
  const [qualifications, setQualifications] = useState<QualificationCatalog[]>(
    [],
  );
  const [qualLoading, setQualLoading] = useState(true);
  const [qualError, setQualError] = useState<string | null>(null);
  const [qualDialogOpen, setQualDialogOpen] = useState(false);
  const [qualEditId, setQualEditId] = useState<string | null>(null);
  const [qualForm, setQualForm] = useState({
    name: "",
    abbreviation: "",
    color: "#546e7a",
    sortOrder: "0",
    isActive: true,
  });
  const [qualSaving, setQualSaving] = useState(false);
  const [qualFormError, setQualFormError] = useState<string | null>(null);
  const [qualDeleteId, setQualDeleteId] = useState<string | null>(null);
  const [qualDeleteBusy, setQualDeleteBusy] = useState(false);
  const [qualDeleteError, setQualDeleteError] = useState<string | null>(null);

  // ── Staffing state ──
  const [staffing, setStaffing] = useState<StaffingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftMin, setDraftMin] = useState<Record<string, string>>({});
  const [draftMax, setDraftMax] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [newShift, setNewShift] = useState<ShiftTypeValue>("EARLY");
  const [newStation, setNewStation] = useState(1);
  const [newMin, setNewMin] = useState("1");
  const [newMax, setNewMax] = useState("");
  const [newFacilityWide, setNewFacilityWide] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // ── Qualification sub-row add state ──
  const [addQualSrId, setAddQualSrId] = useState<string | null>(null);
  const [newQualSelection, setNewQualSelection] =
    useState<QualificationCatalog[]>([]);
  const [newQualMin, setNewQualMin] = useState("1");
  const [newQualMax, setNewQualMax] = useState("");
  const [addQualBusy, setAddQualBusy] = useState(false);
  const [addQualError, setAddQualError] = useState<string | null>(null);

  // ── Planning rules state ──
  const [rulesData, setRulesData] = useState<FacilityRulesResponse | null>(
    null,
  );
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesDraft, setRulesDraft] = useState<
    Record<string, { enabled: boolean; params: Record<string, string> }>
  >({});
  const [minRestHoursDraft, setMinRestHoursDraft] = useState("");
  const [maxSolveTimeDraft, setMaxSolveTimeDraft] = useState("120");
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesSuccess, setRulesSuccess] = useState(false);

  // ── Derived ──

  const activeQualifications = useMemo(
    () =>
      qualifications
        .filter((q) => q.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [qualifications],
  );

  const qualNameByAbbr = useMemo(() => {
    const m = new Map<string, string>();
    for (const q of qualifications) m.set(q.abbreviation, q.name);
    return m;
  }, [qualifications]);

  /* ════════════════ loaders ════════════════ */

  const loadQualifications = useCallback(async () => {
    setQualLoading(true);
    setQualError(null);
    try {
      const res = await fetchJson<{ qualifications: QualificationCatalog[] }>(
        "/api/qualifications",
      );
      setQualifications(
        (res.qualifications ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
      );
    } catch (e) {
      setQualError(
        extractApiError(e, "Qualifikationen konnten nicht geladen werden."),
      );
    } finally {
      setQualLoading(false);
    }
  }, []);

  const loadStaffing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson<{ staffingRequirements: StaffingRow[] }>(
        "/api/staffing-requirements",
      );
      setStaffing(res.staffingRequirements);
      const dm: Record<string, string> = {};
      const dx: Record<string, string> = {};
      for (const r of res.staffingRequirements) {
        dm[r.id] = String(r.minTotalCount);
        dx[r.id] = r.maxTotalCount != null ? String(r.maxTotalCount) : "";
      }
      setDraftMin(dm);
      setDraftMax(dx);
    } catch (e) {
      setError(extractApiError(e, "Laden fehlgeschlagen."));
      setStaffing([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      const data =
        await fetchJson<FacilityRulesResponse>("/api/facility/rules");
      setRulesData(data);
      setMinRestHoursDraft(String(data.minRestHours));
      setMaxSolveTimeDraft(String(data.maxSolveTimeSeconds ?? 120));
      const d: Record<
        string,
        { enabled: boolean; params: Record<string, string> }
      > = {};
      for (const r of data.rules) {
        const params: Record<string, string> = {};
        for (const [k, v] of Object.entries(r.params)) {
          params[k] = String(v ?? "");
        }
        d[r.id] = { enabled: r.enabled, params };
      }
      setRulesDraft(d);
    } catch {
      setRulesData(null);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQualifications();
    void loadStaffing();
    void loadRules();
  }, [loadQualifications, loadStaffing, loadRules]);

  /* ════════════════ qualification actions ════════════════ */

  const openQualDialog = (qual?: QualificationCatalog) => {
    if (qual) {
      setQualEditId(qual.id);
      setQualForm({
        name: qual.name,
        abbreviation: qual.abbreviation,
        color: qual.color,
        sortOrder: String(qual.sortOrder),
        isActive: qual.isActive,
      });
    } else {
      setQualEditId(null);
      const maxSort = qualifications.reduce(
        (max, q) => Math.max(max, q.sortOrder),
        0,
      );
      setQualForm({
        name: "",
        abbreviation: "",
        color: "#546e7a",
        sortOrder: String(maxSort + 1),
        isActive: true,
      });
    }
    setQualFormError(null);
    setQualDialogOpen(true);
  };

  const saveQualification = async () => {
    if (!qualForm.name.trim() || !qualForm.abbreviation.trim()) {
      setQualFormError("Name und Abkürzung sind erforderlich.");
      return;
    }
    setQualSaving(true);
    setQualFormError(null);
    try {
      const body = {
        name: qualForm.name.trim(),
        abbreviation: qualForm.abbreviation.trim(),
        color: qualForm.color,
        sortOrder: Number(qualForm.sortOrder) || 0,
        isActive: qualForm.isActive,
      };
      if (qualEditId) {
        await fetchJson(`/api/qualifications/${qualEditId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await fetchJson("/api/qualifications", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      setQualDialogOpen(false);
      await loadQualifications();
    } catch (e) {
      setQualFormError(extractApiError(e, "Speichern fehlgeschlagen."));
    } finally {
      setQualSaving(false);
    }
  };

  const confirmDeleteQual = async () => {
    if (!qualDeleteId) return;
    setQualDeleteBusy(true);
    setQualDeleteError(null);
    try {
      await fetchJson(`/api/qualifications/${qualDeleteId}`, {
        method: "DELETE",
      });
      setQualDeleteId(null);
      await loadQualifications();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setQualDeleteError(
          "Qualifikation wird noch von Mitarbeitern verwendet und kann nicht gelöscht werden.",
        );
      } else {
        setQualDeleteError(extractApiError(e, "Löschen fehlgeschlagen."));
      }
    } finally {
      setQualDeleteBusy(false);
    }
  };

  /* ════════════════ staffing computed ════════════════ */

  const stationRowMap = useMemo(() => {
    const map = new Map<number, Map<string, StaffingRow>>();
    for (const st of STATIONS) map.set(st, new Map());
    for (const r of staffing) {
      if (!r.isFacilityWide && r.stationNumber >= 1 && r.stationNumber <= 3) {
        map.get(r.stationNumber)?.set(r.shiftType, r);
      }
    }
    return map;
  }, [staffing]);

  const facilityWideRows = useMemo(
    () => staffing.filter((r) => r.isFacilityWide),
    [staffing],
  );

  const missingDefaults = useMemo(() => {
    const have = new Set(
      staffing.map((r) =>
        r.isFacilityWide
          ? `FW:${r.shiftType}`
          : `${r.shiftType}:${r.stationNumber}`,
      ),
    );
    const missing: {
      shiftType: ShiftTypeValue;
      stationNumber: number;
      isFacilityWide: boolean;
    }[] = [];
    for (const st of STATIONS) {
      for (const shift of STATION_SHIFT_TYPES) {
        if (!have.has(`${shift}:${st}`))
          missing.push({
            shiftType: shift,
            stationNumber: st,
            isFacilityWide: false,
          });
      }
    }
    if (!have.has("FW:NIGHT")) {
      missing.push({
        shiftType: "NIGHT",
        stationNumber: 0,
        isFacilityWide: true,
      });
    }
    return missing;
  }, [staffing]);

  /* ════════════════ staffing actions ════════════════ */

  const saveRow = async (id: string) => {
    const rawMin = draftMin[id];
    const rawMax = draftMax[id];
    const minVal = Number(rawMin);
    if (!Number.isFinite(minVal) || minVal < 0) {
      setError("Mindestanzahl: gültige Zahl >= 0.");
      return;
    }
    const maxVal = rawMax?.trim() ? Number(rawMax) : null;
    if (maxVal !== null && (!Number.isFinite(maxVal) || maxVal < 0)) {
      setError("Maximalanzahl: gültige Zahl >= 0 oder leer lassen.");
      return;
    }
    if (maxVal !== null && maxVal < minVal) {
      setError("Maximalanzahl darf nicht kleiner als Mindestanzahl sein.");
      return;
    }
    setSavingId(id);
    setError(null);
    try {
      await fetchJson(`/api/staffing-requirements/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          minTotalCount: Math.floor(minVal),
          maxTotalCount: maxVal !== null ? Math.floor(maxVal) : null,
        }),
      });
      await loadStaffing();
    } catch (e) {
      setError(extractApiError(e, "Speichern fehlgeschlagen."));
    } finally {
      setSavingId(null);
    }
  };

  const applyAllShiftsTemplate = async () => {
    setTemplateBusy(true);
    setError(null);
    try {
      for (const m of missingDefaults) {
        await fetchJson("/api/staffing-requirements", {
          method: "POST",
          body: JSON.stringify({
            shiftType: m.shiftType,
            stationNumber: m.stationNumber,
            minTotalCount: 1,
            isFacilityWide: m.isFacilityWide,
          }),
        });
      }
      await loadStaffing();
    } catch (e) {
      setError(extractApiError(e, "Anlegen fehlgeschlagen."));
    } finally {
      setTemplateBusy(false);
    }
  };

  const openAddDialog = () => {
    setAddFormError(null);
    setNewShift("EARLY");
    setNewStation(1);
    setNewMin("1");
    setNewMax("");
    setNewFacilityWide(false);
    setAddOpen(true);
  };

  const submitAdd = async () => {
    const minVal = Number(newMin.replace(",", "."));
    if (!Number.isFinite(minVal) || minVal < 0) {
      setAddFormError("Minimum: gültige Zahl >= 0.");
      return;
    }
    const maxVal = newMax.trim()
      ? Number(newMax.replace(",", "."))
      : null;
    if (maxVal !== null && (!Number.isFinite(maxVal) || maxVal < 0)) {
      setAddFormError("Maximum: gültige Zahl >= 0 oder leer lassen.");
      return;
    }
    setAddBusy(true);
    setAddFormError(null);
    setError(null);
    try {
      await fetchJson("/api/staffing-requirements", {
        method: "POST",
        body: JSON.stringify({
          shiftType: newShift,
          stationNumber: newFacilityWide ? 0 : newStation,
          minTotalCount: Math.floor(minVal),
          maxTotalCount: maxVal !== null ? Math.floor(maxVal) : null,
          isFacilityWide: newFacilityWide,
        }),
      });
      setAddOpen(false);
      await loadStaffing();
    } catch (e) {
      setAddFormError(extractApiError(e, "Anlegen fehlgeschlagen."));
    } finally {
      setAddBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/staffing-requirements/${deleteId}`, {
        method: "DELETE",
      });
      setDeleteId(null);
      await loadStaffing();
    } catch (e) {
      setError(extractApiError(e, "Löschen fehlgeschlagen."));
    } finally {
      setDeleteBusy(false);
    }
  };

  /* ════════════════ qualification sub-row actions ════════════════ */

  const addQualification = async () => {
    if (!addQualSrId || newQualSelection.length === 0) return;
    const minVal = Number(newQualMin);
    if (!Number.isFinite(minVal) || minVal < 1) {
      setAddQualError("Mindestens 1.");
      return;
    }
    const maxRaw = newQualMax.trim();
    const maxVal = maxRaw === "" ? null : Number(maxRaw);
    if (maxVal !== null && (!Number.isFinite(maxVal) || maxVal < 1)) {
      setAddQualError("Max muss ≥ 1 sein oder leer.");
      return;
    }
    if (maxVal !== null && maxVal < minVal) {
      setAddQualError("Max darf nicht kleiner als Min sein.");
      return;
    }
    setAddQualBusy(true);
    setAddQualError(null);
    try {
      const qualificationTag = newQualSelection.map((q) => q.abbreviation).join(",");
      await fetchJson(
        `/api/staffing-requirements/${addQualSrId}/qualifications`,
        {
          method: "POST",
          body: JSON.stringify({
            qualificationTag,
            minCount: Math.floor(minVal),
            maxCount: maxVal !== null ? Math.floor(maxVal) : null,
          }),
        },
      );
      setAddQualSrId(null);
      setNewQualSelection([]);
      setNewQualMin("1");
      setNewQualMax("");
      await loadStaffing();
    } catch (e) {
      setAddQualError(extractApiError(e, "Anlegen fehlgeschlagen."));
    } finally {
      setAddQualBusy(false);
    }
  };

  const deleteQualification = async (srId: string, qId: string) => {
    setError(null);
    try {
      await fetchJson(
        `/api/staffing-requirements/${srId}/qualifications/${qId}`,
        { method: "DELETE" },
      );
      await loadStaffing();
    } catch (e) {
      setError(extractApiError(e, "Löschen fehlgeschlagen."));
    }
  };

  const updateQualMinCount = async (
    srId: string,
    qId: string,
    minCount: number,
  ) => {
    if (minCount < 1) return;
    setError(null);
    try {
      await fetchJson(
        `/api/staffing-requirements/${srId}/qualifications/${qId}`,
        { method: "PATCH", body: JSON.stringify({ minCount }) },
      );
      await loadStaffing();
    } catch (e) {
      setError(extractApiError(e, "Speichern fehlgeschlagen."));
    }
  };

  const updateQualMaxCount = async (
    srId: string,
    qId: string,
    maxCount: number | null,
  ) => {
    if (maxCount !== null && maxCount < 1) return;
    setError(null);
    try {
      await fetchJson(
        `/api/staffing-requirements/${srId}/qualifications/${qId}`,
        { method: "PATCH", body: JSON.stringify({ maxCount }) },
      );
      await loadStaffing();
    } catch (e) {
      setError(extractApiError(e, "Speichern fehlgeschlagen."));
    }
  };

  /* ════════════════ rules actions ════════════════ */

  const saveRules = async () => {
    setRulesSaving(true);
    setRulesError(null);
    setRulesSuccess(false);
    try {
      const overrides: Record<
        string,
        { enabled?: boolean; params?: Record<string, unknown> }
      > = {};
      for (const [ruleId, d] of Object.entries(rulesDraft)) {
        const original = rulesData?.rules.find((r) => r.id === ruleId);
        if (!original) continue;
        const params: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(d.params)) {
          const num = Number(v);
          params[k] = Number.isFinite(num) ? num : v;
        }
        overrides[ruleId] = { enabled: d.enabled, params };
      }

      const minRestVal = Number(minRestHoursDraft);
      const maxSolveVal = Number(maxSolveTimeDraft);
      await fetchJson("/api/facility/rules", {
        method: "PATCH",
        body: JSON.stringify({
          ruleOverrides: overrides,
          ...(Number.isFinite(minRestVal) && minRestVal >= 0
            ? { minRestHours: minRestVal }
            : {}),
          ...(Number.isFinite(maxSolveVal) && maxSolveVal >= 5
            ? { maxSolveTimeSeconds: maxSolveVal }
            : {}),
        }),
      });
      setRulesSuccess(true);
      await loadRules();
    } catch (e) {
      setRulesError(extractApiError(e, "Speichern fehlgeschlagen."));
    } finally {
      setRulesSaving(false);
    }
  };

  const visibleRules = useMemo(
    () => (rulesData?.rules ?? []).filter((r) => !HIDDEN_RULES.has(r.id)),
    [rulesData],
  );

  /* ════════════════ render helpers ════════════════ */

  const renderShiftRow = (row: StaffingRow) => (
    <Box
      key={row.id}
      sx={{
        py: 1.5,
        px: 2,
        borderBottom: "1px solid",
        borderColor: "divider",
        "&:last-child": { borderBottom: "none" },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flexDirection: { xs: "column", sm: "row" } }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, width: { xs: "100%", sm: "auto" } }}>
          {SHIFT_ICON[row.shiftType]}
          <Typography variant="body2" fontWeight={600} sx={{ minWidth: 56 }}>
            {shiftTypeLabel(row.shiftType)}
          </Typography>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: { xs: "100%", sm: "auto" } }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ ml: 0.5 }}
          >
            Min:
          </Typography>
          <TextField
            size="small"
            type="number"
            value={draftMin[row.id] ?? ""}
            onChange={(ev) =>
              setDraftMin((prev) => ({ ...prev, [row.id]: ev.target.value }))
            }
            inputProps={{ min: 0, style: { textAlign: "center" } }}
            sx={{ width: 64 }}
          />

          <Typography variant="caption" color="text.secondary">
            Max:
          </Typography>
          <Tooltip title="Leer lassen für unbegrenzt" arrow>
            <TextField
              size="small"
              type="number"
              value={draftMax[row.id] ?? ""}
              onChange={(ev) =>
                setDraftMax((prev) => ({ ...prev, [row.id]: ev.target.value }))
              }
              inputProps={{ min: 0, style: { textAlign: "center" } }}
              placeholder="–"
              sx={{ width: 64 }}
            />
          </Tooltip>
        </Box>

        <Box sx={{ flex: 1, display: { xs: "none", sm: "block" } }} />

        <Box sx={{ display: "flex", gap: 0.5, width: { xs: "100%", sm: "auto" } }}>
          <Button
            size="small"
            variant="text"
            disabled={savingId === row.id}
            onClick={() => void saveRow(row.id)}
            sx={{ minWidth: 0, px: 1, flex: { xs: 1, sm: 0 } }}
          >
            {savingId === row.id ? (
              <CircularProgress size={16} />
            ) : (
              <SaveIcon fontSize="small" />
            )}
          </Button>

          <IconButton
            size="small"
            color="error"
            onClick={() => setDeleteId(row.id)}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      <Box
        sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 1, ml: 4.5 }}
      >
        {row.qualificationRequirements.map((q) => {
          const tagParts = q.qualificationTag.split(",").map((t) => t.trim());
          const tagDisplay = tagParts.join(" / ");
          const tooltipText = tagParts
            .map((t) => qualNameByAbbr.get(t))
            .filter(Boolean)
            .join(", ");
          return (
          <Tooltip
            key={q.id}
            title={tooltipText}
            arrow
            disableHoverListener={!tooltipText}
          >
            <Chip
              label={
                <Box
                  sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                >
                  <span>{tagDisplay}</span>
                  <span style={{ fontSize: 11, color: "#666" }}>Min</span>
                  <TextField
                    size="small"
                    type="number"
                    defaultValue={q.minCount}
                    inputProps={{
                      min: 1,
                      style: {
                        width: 28,
                        padding: "1px 2px",
                        textAlign: "center",
                        fontSize: 12,
                      },
                    }}
                    variant="standard"
                    sx={{
                      "& .MuiInput-underline:before": {
                        borderBottom: "none",
                      },
                    }}
                    onBlur={(e) => {
                      const val = Number(e.target.value);
                      if (val !== q.minCount && val >= 1) {
                        void updateQualMinCount(row.id, q.id, val);
                      }
                    }}
                  />
                  <span style={{ fontSize: 11, color: "#666" }}>Max</span>
                  <TextField
                    size="small"
                    type="number"
                    defaultValue={q.maxCount ?? ""}
                    placeholder="–"
                    inputProps={{
                      min: 1,
                      style: {
                        width: 28,
                        padding: "1px 2px",
                        textAlign: "center",
                        fontSize: 12,
                      },
                    }}
                    variant="standard"
                    sx={{
                      "& .MuiInput-underline:before": {
                        borderBottom: "none",
                      },
                    }}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const val = raw === "" ? null : Number(raw);
                      if (val !== q.maxCount && (val === null || val >= 1)) {
                        void updateQualMaxCount(row.id, q.id, val);
                      }
                    }}
                  />
                </Box>
              }
              size="small"
              variant="outlined"
              onDelete={() => void deleteQualification(row.id, q.id)}
              sx={{ height: 28 }}
            />
          </Tooltip>
        ); })}
        <Chip
          icon={<AddIcon sx={{ fontSize: 16 }} />}
          label="Qualifikation"
          size="small"
          variant="outlined"
          onClick={() => {
            setAddQualSrId(row.id);
            setNewQualSelection([]);
            setNewQualMin("1");
            setAddQualError(null);
          }}
          sx={{
            height: 28,
            borderStyle: "dashed",
            cursor: "pointer",
            "&:hover": { borderStyle: "solid" },
          }}
        />
      </Box>
    </Box>
  );

  const renderEmptyShiftRow = (shiftType: string) => (
    <Box
      key={shiftType}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        py: 1.5,
        px: 2,
        borderBottom: "1px solid",
        borderColor: "divider",
        opacity: 0.5,
      }}
    >
      {SHIFT_ICON[shiftType]}
      <Typography variant="body2" sx={{ minWidth: 56 }}>
        {shiftTypeLabel(shiftType)}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Nicht konfiguriert
      </Typography>
    </Box>
  );

  const renderStationCard = (station: number) => {
    const shiftMap = stationRowMap.get(station);
    const rows: StaffingRow[] = [];
    for (const st of STATION_SHIFT_TYPES) {
      const r = shiftMap?.get(st);
      if (r) rows.push(r);
    }
    const extra = [...(shiftMap?.entries() ?? [])]
      .filter(
        ([st]) =>
          !STATION_SHIFT_TYPES.includes(st as ShiftTypeValue) &&
          st !== "NIGHT",
      )
      .map(([, r]) => r);

    const allRows = [...rows, ...extra];
    const totalMin = allRows.reduce((s, r) => s + r.minTotalCount, 0);

    return (
      <Grid key={station} size={{ xs: 12, sm: 6, md: 4 }}>
        <Card
          variant="outlined"
          sx={{ borderColor: alpha(theme.palette.primary.main, 0.3) }}
        >
          <Box
            sx={{
              px: 2,
              py: 1.5,
              bgcolor: alpha(theme.palette.primary.main, 0.06),
              borderBottom: "1px solid",
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Typography variant="subtitle1" fontWeight={700}>
              Station {station}
            </Typography>
            <Chip
              label={`${totalMin} MA / Tag`}
              size="small"
              color="primary"
              variant="outlined"
              sx={{ fontWeight: 600 }}
            />
          </Box>
          {STATION_SHIFT_TYPES.map((st) => {
            const row = shiftMap?.get(st);
            return row ? renderShiftRow(row) : renderEmptyShiftRow(st);
          })}
          {extra.map((r) => renderShiftRow(r))}
        </Card>
      </Grid>
    );
  };

  /* ════════════════ JSX ════════════════ */

  return (
    <MainLayout title="Einstellungen">
      {/* ──── Tab Navigation ──── */}
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          variant={isMobile ? "fullWidth" : "standard"}
          sx={{
            "& .MuiTab-root": {
              textTransform: "none",
              fontWeight: 600,
              fontSize: { xs: "0.8rem", sm: "0.9rem" },
              minHeight: 48,
            },
          }}
        >
          <Tab icon={<SchoolIcon />} iconPosition="start" label="Qualifikationen" />
          <Tab icon={<PeopleIcon />} iconPosition="start" label="Mindestbesetzung" />
          <Tab icon={<TuneIcon />} iconPosition="start" label="Planungsregeln" />
        </Tabs>
      </Box>

      {/* ──── Tab 0: Qualifikationen ──── */}
      {activeTab === 0 && (
        <Card>
          <CardContent>
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                mb: 1,
                flexDirection: { xs: "column", sm: "row" },
                gap: { xs: 1, sm: 0 },
                alignItems: { xs: "flex-start", sm: "center" },
              }}
            >
              <Typography variant="h6">Qualifikationen</Typography>
              <Button
                size="small"
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => openQualDialog()}
                sx={{ width: { xs: "100%", sm: "auto" } }}
              >
                Neue Qualifikation
              </Button>
            </Box>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mb: 2 }}
            >
              Verwalten Sie die im System verfügbaren Qualifikationen.
              Diese werden für Mitarbeiterprofile und
              Personalbedarfsanforderungen verwendet.
            </Typography>
            <Divider sx={{ mb: 2 }} />

              {qualError && (
                <Alert
                  severity="error"
                  sx={{ mb: 2 }}
                  onClose={() => setQualError(null)}
                >
                  {qualError}
                </Alert>
              )}

              {qualLoading ? (
                <Box
                  sx={{ display: "flex", justifyContent: "center", py: 4 }}
                >
                  <CircularProgress />
                </Box>
              ) : qualifications.length === 0 ? (
                <Alert severity="info">
                  Noch keine Qualifikationen angelegt.
                </Alert>
              ) : (
                <TableContainer sx={{ overflowX: "auto" }}>
                  <Table size="small" sx={{ minWidth: 360 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>
                          Abkürzung
                        </TableCell>
                        <TableCell sx={{ fontWeight: 700 }} align="center">
                          Aktiv
                        </TableCell>
                        <TableCell sx={{ fontWeight: 700 }} align="center">
                          Sortierung
                        </TableCell>
                        <TableCell sx={{ fontWeight: 700 }} align="right">
                          Aktionen
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {qualifications.map((q) => (
                        <TableRow key={q.id} hover>
                          <TableCell>{q.name}</TableCell>
                          <TableCell>
                            <Box
                              sx={{
                                display: "inline-flex",
                                alignItems: "center",
                                px: 1,
                                py: 0.25,
                                borderRadius: 2,
                                bgcolor: q.color,
                                color: contrastTextColor(q.color),
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              {q.abbreviation}
                            </Box>
                          </TableCell>
                          <TableCell align="center">
                            <Chip
                              label={q.isActive ? "Ja" : "Nein"}
                              size="small"
                              color={q.isActive ? "success" : "default"}
                              variant={q.isActive ? "filled" : "outlined"}
                              sx={{ minWidth: 44 }}
                            />
                          </TableCell>
                          <TableCell align="center">
                            {q.sortOrder}
                          </TableCell>
                          <TableCell align="right">
                            <Tooltip title="Bearbeiten" arrow>
                              <IconButton
                                size="small"
                                onClick={() => openQualDialog(q)}
                              >
                                <EditIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Löschen" arrow>
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => {
                                  setQualDeleteError(null);
                                  setQualDeleteId(q.id);
                                }}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
          </CardContent>
        </Card>
      )}

      {/* ──── Tab 1: Mindestbesetzung ──── */}
      {activeTab === 1 && (
        <Card>
          <CardContent>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  mb: 1,
                  flexDirection: { xs: "column", sm: "row" },
                  gap: { xs: 1, sm: 0 },
                  alignItems: { xs: "flex-start", sm: "center" },
                }}
              >
                <Typography variant="h6" sx={{ width: { xs: "100%", sm: "auto" } }}>
                  Mindestbesetzung (Personalbedarf)
                </Typography>
                <Box sx={{ display: "flex", gap: 1, width: { xs: "100%", sm: "auto" }, flexDirection: { xs: "column", sm: "row" } }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    disabled={loading}
                    onClick={openAddDialog}
                    sx={{ width: { xs: "100%", sm: "auto" } }}
                  >
                    Einzeln hinzufügen
                  </Button>
                  {missingDefaults.length > 0 && (
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={
                        templateBusy ? (
                          <CircularProgress size={16} color="inherit" />
                        ) : (
                          <GridOnIcon />
                        )
                      }
                      disabled={templateBusy || loading}
                      onClick={() => void applyAllShiftsTemplate()}
                      sx={{ width: { xs: "100%", sm: "auto" } }}
                    >
                      Fehlende anlegen
                    </Button>
                  )}
                </Box>
              </Box>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 2 }}
              >
                Mindest- und Maximalanzahl Mitarbeiter pro Schicht und
                Station. Qualifikationsanforderungen (z.B. &quot;mind. 1
                Fachkraft&quot;) können pro Schicht hinzugefügt werden.
              </Typography>
              <Divider sx={{ mb: 2 }} />

              {error && (
                <Alert
                  severity="error"
                  sx={{ mb: 2 }}
                  onClose={() => setError(null)}
                >
                  {error}
                </Alert>
              )}

              {loading ? (
                <Box
                  sx={{ display: "flex", justifyContent: "center", py: 4 }}
                >
                  <CircularProgress />
                </Box>
              ) : staffing.length === 0 ? (
                <Alert severity="info">
                  Noch kein Personalbedarf konfiguriert. Klicken Sie auf
                  &quot;Fehlende anlegen&quot; um die Standardeinträge
                  (Früh / Spät × 3 Stationen + Nacht gesamtes Gebäude) zu
                  erstellen.
                </Alert>
              ) : (
                <>
                  <Grid container spacing={2}>
                    {STATIONS.map((station) => renderStationCard(station))}
                  </Grid>

                  {/* Nacht (gesamtes Gebäude) */}
                  <Card
                    variant="outlined"
                    sx={{
                      mt: 2,
                      borderColor: alpha(
                        theme.palette.secondary.main,
                        0.4,
                      ),
                    }}
                  >
                    <Box
                      sx={{
                        px: 2,
                        py: 1.5,
                        bgcolor: alpha(
                          theme.palette.secondary.main,
                          0.06,
                        ),
                        borderBottom: "1px solid",
                        borderColor: "divider",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                        }}
                      >
                        <NightsStayIcon
                          fontSize="small"
                          sx={{ color: "secondary.main" }}
                        />
                        <Typography variant="subtitle1" fontWeight={700}>
                          Nacht (gesamtes Gebäude)
                        </Typography>
                      </Box>
                      {facilityWideRows.length > 0 && (
                        <Chip
                          label={`${facilityWideRows.reduce((s, r) => s + r.minTotalCount, 0)} MA / Nacht`}
                          size="small"
                          color="secondary"
                          variant="outlined"
                          sx={{ fontWeight: 600 }}
                        />
                      )}
                    </Box>
                    {facilityWideRows.length > 0 ? (
                      facilityWideRows.map((row) => renderShiftRow(row))
                    ) : (
                      <Box sx={{ py: 2, px: 2, opacity: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          Nicht konfiguriert
                        </Typography>
                      </Box>
                    )}
                  </Card>
                </>
              )}
          </CardContent>
        </Card>
      )}

      {/* ──── Tab 2: Planungsregeln ──── */}
      {activeTab === 2 && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Planungsregeln
            </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 2 }}
              >
                Passen Sie die Parameter der Planungsregeln an. Änderungen
                wirken sich auf die nächste Plangenerierung aus.
              </Typography>
              <Divider sx={{ mb: 2 }} />

              {rulesError && (
                <Alert
                  severity="error"
                  sx={{ mb: 2 }}
                  onClose={() => setRulesError(null)}
                >
                  {rulesError}
                </Alert>
              )}
              {rulesSuccess && (
                <Alert
                  severity="success"
                  sx={{ mb: 2 }}
                  onClose={() => setRulesSuccess(false)}
                >
                  Regeln gespeichert.
                </Alert>
              )}

              {rulesLoading ? (
                <Box
                  sx={{ display: "flex", justifyContent: "center", py: 4 }}
                >
                  <CircularProgress />
                </Box>
              ) : rulesData ? (
                <>
                  <Box
                    sx={{
                      mb: 2,
                      p: 2,
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1,
                    }}
                  >
                    <Typography variant="subtitle2" gutterBottom>
                      {RULE_LABELS["minRestBetweenShifts"]}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mb: 1.5 }}
                    >
                      Mindestanzahl Stunden Ruhezeit zwischen dem Ende einer
                      Schicht und dem Beginn der nächsten.
                    </Typography>
                    <TextField
                      label="Mindestruhezeit (Stunden)"
                      size="small"
                      type="number"
                      value={minRestHoursDraft}
                      onChange={(e) => setMinRestHoursDraft(e.target.value)}
                      inputProps={{ min: 0, step: 1 }}
                      sx={{ width: { xs: "100%", sm: 200 } }}
                    />
                  </Box>

                  {visibleRules
                    .filter((r) => r.id !== "minRestBetweenShifts")
                    .map((rule) => {
                      const d = rulesDraft[rule.id];
                      if (!d) return null;
                      const paramKeys = Object.keys(rule.params);

                      return (
                        <Box
                          key={rule.id}
                          sx={{
                            mb: 2,
                            p: 2,
                            border: "1px solid",
                            borderColor: d.enabled ? "primary.main" : "divider",
                            borderRadius: 1,
                            opacity: d.enabled ? 1 : 0.6,
                          }}
                        >
                          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
                            <Typography variant="subtitle2">
                              {RULE_LABELS[rule.id] ?? rule.id}
                            </Typography>
                            <FormControlLabel
                              control={
                                <Switch
                                  size="small"
                                  checked={d.enabled}
                                  onChange={(e) =>
                                    setRulesDraft((prev) => ({
                                      ...prev,
                                      [rule.id]: {
                                        ...prev[rule.id],
                                        enabled: e.target.checked,
                                      },
                                    }))
                                  }
                                />
                              }
                              label={d.enabled ? "Aktiv" : "Inaktiv"}
                              labelPlacement="start"
                              sx={{ mr: 0 }}
                            />
                          </Box>
                          {rule.description && (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ mb: 1.5 }}
                            >
                              {rule.description}
                            </Typography>
                          )}
                          {paramKeys.length > 0 && (
                            <Box
                              sx={{
                                display: "flex",
                                gap: 2,
                                flexWrap: "wrap",
                                flexDirection: { xs: "column", sm: "row" },
                              }}
                            >
                              {paramKeys.map((k) => (
                                <TextField
                                  key={k}
                                  label={PARAM_LABELS[k] ?? k}
                                  size="small"
                                  type="number"
                                  value={d.params[k] ?? ""}
                                  disabled={!d.enabled}
                                  onChange={(e) =>
                                    setRulesDraft((prev) => ({
                                      ...prev,
                                      [rule.id]: {
                                        ...prev[rule.id],
                                        params: {
                                          ...prev[rule.id].params,
                                          [k]: e.target.value,
                                        },
                                      },
                                    }))
                                  }
                                  inputProps={{ step: "any" }}
                                  sx={{ width: { xs: "100%", sm: 200 } }}
                                />
                              ))}
                            </Box>
                          )}
                        </Box>
                      );
                    })}

                  <Button
                    variant="contained"
                    startIcon={
                      rulesSaving ? (
                        <CircularProgress size={18} color="inherit" />
                      ) : (
                        <SaveIcon />
                      )
                    }
                    disabled={rulesSaving}
                    onClick={() => void saveRules()}
                    sx={{ mt: 1 }}
                  >
                    Regeln speichern
                  </Button>
                </>
              ) : (
                <Alert severity="warning">
                  Regeln konnten nicht geladen werden.
                </Alert>
              )}
          </CardContent>
        </Card>
      )}

      {/* ──── Qualification add/edit dialog ──── */}
      <Dialog
        open={qualDialogOpen}
        onClose={() => !qualSaving && setQualDialogOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {qualEditId ? "Qualifikation bearbeiten" : "Neue Qualifikation"}
        </DialogTitle>
        <DialogContent
          sx={{ display: "flex", flexDirection: "column", gap: 2.5, pt: 1 }}
        >
          {qualFormError && (
            <Alert severity="error">{qualFormError}</Alert>
          )}
          <TextField
            label="Name"
            value={qualForm.name}
            onChange={(e) =>
              setQualForm((f) => ({ ...f, name: e.target.value }))
            }
            fullWidth
            disabled={qualSaving}
            autoFocus
          />
          <TextField
            label="Abkürzung"
            value={qualForm.abbreviation}
            onChange={(e) => {
              const abbr = e.target.value;
              setQualForm((f) => ({
                ...f,
                abbreviation: abbr,
                // Auto-generate color when creating new (not editing)
                ...(!qualEditId && abbr.trim()
                  ? { color: generateColorFromAbbreviation(abbr.trim()) }
                  : {}),
              }));
            }}
            fullWidth
            disabled={qualSaving}
          />
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Farbe
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Box
                component="input"
                type="color"
                value={qualForm.color}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setQualForm((f) => ({ ...f, color: e.target.value }))
                }
                disabled={qualSaving}
                sx={{
                  width: 48,
                  height: 36,
                  p: 0,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  cursor: "pointer",
                  "&::-webkit-color-swatch-wrapper": { p: "2px" },
                  "&::-webkit-color-swatch": { borderRadius: "3px", border: "none" },
                }}
              />
              <Box
                sx={{
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 2,
                  bgcolor: qualForm.color,
                  color: contrastTextColor(qualForm.color),
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {qualForm.abbreviation || "ABC"}
              </Box>
              <Button
                size="small"
                variant="text"
                disabled={qualSaving || !qualForm.abbreviation.trim()}
                onClick={() =>
                  setQualForm((f) => ({
                    ...f,
                    color: generateColorFromAbbreviation(f.abbreviation.trim()),
                  }))
                }
                sx={{ textTransform: "none", fontSize: "0.75rem" }}
              >
                Automatisch
              </Button>
            </Box>
          </Box>
          <TextField
            label="Sortierung"
            type="number"
            value={qualForm.sortOrder}
            onChange={(e) =>
              setQualForm((f) => ({ ...f, sortOrder: e.target.value }))
            }
            fullWidth
            disabled={qualSaving}
            inputProps={{ min: 0 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={qualForm.isActive}
                onChange={(e) =>
                  setQualForm((f) => ({
                    ...f,
                    isActive: e.target.checked,
                  }))
                }
                disabled={qualSaving}
              />
            }
            label="Aktiv"
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setQualDialogOpen(false)}
            disabled={qualSaving}
          >
            Abbrechen
          </Button>
          <Button
            variant="contained"
            onClick={() => void saveQualification()}
            disabled={qualSaving}
          >
            {qualSaving ? (
              <CircularProgress size={22} />
            ) : qualEditId ? (
              "Speichern"
            ) : (
              "Anlegen"
            )}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ──── Qualification delete confirmation ──── */}
      <Dialog
        open={qualDeleteId !== null}
        onClose={() => !qualDeleteBusy && setQualDeleteId(null)}
      >
        <DialogTitle>Qualifikation löschen?</DialogTitle>
        <DialogContent>
          {qualDeleteError ? (
            <Alert severity="error" sx={{ mt: 1 }}>
              {qualDeleteError}
            </Alert>
          ) : (
            <Typography variant="body2">
              Diese Qualifikation wird dauerhaft entfernt. Falls sie noch
              von Mitarbeitern referenziert wird, schlägt das Löschen fehl.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setQualDeleteId(null)}
            disabled={qualDeleteBusy}
          >
            Abbrechen
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void confirmDeleteQual()}
            disabled={qualDeleteBusy}
          >
            {qualDeleteBusy ? (
              <CircularProgress size={22} color="inherit" />
            ) : (
              "Löschen"
            )}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ──── Staffing add dialog ──── */}
      <Dialog
        open={addOpen}
        onClose={() => !addBusy && setAddOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Personalbedarfs-Eintrag hinzufügen</DialogTitle>
        <DialogContent
          sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}
        >
          {addFormError && <Alert severity="error">{addFormError}</Alert>}

          <FormControlLabel
            control={
              <Checkbox
                checked={newFacilityWide}
                onChange={(e) => {
                  setNewFacilityWide(e.target.checked);
                  if (e.target.checked) setNewStation(0);
                  else setNewStation(1);
                }}
                disabled={addBusy}
              />
            }
            label="Gebäudeweit (z.B. Nachtschicht)"
          />

          <Box sx={{ display: "flex", gap: 2, flexDirection: { xs: "column", sm: "row" } }}>
            <TextField
              select
              label="Schichttyp"
              value={newShift}
              onChange={(e) =>
                setNewShift(e.target.value as ShiftTypeValue)
              }
              fullWidth
              disabled={addBusy}
            >
              {SHIFT_TYPES.map((st) => (
                <MenuItem key={st} value={st}>
                  {shiftTypeLabel(st)}
                </MenuItem>
              ))}
            </TextField>
            {!newFacilityWide && (
              <TextField
                select
                label="Station"
                value={newStation}
                onChange={(e) => setNewStation(Number(e.target.value))}
                fullWidth
                disabled={addBusy}
              >
                <MenuItem value={1}>Station 1</MenuItem>
                <MenuItem value={2}>Station 2</MenuItem>
                <MenuItem value={3}>Station 3</MenuItem>
              </TextField>
            )}
          </Box>

          <Box sx={{ display: "flex", gap: 2, flexDirection: { xs: "column", sm: "row" } }}>
            <TextField
              label="Mindestanzahl"
              type="number"
              value={newMin}
              onChange={(e) => setNewMin(e.target.value)}
              fullWidth
              disabled={addBusy}
              inputProps={{ min: 0 }}
            />
            <TextField
              label="Maximalanzahl (optional)"
              type="number"
              value={newMax}
              onChange={(e) => setNewMax(e.target.value)}
              fullWidth
              disabled={addBusy}
              inputProps={{ min: 0 }}
              placeholder="Unbegrenzt"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)} disabled={addBusy}>
            Abbrechen
          </Button>
          <Button
            variant="contained"
            onClick={() => void submitAdd()}
            disabled={addBusy}
          >
            {addBusy ? <CircularProgress size={22} /> : "Anlegen"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ──── Staffing delete confirmation ──── */}
      <Dialog
        open={deleteId !== null}
        onClose={() => !deleteBusy && setDeleteId(null)}
      >
        <DialogTitle>Eintrag löschen?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Dieser Personalbedarf und alle zugehörigen
            Qualifikationsanforderungen werden entfernt.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)} disabled={deleteBusy}>
            Abbrechen
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void confirmDelete()}
            disabled={deleteBusy}
          >
            {deleteBusy ? (
              <CircularProgress size={22} color="inherit" />
            ) : (
              "Löschen"
            )}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ──── Add qualification to staffing row dialog ──── */}
      <Dialog
        open={addQualSrId !== null}
        onClose={() => !addQualBusy && setAddQualSrId(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Qualifikation hinzufügen</DialogTitle>
        <DialogContent
          sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}
        >
          {addQualError && (
            <Alert severity="error">{addQualError}</Alert>
          )}
          <Autocomplete
            multiple
            options={activeQualifications}
            getOptionLabel={(opt) => `${opt.name} (${opt.abbreviation})`}
            value={newQualSelection}
            onChange={(_, v) => setNewQualSelection(v)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Qualifikation(en)"
                placeholder={newQualSelection.length === 0 ? "Auswählen…" : ""}
                disabled={addQualBusy}
                helperText="Mehrere Qualifikationen = ODER-Logik (eine davon reicht)"
              />
            )}
          />
          <TextField
            label="Min. Anzahl"
            type="number"
            value={newQualMin}
            onChange={(e) => setNewQualMin(e.target.value)}
            fullWidth
            disabled={addQualBusy}
            inputProps={{ min: 1 }}
          />
          <TextField
            label="Max. Anzahl (optional)"
            type="number"
            value={newQualMax}
            onChange={(e) => setNewQualMax(e.target.value)}
            fullWidth
            disabled={addQualBusy}
            inputProps={{ min: 1 }}
            helperText="Leer lassen = kein Maximum"
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setAddQualSrId(null)}
            disabled={addQualBusy}
          >
            Abbrechen
          </Button>
          <Button
            variant="contained"
            onClick={() => void addQualification()}
            disabled={addQualBusy || newQualSelection.length === 0}
          >
            {addQualBusy ? (
              <CircularProgress size={22} />
            ) : (
              "Hinzufügen"
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </MainLayout>
  );
}
