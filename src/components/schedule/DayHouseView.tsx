"use client";

/**
 * DayHouseView — a fun visual representation of a day's schedule shaped like a house.
 *
 * Floors (top → bottom):
 *   ▲ Roof + chimney + sky decorations
 *   ▦ Attic         → NIGHT shifts (facility-wide)
 *   ▦ 3rd floor     → Station 3
 *   ▦ 2nd floor     → Station 2
 *   ▦ 1st floor     → Station 1
 *   ▦ Basement      → BL shifts (all stations merged)
 *   ▭ Ground / grass
 *
 * View-only — edits happen in the columns view.
 */

import { useMemo } from "react";
import { Box, Chip, Tooltip, Typography, alpha } from "@mui/material";
import NightsStayIcon from "@mui/icons-material/NightsStay";
import LightModeIcon from "@mui/icons-material/LightMode";
import HomeIcon from "@mui/icons-material/Home";
import type {
  AssignmentJson,
  EmployeeJson,
  ShiftProfileJson,
} from "@/lib/schedule/scheduleTypes";

/* ── Colors (kept consistent with DayView / MonthTableView) ── */

const STATION_COLORS: Record<number, { main: string; light: string; wall: string }> = {
  1: { main: "#1565c0", light: "#e3f2fd", wall: "#fff8e1" },
  2: { main: "#2e7d32", light: "#e8f5e9", wall: "#fff8e1" },
  3: { main: "#e65100", light: "#fff3e0", wall: "#fff8e1" },
};

const NIGHT_COLOR = "#7e57c2";
const BL_COLOR = "#66bb6a";
const ROOF_COLOR = "#8d4e2a"; // warm brown roof
const ROOF_DARK = "#6b3a1d";
const SKY_COLOR = "#e3f2fd";
const GRASS_COLOR = "#7cb342";
const SOIL_COLOR = "#8d6e63";

const SHIFT_BG: Record<string, string> = {
  EARLY: "#fff3e0",
  LATE: "#fce4ec",
  NIGHT: "#ede7f6",
  BL: "#e8f5e9",
};
const SHIFT_FG: Record<string, string> = {
  EARLY: "#ef6c00",
  LATE: "#c2185b",
  NIGHT: "#5e35b1",
  BL: "#388e3c",
};
const SHIFT_LABEL: Record<string, string> = {
  EARLY: "Früh",
  LATE: "Spät",
  NIGHT: "Nacht",
  BL: "BL",
};

/* ── Small helpers ── */

type Row = {
  employeeId: string;
  employee: EmployeeJson | undefined;
  profile: ShiftProfileJson;
  stationNumber: number | null;
};

function shortName(emp: EmployeeJson | undefined, fallback: string): string {
  if (!emp) return fallback.slice(0, 6);
  // First initial + last name, e.g. "M. Schmidt"
  const f = emp.firstName?.[0] ?? "";
  return `${f ? f + ". " : ""}${emp.lastName}`;
}

/* ══════════════════════════════════════════════════════════════ */
/*                       SUB-COMPONENTS                            */
/* ══════════════════════════════════════════════════════════════ */

/** A single employee chip — name + tiny shift badge */
function PersonChip({ row }: { row: Row }) {
  const fg = SHIFT_FG[row.profile.shiftType] ?? "#546e7a";
  const bg = SHIFT_BG[row.profile.shiftType] ?? "#eceff1";
  const fullName = row.employee
    ? `${row.employee.firstName} ${row.employee.lastName}`
    : row.employeeId.slice(0, 8);
  return (
    <Tooltip title={`${fullName} · ${row.profile.name}`} arrow>
      <Chip
        size="small"
        label={
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <span>{shortName(row.employee, row.employeeId)}</span>
            <Box
              component="span"
              sx={{
                fontSize: 9,
                fontWeight: 700,
                px: 0.5,
                ml: 0.25,
                borderRadius: "3px",
                bgcolor: alpha(fg, 0.18),
                color: fg,
                lineHeight: 1.4,
              }}
            >
              {row.profile.name}
            </Box>
          </Box>
        }
        sx={{
          height: 24,
          fontSize: 11,
          fontWeight: 500,
          bgcolor: bg,
          color: fg,
          border: `1px solid ${alpha(fg, 0.3)}`,
          "& .MuiChip-label": { px: 0.75 },
        }}
      />
    </Tooltip>
  );
}

/** A "window" rectangle inside a floor — shows shift type and people.
 *  Side-by-side layout: small label column on the left, chips fill the rest. */
function FloorWindow({
  shiftType,
  rows,
}: {
  shiftType: string;
  rows: Row[];
}) {
  const fg = SHIFT_FG[shiftType] ?? "#546e7a";
  const label = SHIFT_LABEL[shiftType] ?? shiftType;
  return (
    <Box
      sx={{
        width: "100%",
        bgcolor: "#ffffff",
        border: `2px solid ${alpha(fg, 0.4)}`,
        borderRadius: 1.5,
        p: 1,
        boxShadow: `inset 0 0 0 2px ${alpha(fg, 0.08)}`,
        display: "flex",
        alignItems: "center",
        gap: 1.25,
      }}
    >
      <Box
        sx={{
          flexShrink: 0,
          minWidth: 56,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          borderRight: `1px dashed ${alpha(fg, 0.3)}`,
          pr: 1,
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontWeight: 800,
            color: fg,
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            lineHeight: 1.1,
          }}
        >
          {label}
        </Typography>
        <Typography variant="caption" sx={{ color: alpha(fg, 0.75), fontSize: 9, fontWeight: 600 }}>
          {rows.length} MA
        </Typography>
      </Box>

      {rows.length === 0 ? (
        <Typography variant="caption" sx={{ color: "text.disabled", fontStyle: "italic" }}>
          – leer –
        </Typography>
      ) : (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, flex: 1 }}>
          {rows.map((r) => (
            <PersonChip key={r.employeeId + r.profile.id} row={r} />
          ))}
        </Box>
      )}
    </Box>
  );
}

/** A standard station floor */
function StationFloor({
  stationNumber,
  early,
  late,
  bl,
}: {
  stationNumber: 1 | 2 | 3;
  early: Row[];
  late: Row[];
  bl: Row[];
}) {
  const colors = STATION_COLORS[stationNumber]!;
  const total = early.length + late.length + bl.length;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "stretch",
        bgcolor: colors.wall,
        borderLeft: `6px solid ${ROOF_DARK}`,
        borderRight: `6px solid ${ROOF_DARK}`,
        borderTop: `2px dashed ${alpha(ROOF_DARK, 0.4)}`,
      }}
    >
      {/* Floor sign — narrow column on the left */}
      <Box
        sx={{
          width: 88,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 0.25,
          bgcolor: alpha(colors.main, 0.07),
          borderRight: `2px dashed ${alpha(colors.main, 0.3)}`,
          py: 1.25,
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            bgcolor: colors.main,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 16,
            boxShadow: `0 2px 4px ${alpha(colors.main, 0.4)}`,
          }}
        >
          {stationNumber}
        </Box>
        <Typography variant="caption" sx={{ fontWeight: 700, color: colors.main, fontSize: 11, lineHeight: 1.1, mt: 0.25 }}>
          Station {stationNumber}
        </Typography>
        <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", lineHeight: 1 }}>
          {total} MA
        </Typography>
      </Box>

      {/* Windows */}
      <Box sx={{ flex: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75, minWidth: 0 }}>
        <FloorWindow shiftType="EARLY" rows={early} />
        <FloorWindow shiftType="LATE" rows={late} />
        {bl.length > 0 && <FloorWindow shiftType="BL" rows={bl} />}
      </Box>
    </Box>
  );
}

/** Attic — full width, sits directly under the roof, contains night shifts */
function AtticFloor({ rows }: { rows: Row[] }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "stretch",
        bgcolor: alpha(NIGHT_COLOR, 0.08),
        borderLeft: `6px solid ${ROOF_DARK}`,
        borderRight: `6px solid ${ROOF_DARK}`,
      }}
    >
      <Box
        sx={{
          width: 88,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 0.25,
          bgcolor: alpha(NIGHT_COLOR, 0.18),
          borderRight: `2px dashed ${alpha(NIGHT_COLOR, 0.4)}`,
          py: 1.25,
          color: NIGHT_COLOR,
        }}
      >
        <NightsStayIcon sx={{ fontSize: 26 }} />
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 11, lineHeight: 1.1, mt: 0.25 }}>
          Dachboden
        </Typography>
        <Typography variant="caption" sx={{ fontSize: 10, color: alpha(NIGHT_COLOR, 0.75), lineHeight: 1 }}>
          {rows.length} MA
        </Typography>
      </Box>
      <Box sx={{ flex: 1, p: 1, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.5, minWidth: 0 }}>
        {rows.length === 0 ? (
          <Typography variant="caption" sx={{ color: "text.disabled", fontStyle: "italic" }}>
            – niemand hier oben –
          </Typography>
        ) : (
          rows.map((r) => <PersonChip key={r.employeeId + r.profile.id} row={r} />)
        )}
      </Box>
    </Box>
  );
}

/** Basement — sits below the grass line, full width, dim */
function BasementFloor({ rows }: { rows: Row[] }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "stretch",
        bgcolor: alpha(BL_COLOR, 0.08),
        borderLeft: `6px dashed ${alpha(SOIL_COLOR, 0.7)}`,
        borderRight: `6px dashed ${alpha(SOIL_COLOR, 0.7)}`,
        borderBottom: `4px solid ${SOIL_COLOR}`,
        borderRadius: "0 0 6px 6px",
      }}
    >
      <Box
        sx={{
          width: 88,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 0.25,
          bgcolor: alpha(BL_COLOR, 0.18),
          borderRight: `2px dashed ${alpha(BL_COLOR, 0.4)}`,
          py: 1.25,
        }}
      >
        <Box
          sx={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 1,
            bgcolor: BL_COLOR,
            color: "#fff",
            fontWeight: 800,
            fontSize: 13,
            boxShadow: `0 2px 4px ${alpha(BL_COLOR, 0.4)}`,
          }}
        >
          BL
        </Box>
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 11, color: "#2e7d32", lineHeight: 1.1, mt: 0.25 }}>
          Keller
        </Typography>
        <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", lineHeight: 1 }}>
          {rows.length} MA
        </Typography>
      </Box>
      <Box sx={{ flex: 1, p: 1, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.5, minWidth: 0 }}>
        {rows.length === 0 ? (
          <Typography variant="caption" sx={{ color: "text.disabled", fontStyle: "italic" }}>
            – Keller leer –
          </Typography>
        ) : (
          rows.map((r) => <PersonChip key={r.employeeId + r.profile.id + (r.stationNumber ?? "")} row={r} />)
        )}
      </Box>
    </Box>
  );
}

/** SVG roof — triangle (full width) + chimney + sun + cloud */
function HouseRoof({ width = 800, height = 95 }: { width?: number; height?: number }) {
  // Chimney positioned over right slope; cloud moved to far left so it doesn't collide.
  const CHIMNEY_X = 0.78;
  const CHIMNEY_W = 0.045;
  return (
    <Box sx={{ width: "100%", height, position: "relative", bgcolor: SKY_COLOR, overflow: "hidden" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={{ display: "block" }}
      >
        {/* Sun (top-left) */}
        <g>
          {/* Sun rays */}
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i * Math.PI) / 4;
            const cx = width * 0.08;
            const cy = height * 0.4;
            const r1 = height * 0.26;
            const r2 = height * 0.34;
            return (
              <line
                key={i}
                x1={cx + Math.cos(a) * r1}
                y1={cy + Math.sin(a) * r1}
                x2={cx + Math.cos(a) * r2}
                y2={cy + Math.sin(a) * r2}
                stroke="#fdd835"
                strokeWidth={2}
                strokeLinecap="round"
                opacity={0.9}
              />
            );
          })}
          <circle cx={width * 0.08} cy={height * 0.4} r={height * 0.22} fill="#ffeb3b" opacity={0.95} />
          <circle cx={width * 0.08} cy={height * 0.4} r={height * 0.14} fill="#fdd835" />
        </g>

        {/* Cloud (mid-left, well clear of chimney) */}
        <g fill="#ffffff" opacity={0.95}>
          <ellipse cx={width * 0.42} cy={height * 0.24} rx={32} ry={11} />
          <ellipse cx={width * 0.46} cy={height * 0.18} rx={20} ry={10} />
          <ellipse cx={width * 0.38} cy={height * 0.2} rx={16} ry={9} />
        </g>

        {/* Roof triangle — full width to match the house body below */}
        <polygon
          points={`0,${height} ${width * 0.5},6 ${width},${height}`}
          fill={ROOF_COLOR}
          stroke={ROOF_DARK}
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Roof tile lines for texture */}
        {[0.25, 0.45, 0.65, 0.85].map((t) => (
          <line
            key={t}
            x1={width * (0.5 - 0.5 * t)}
            y1={height * t + 6}
            x2={width * (0.5 + 0.5 * t)}
            y2={height * t + 6}
            stroke={ROOF_DARK}
            strokeWidth={0.5}
            opacity={0.4}
          />
        ))}

        {/* Chimney (drawn AFTER roof so it sits on top of the slope) */}
        <rect
          x={width * CHIMNEY_X}
          y={height * 0.1}
          width={width * CHIMNEY_W}
          height={height * 0.55}
          fill={ROOF_DARK}
          stroke="#3e2723"
          strokeWidth={1}
        />
        <rect
          x={width * (CHIMNEY_X - 0.005)}
          y={height * 0.08}
          width={width * (CHIMNEY_W + 0.01)}
          height={height * 0.06}
          fill="#3e2723"
        />
        {/* Smoke puffs */}
        <g fill="#ffffff" opacity={0.85}>
          <circle cx={width * (CHIMNEY_X + CHIMNEY_W / 2)} cy={height * 0.05} r={5} />
          <circle cx={width * (CHIMNEY_X + CHIMNEY_W / 2 + 0.015)} cy={height * 0.0} r={4} />
        </g>
      </svg>
    </Box>
  );
}

/* ══════════════════════════════════════════════════════════════ */
/*                          MAIN COMPONENT                         */
/* ══════════════════════════════════════════════════════════════ */

export default function DayHouseView({
  dayAssignments,
  employeesById,
  profilesById,
}: {
  dayAssignments: AssignmentJson[];
  employeesById: Record<string, EmployeeJson>;
  profilesById: Record<string, ShiftProfileJson>;
}) {
  const { stations, nightRows, blRows } = useMemo(() => {
    const stationsAcc: Record<number, { early: Row[]; late: Row[]; bl: Row[] }> = {
      1: { early: [], late: [], bl: [] },
      2: { early: [], late: [], bl: [] },
      3: { early: [], late: [], bl: [] },
    };
    const nights: Row[] = [];
    const allBl: Row[] = [];

    for (const a of dayAssignments) {
      if (a.dayStatus === "K" || a.dayStatus === "U") continue;
      const profile = profilesById[a.shiftProfileId];
      if (!profile) continue;
      const employee = employeesById[a.employeeId];
      const row: Row = {
        employeeId: a.employeeId,
        employee,
        profile,
        stationNumber: a.stationNumber ?? employee?.mainStation ?? null,
      };

      if (profile.shiftType === "NIGHT") {
        nights.push(row);
      } else if (profile.shiftType === "BL") {
        allBl.push(row);
        const st = a.stationNumber ?? employee?.mainStation ?? 1;
        const bucket = stationsAcc[st] ?? stationsAcc[1];
        bucket!.bl.push(row);
      } else {
        const st = a.stationNumber ?? employee?.mainStation ?? employee?.assignedStations?.[0] ?? 1;
        const bucket = stationsAcc[st] ?? stationsAcc[1];
        if (profile.shiftType === "EARLY") bucket!.early.push(row);
        else if (profile.shiftType === "LATE") bucket!.late.push(row);
      }
    }

    const sortFn = (a: Row, b: Row) => {
      const an = a.employee ? `${a.employee.lastName} ${a.employee.firstName}` : "";
      const bn = b.employee ? `${b.employee.lastName} ${b.employee.firstName}` : "";
      return an.localeCompare(bn, "de");
    };
    for (const st of Object.values(stationsAcc)) {
      st.early.sort(sortFn);
      st.late.sort(sortFn);
      st.bl.sort(sortFn);
    }
    nights.sort(sortFn);
    allBl.sort(sortFn);

    return { stations: stationsAcc, nightRows: nights, blRows: allBl };
  }, [dayAssignments, employeesById, profilesById]);

  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 1 }}>
      <Box
        sx={{
          width: "100%",
          maxWidth: 980,
          fontFamily: "inherit",
        }}
      >
        {/* Sky + roof */}
        <HouseRoof />

        {/* Attic — Nacht */}
        <AtticFloor rows={nightRows} />

        {/* Floors top → bottom */}
        <StationFloor
          stationNumber={3}
          early={stations[3]!.early}
          late={stations[3]!.late}
          bl={[]}
        />
        <StationFloor
          stationNumber={2}
          early={stations[2]!.early}
          late={stations[2]!.late}
          bl={[]}
        />
        <StationFloor
          stationNumber={1}
          early={stations[1]!.early}
          late={stations[1]!.late}
          bl={[]}
        />

        {/* Ground / grass */}
        <Box
          sx={{
            position: "relative",
            height: 14,
            bgcolor: GRASS_COLOR,
            borderTop: `2px solid ${alpha("#558b2f", 0.6)}`,
          }}
        >
          {/* Cute grass tufts */}
          {Array.from({ length: 14 }).map((_, i) => (
            <Box
              key={i}
              sx={{
                position: "absolute",
                left: `${(i + 0.5) * (100 / 14)}%`,
                top: -2,
                width: 0,
                height: 0,
                borderLeft: "3px solid transparent",
                borderRight: "3px solid transparent",
                borderBottom: `5px solid ${alpha("#33691e", 0.7)}`,
                transform: "translateX(-50%)",
              }}
            />
          ))}
        </Box>

        {/* Soil under basement */}
        <Box sx={{ height: 6, bgcolor: SOIL_COLOR }} />

        {/* Basement — BL (merged across all stations) */}
        <BasementFloor rows={blRows} />

        {/* Footer legend */}
        <Box
          sx={{
            mt: 1.5,
            display: "flex",
            gap: 1.5,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <LegendDot color={SHIFT_FG.EARLY!} icon={<LightModeIcon sx={{ fontSize: 12 }} />} label="Früh" />
          <LegendDot color={SHIFT_FG.LATE!} label="Spät" />
          <LegendDot color={NIGHT_COLOR} icon={<NightsStayIcon sx={{ fontSize: 12 }} />} label="Nacht" />
          <LegendDot color={BL_COLOR} icon={<HomeIcon sx={{ fontSize: 12 }} />} label="BL" />
        </Box>
      </Box>
    </Box>
  );
}

function LegendDot({
  color,
  label,
  icon,
}: {
  color: string;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <Box
        sx={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          bgcolor: alpha(color, 0.2),
          color,
          border: `1.5px solid ${color}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {icon}
      </Box>
      <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600 }}>
        {label}
      </Typography>
    </Box>
  );
}
