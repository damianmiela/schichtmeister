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

/** A small "window" rectangle inside a floor — shows shift type and people */
function FloorWindow({
  shiftType,
  rows,
  flexBasis = "50%",
}: {
  shiftType: string;
  rows: Row[];
  flexBasis?: string;
}) {
  const fg = SHIFT_FG[shiftType] ?? "#546e7a";
  const label = SHIFT_LABEL[shiftType] ?? shiftType;
  return (
    <Box
      sx={{
        flex: `1 1 ${flexBasis}`,
        minWidth: 200,
        bgcolor: "#ffffff",
        border: `2px solid ${alpha(fg, 0.4)}`,
        borderRadius: 1.5,
        p: 1,
        boxShadow: `inset 0 0 0 2px ${alpha(fg, 0.08)}`,
        position: "relative",
      }}
    >
      {/* Window cross (fake muntins) */}
      <Box
        sx={{
          position: "absolute",
          left: "50%",
          top: 4,
          bottom: 4,
          width: "1px",
          bgcolor: alpha(fg, 0.15),
          pointerEvents: "none",
        }}
      />
      <Typography
        variant="caption"
        sx={{
          display: "block",
          fontWeight: 700,
          color: fg,
          mb: 0.5,
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label} · {rows.length} MA
      </Typography>
      {rows.length === 0 ? (
        <Typography variant="caption" sx={{ color: "text.disabled", fontStyle: "italic" }}>
          – leer –
        </Typography>
      ) : (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
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
        position: "relative",
        bgcolor: colors.wall,
        borderLeft: `6px solid ${ROOF_DARK}`,
        borderRight: `6px solid ${ROOF_DARK}`,
        borderTop: `2px dashed ${alpha(ROOF_DARK, 0.4)}`,
        px: 2,
        py: 1.5,
      }}
    >
      {/* Floor label / "door sign" on the left */}
      <Box
        sx={{
          position: "absolute",
          left: 12,
          top: 8,
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            bgcolor: colors.main,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 14,
            boxShadow: `0 2px 4px ${alpha(colors.main, 0.4)}`,
          }}
        >
          {stationNumber}
        </Box>
        <Box>
          <Typography variant="caption" sx={{ display: "block", fontWeight: 700, color: colors.main, lineHeight: 1 }}>
            Station {stationNumber}
          </Typography>
          <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary", lineHeight: 1 }}>
            {total} MA
          </Typography>
        </Box>
      </Box>

      {/* Windows */}
      <Box sx={{ display: "flex", gap: 1.5, ml: 14, flexWrap: "wrap" }}>
        <FloorWindow shiftType="EARLY" rows={early} />
        <FloorWindow shiftType="LATE" rows={late} />
        {bl.length > 0 && (
          <FloorWindow shiftType="BL" rows={bl} flexBasis="100%" />
        )}
      </Box>
    </Box>
  );
}

/** Attic — trapezoid-ish shape via inset margins, contains night shifts */
function AtticFloor({ rows }: { rows: Row[] }) {
  return (
    <Box
      sx={{
        position: "relative",
        // Slight inset to look like attic walls follow the roof slope
        mx: "5%",
        bgcolor: alpha(NIGHT_COLOR, 0.06),
        border: `2px solid ${alpha(NIGHT_COLOR, 0.4)}`,
        borderBottom: "none",
        borderRadius: "12px 12px 0 0",
        px: 2,
        py: 1.25,
      }}
    >
      <Box
        sx={{
          position: "absolute",
          left: 12,
          top: 8,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          color: NIGHT_COLOR,
        }}
      >
        <NightsStayIcon sx={{ fontSize: 18 }} />
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 11 }}>
          Dachboden · Nacht ({rows.length} MA)
        </Typography>
      </Box>
      <Box sx={{ ml: 18, mt: 0.5, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
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

/** Basement — sits below the grass line, slightly inset and dim */
function BasementFloor({ rows }: { rows: Row[] }) {
  return (
    <Box
      sx={{
        position: "relative",
        mx: "3%",
        bgcolor: alpha(BL_COLOR, 0.08),
        border: `2px dashed ${alpha(BL_COLOR, 0.5)}`,
        borderTop: "none",
        borderRadius: "0 0 10px 10px",
        px: 2,
        py: 1.25,
      }}
    >
      <Box
        sx={{
          position: "absolute",
          left: 12,
          top: 8,
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          color: "#2e7d32",
        }}
      >
        <Box
          component="span"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 1,
            bgcolor: BL_COLOR,
            color: "#fff",
            fontWeight: 800,
            fontSize: 11,
          }}
        >
          BL
        </Box>
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 11 }}>
          Keller · BL ({rows.length} MA)
        </Typography>
      </Box>
      <Box sx={{ ml: 14, mt: 0.5, display: "flex", flexWrap: "wrap", gap: 0.5 }}>
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

/** SVG roof — triangle + chimney + sun + cloud */
function HouseRoof({ width = 800, height = 110 }: { width?: number; height?: number }) {
  return (
    <Box sx={{ width: "100%", height, position: "relative", bgcolor: SKY_COLOR, overflow: "hidden" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={{ display: "block" }}
      >
        {/* Sun */}
        <circle cx={width * 0.08} cy={height * 0.35} r={height * 0.22} fill="#ffeb3b" opacity={0.9} />
        <circle cx={width * 0.08} cy={height * 0.35} r={height * 0.13} fill="#fdd835" />

        {/* Cloud */}
        <g fill="#ffffff" opacity={0.95}>
          <ellipse cx={width * 0.78} cy={height * 0.35} rx={28} ry={14} />
          <ellipse cx={width * 0.82} cy={height * 0.28} rx={22} ry={12} />
          <ellipse cx={width * 0.74} cy={height * 0.32} rx={18} ry={10} />
        </g>

        {/* Roof triangle (matches the inset of the attic — 5% margin) */}
        <polygon
          points={`${width * 0.05},${height} ${width * 0.5},6 ${width * 0.95},${height}`}
          fill={ROOF_COLOR}
          stroke={ROOF_DARK}
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Roof tile lines for texture */}
        {[0.25, 0.45, 0.65, 0.85].map((t) => (
          <line
            key={t}
            x1={width * (0.5 - 0.45 * t)}
            y1={height * t + 6}
            x2={width * (0.5 + 0.45 * t)}
            y2={height * t + 6}
            stroke={ROOF_DARK}
            strokeWidth={0.5}
            opacity={0.4}
          />
        ))}

        {/* Chimney */}
        <rect
          x={width * 0.72}
          y={height * 0.18}
          width={width * 0.05}
          height={height * 0.55}
          fill={ROOF_DARK}
          stroke="#3e2723"
          strokeWidth={1}
        />
        <rect
          x={width * 0.715}
          y={height * 0.16}
          width={width * 0.06}
          height={height * 0.06}
          fill="#3e2723"
        />
        {/* Smoke */}
        <g fill="#ffffff" opacity={0.7}>
          <circle cx={width * 0.745} cy={height * 0.1} r={5} />
          <circle cx={width * 0.76} cy={height * 0.05} r={4} />
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
