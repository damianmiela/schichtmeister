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

/* ── Subtle animation keyframes (injected once at the top of the view) ── */
const ANIMATION_STYLES = `
  @keyframes house-cloud-drift {
    0%, 100% { transform: translateX(0px); }
    50%      { transform: translateX(28px); }
  }
  @keyframes house-smoke-rise {
    0%   { transform: translate(0, 0) scale(1); opacity: 0; }
    20%  { opacity: 0.9; }
    100% { transform: translate(8px, -34px) scale(1.6); opacity: 0; }
  }
  @keyframes house-bird-fly {
    0%   { transform: translate(-40px, 4px); }
    50%  { transform: translate(380px, -10px); }
    100% { transform: translate(800px, 0px); }
  }
  @keyframes house-bird-flap {
    0%, 100% { transform: scaleY(1); }
    50%      { transform: scaleY(0.55); }
  }
  @keyframes house-sun-pulse {
    0%, 100% { transform: scale(1); opacity: 0.9; }
    50%      { transform: scale(1.06); opacity: 1; }
  }
  @keyframes house-doorknob-shine {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
    50%      { box-shadow: 0 0 4px 1px rgba(255,255,255,0.7); }
  }
`;

/* ══════════════════════════════════════════════════════════════ */
/*                       SUB-COMPONENTS                            */
/* ══════════════════════════════════════════════════════════════ */

/** Tiny decorative 4-pane window — for adding visual texture to floors */
function DecorativeWindow({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        bgcolor: alpha(SKY_COLOR, 0.5),
        border: `1.5px solid ${alpha(color, 0.6)}`,
        borderRadius: 0.5,
        position: "relative",
        boxShadow: `inset 0 0 0 1px ${alpha("#ffffff", 0.6)}`,
        flexShrink: 0,
        // Window cross
        "&::before, &::after": {
          content: '""',
          position: "absolute",
          bgcolor: alpha(color, 0.5),
        },
        "&::before": {
          left: "50%",
          top: 1,
          bottom: 1,
          width: 1,
          transform: "translateX(-50%)",
        },
        "&::after": {
          top: "50%",
          left: 1,
          right: 1,
          height: 1,
          transform: "translateY(-50%)",
        },
      }}
    />
  );
}

/** Door — replaces plain floor sign column, looks architectural. */
function FloorDoor({
  number,
  label,
  totalLabel,
  color,
  doorIcon,
}: {
  number?: string;
  label: string;
  totalLabel: string;
  color: string;
  /** Optional icon shown above number (e.g., moon for attic, BL for basement) */
  doorIcon?: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        width: 88,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        bgcolor: alpha(color, 0.07),
        borderRight: `2px dashed ${alpha(color, 0.3)}`,
        py: 1,
        px: 0.75,
        gap: 0.5,
      }}
    >
      {/* Two decorative windows above the door, like upper-floor windows */}
      <Box sx={{ display: "flex", gap: 0.75, mb: 0.25 }}>
        <DecorativeWindow color={color} size={14} />
        <DecorativeWindow color={color} size={14} />
      </Box>

      {/* The door itself */}
      <Box
        sx={{
          width: 52,
          height: 64,
          position: "relative",
          bgcolor: alpha(color, 0.85),
          border: `2px solid ${color}`,
          borderRadius: "6px 6px 2px 2px",
          boxShadow: `inset 0 0 0 2px ${alpha("#ffffff", 0.25)}, 0 1px 3px ${alpha(color, 0.35)}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          pt: 0.75,
          gap: 0.4,
        }}
      >
        {/* House-number plaque (or icon) at top of door */}
        <Box
          sx={{
            minWidth: 22,
            height: 22,
            px: 0.5,
            borderRadius: "50%",
            bgcolor: "#fff",
            color: color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 13,
            boxShadow: `0 1px 2px ${alpha("#000", 0.2)}`,
          }}
        >
          {doorIcon ?? number}
        </Box>

        {/* Lower door panel (raised rectangle) */}
        <Box
          sx={{
            mt: 0.5,
            width: "75%",
            flex: 1,
            bgcolor: alpha("#ffffff", 0.18),
            border: `1px solid ${alpha("#ffffff", 0.35)}`,
            borderRadius: 0.5,
            position: "relative",
          }}
        />

        {/* Doorknob — animated subtle shine */}
        <Box
          sx={{
            position: "absolute",
            right: 5,
            top: "60%",
            width: 5,
            height: 5,
            borderRadius: "50%",
            bgcolor: "#ffd54f",
            border: "1px solid #f9a825",
            animation: "house-doorknob-shine 4s ease-in-out infinite",
          }}
        />
      </Box>

      {/* Floor label below the door */}
      <Typography
        variant="caption"
        sx={{ fontWeight: 700, color, fontSize: 10.5, lineHeight: 1.1, mt: 0.25, textAlign: "center" }}
      >
        {label}
      </Typography>
      <Typography variant="caption" sx={{ fontSize: 9.5, color: "text.secondary", lineHeight: 1 }}>
        {totalLabel}
      </Typography>
    </Box>
  );
}

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

/** Wooden side-wall background — subtle horizontal grain */
const WOOD_GRAIN_BG = `repeating-linear-gradient(
  to bottom,
  ${ROOF_COLOR} 0px,
  ${ROOF_COLOR} 4px,
  ${ROOF_DARK} 5px,
  ${ROOF_COLOR} 6px,
  ${ROOF_COLOR} 11px,
  ${alpha(ROOF_DARK, 0.5)} 12px,
  ${ROOF_COLOR} 13px
)`;

const SIDE_WALL_SX = {
  background: WOOD_GRAIN_BG,
  borderRight: `1px solid ${ROOF_DARK}`,
};

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
        borderTop: `2px dashed ${alpha(ROOF_DARK, 0.4)}`,
      }}
    >
      {/* Left wood-wall */}
      <Box sx={{ width: 6, ...SIDE_WALL_SX }} />

      <FloorDoor
        number={String(stationNumber)}
        label={`Station ${stationNumber}`}
        totalLabel={`${total} MA`}
        color={colors.main}
      />

      {/* Windows + decorative window strip */}
      <Box sx={{ flex: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75, minWidth: 0 }}>
        {/* Decorative window-pane strip on the floor wall */}
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mb: 0.25, opacity: 0.85 }}>
          <DecorativeWindow color={colors.main} size={16} />
          <DecorativeWindow color={colors.main} size={16} />
          <DecorativeWindow color={colors.main} size={16} />
        </Box>
        <FloorWindow shiftType="EARLY" rows={early} />
        <FloorWindow shiftType="LATE" rows={late} />
        {bl.length > 0 && <FloorWindow shiftType="BL" rows={bl} />}
      </Box>

      {/* Right wood-wall */}
      <Box sx={{ width: 6, ...SIDE_WALL_SX, borderRight: "none", borderLeft: `1px solid ${ROOF_DARK}` }} />
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
      }}
    >
      <Box sx={{ width: 6, ...SIDE_WALL_SX }} />
      <FloorDoor
        label="Dachboden"
        totalLabel={`${rows.length} MA`}
        color={NIGHT_COLOR}
        doorIcon={<NightsStayIcon sx={{ fontSize: 14, color: NIGHT_COLOR }} />}
      />
      <Box sx={{ flex: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
        {/* Dormer-like decorative windows */}
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mb: 0.25, opacity: 0.85 }}>
          <DecorativeWindow color={NIGHT_COLOR} size={14} />
          <DecorativeWindow color={NIGHT_COLOR} size={14} />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.5, minHeight: 28 }}>
          {rows.length === 0 ? (
            <Typography variant="caption" sx={{ color: "text.disabled", fontStyle: "italic" }}>
              – niemand hier oben, alles still –
            </Typography>
          ) : (
            rows.map((r) => <PersonChip key={r.employeeId + r.profile.id} row={r} />)
          )}
        </Box>
      </Box>
      <Box sx={{ width: 6, ...SIDE_WALL_SX, borderRight: "none", borderLeft: `1px solid ${ROOF_DARK}` }} />
    </Box>
  );
}

/** Basement — sits below the grass line, full width, dim */
function BasementFloor({ rows }: { rows: Row[] }) {
  // Brick-pattern background for foundation walls
  const brickBg = `repeating-linear-gradient(
    to bottom,
    ${alpha(SOIL_COLOR, 0.55)} 0px,
    ${alpha(SOIL_COLOR, 0.55)} 5px,
    ${alpha(SOIL_COLOR, 0.85)} 6px,
    ${alpha(SOIL_COLOR, 0.55)} 7px
  )`;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "stretch",
        bgcolor: alpha(BL_COLOR, 0.08),
        borderBottom: `4px solid ${SOIL_COLOR}`,
        borderRadius: "0 0 6px 6px",
      }}
    >
      <Box sx={{ width: 6, background: brickBg, borderRight: `1px solid ${SOIL_COLOR}` }} />
      <FloorDoor
        label="Keller"
        totalLabel={`${rows.length} MA`}
        color={BL_COLOR}
        doorIcon={
          <Box component="span" sx={{ fontSize: 9, fontWeight: 800, color: BL_COLOR }}>
            BL
          </Box>
        }
      />
      <Box sx={{ flex: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
        {/* Cellar windows — small slits high on the wall */}
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", mb: 0.25, opacity: 0.7 }}>
          <DecorativeWindow color={BL_COLOR} size={12} />
          <DecorativeWindow color={BL_COLOR} size={12} />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.5, minHeight: 28 }}>
          {rows.length === 0 ? (
            <Typography variant="caption" sx={{ color: "text.disabled", fontStyle: "italic" }}>
              – Keller leer –
            </Typography>
          ) : (
            rows.map((r) => <PersonChip key={r.employeeId + r.profile.id + (r.stationNumber ?? "")} row={r} />)
          )}
        </Box>
      </Box>
      <Box sx={{ width: 6, background: brickBg, borderLeft: `1px solid ${SOIL_COLOR}` }} />
    </Box>
  );
}

/** SVG roof — triangle + chimney + sun + animated clouds + bird + smoke trail */
function HouseRoof({ width = 800, height = 110 }: { width?: number; height?: number }) {
  const CHIMNEY_X = 0.78;
  const CHIMNEY_W = 0.045;
  const smokeBaseX = width * (CHIMNEY_X + CHIMNEY_W / 2);
  const smokeBaseY = height * 0.05;

  return (
    <Box sx={{ width: "100%", height, position: "relative", bgcolor: SKY_COLOR, overflow: "hidden" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={{ display: "block" }}
      >
        {/* Sun (top-left, gentle pulse) */}
        <g style={{ animation: "house-sun-pulse 5s ease-in-out infinite", transformOrigin: `${width * 0.08}px ${height * 0.35}px` }}>
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i * Math.PI) / 4;
            const cx = width * 0.08;
            const cy = height * 0.35;
            const r1 = height * 0.22;
            const r2 = height * 0.3;
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
              />
            );
          })}
          <circle cx={width * 0.08} cy={height * 0.35} r={height * 0.18} fill="#ffeb3b" />
          <circle cx={width * 0.08} cy={height * 0.35} r={height * 0.11} fill="#fdd835" />
        </g>

        {/* Cloud A (mid-left, drifts) */}
        <g
          fill="#ffffff"
          opacity={0.95}
          style={{ animation: "house-cloud-drift 14s ease-in-out infinite" }}
        >
          <ellipse cx={width * 0.36} cy={height * 0.22} rx={32} ry={11} />
          <ellipse cx={width * 0.4} cy={height * 0.16} rx={20} ry={10} />
          <ellipse cx={width * 0.32} cy={height * 0.18} rx={16} ry={9} />
        </g>

        {/* Cloud B (smaller, drifts on different timing) */}
        <g
          fill="#ffffff"
          opacity={0.85}
          style={{ animation: "house-cloud-drift 22s ease-in-out infinite reverse" }}
        >
          <ellipse cx={width * 0.58} cy={height * 0.13} rx={22} ry={8} />
          <ellipse cx={width * 0.54} cy={height * 0.1} rx={14} ry={7} />
        </g>

        {/* Bird flying across (loops) */}
        <g
          stroke="#37474f"
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          style={{ animation: "house-bird-fly 18s linear infinite" }}
        >
          <g style={{ animation: "house-bird-flap 0.45s ease-in-out infinite", transformOrigin: "center" }}>
            <path d={`M 0 0 q 5 -7 10 0 q 5 -7 10 0`} />
          </g>
        </g>

        {/* Roof triangle — full width to match the house body below */}
        <polygon
          points={`0,${height} ${width * 0.5},6 ${width},${height}`}
          fill={ROOF_COLOR}
          stroke={ROOF_DARK}
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Roof tile texture — more visible horizontal stripes */}
        {Array.from({ length: 8 }).map((_, i) => {
          const t = (i + 1) / 9;
          return (
            <line
              key={i}
              x1={width * (0.5 - 0.5 * t)}
              y1={height * t + 6}
              x2={width * (0.5 + 0.5 * t)}
              y2={height * t + 6}
              stroke={ROOF_DARK}
              strokeWidth={0.8}
              opacity={0.55}
            />
          );
        })}

        {/* Roof ridge highlight */}
        <line
          x1={0}
          y1={height}
          x2={width * 0.5}
          y2={6}
          stroke={alpha("#ffffff", 0.25)}
          strokeWidth={1}
        />

        {/* Chimney (drawn AFTER roof) */}
        <rect
          x={width * CHIMNEY_X}
          y={height * 0.1}
          width={width * CHIMNEY_W}
          height={height * 0.55}
          fill={ROOF_DARK}
          stroke="#3e2723"
          strokeWidth={1}
        />
        {/* Brick lines on chimney */}
        {[0.2, 0.4, 0.6].map((t) => (
          <line
            key={t}
            x1={width * CHIMNEY_X}
            y1={height * (0.1 + 0.55 * t)}
            x2={width * (CHIMNEY_X + CHIMNEY_W)}
            y2={height * (0.1 + 0.55 * t)}
            stroke="#3e2723"
            strokeWidth={0.6}
            opacity={0.6}
          />
        ))}
        {/* Chimney cap */}
        <rect
          x={width * (CHIMNEY_X - 0.006)}
          y={height * 0.08}
          width={width * (CHIMNEY_W + 0.012)}
          height={height * 0.05}
          fill="#3e2723"
        />

        {/* Smoke trail — three puffs offset in time so they continuously rise */}
        <g fill="#ffffff" opacity={0}>
          <circle cx={smokeBaseX} cy={smokeBaseY} r={5}
            style={{ animation: "house-smoke-rise 3s ease-out infinite" }}
          />
          <circle cx={smokeBaseX + 2} cy={smokeBaseY} r={6}
            style={{ animation: "house-smoke-rise 3s ease-out infinite", animationDelay: "1s" }}
          />
          <circle cx={smokeBaseX - 2} cy={smokeBaseY} r={5}
            style={{ animation: "house-smoke-rise 3s ease-out infinite", animationDelay: "2s" }}
          />
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
      {/* Inject animation keyframes (scoped to this view via unique animation names) */}
      <style dangerouslySetInnerHTML={{ __html: ANIMATION_STYLES }} />
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

        {/* Ground / grass with tufts + flowers */}
        <Box
          sx={{
            position: "relative",
            height: 16,
            bgcolor: GRASS_COLOR,
            borderTop: `2px solid ${alpha("#558b2f", 0.6)}`,
          }}
        >
          {/* Grass tufts */}
          {Array.from({ length: 18 }).map((_, i) => (
            <Box
              key={`tuft-${i}`}
              sx={{
                position: "absolute",
                left: `${(i + 0.5) * (100 / 18)}%`,
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
          {/* A couple of flowers */}
          {[
            { left: "12%", color: "#ff5252" },
            { left: "27%", color: "#ffeb3b" },
            { left: "63%", color: "#e040fb" },
            { left: "84%", color: "#ff5252" },
          ].map((f, i) => (
            <Box
              key={`flower-${i}`}
              sx={{
                position: "absolute",
                left: f.left,
                top: -6,
                transform: "translateX(-50%)",
                width: 6,
                height: 6,
                borderRadius: "50%",
                bgcolor: f.color,
                border: "1px solid #fff",
                boxShadow: "0 1px 0 #33691e",
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
