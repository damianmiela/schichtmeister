"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTheme, useMediaQuery } from "@mui/material";
import MainLayout from "@/components/layout/MainLayout";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Avatar,
  AvatarGroup,
  LinearProgress,
  Button,
  Alert,
  CircularProgress,
  Tooltip,
} from "@mui/material";
import PeopleIcon from "@mui/icons-material/People";
import PersonOffIcon from "@mui/icons-material/PersonOff";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

/* ── colors (consistent with MonthTableView / EmployeeView) ── */
const STATION_COLORS: Record<number, { main: string; light: string }> = {
  1: { main: "#1565c0", light: "#e3f2fd" },
  2: { main: "#2e7d32", light: "#e8f5e9" },
  3: { main: "#e65100", light: "#fff3e0" },
};
const NIGHT_COLOR = { main: "#7e57c2", light: "#ede7f6" };

const STATUS_LABELS: Record<string, string> = {
  KRANK: "Krank",
  LANGZEITKRANK: "Langzeitkrank",
  URLAUB: "Urlaub",
  MUTTERSCHUTZ: "Mutterschutz",
  KUR: "Kur",
};

/* ── types ── */
type StationShift = {
  shiftType: string;
  shiftTypeLabel: string;
  assigned: number;
  required: number;
  employees: { initials: string; name: string }[];
};

type StationData = {
  station: number;
  label: string;
  shifts: StationShift[];
};

type DayPreview = {
  date: string;
  weekday: string;
  isToday: boolean;
  stations: Record<number, { early: number; late: number }>;
  night: number;
  totalAssigned: number;
  totalRequired: number;
};

type DashboardData = {
  activeCount: number;
  absentCount: number;
  absentEmployees: { name: string; status: string; returnDate?: string }[];
  coveragePct: number | null;
  todayLabel: string;
  totalAssignmentsToday: number;
  schedule: { id: string; periodStart: string; periodEnd: string } | null;
  todayStations: StationData[];
  todayNight: StationShift;
  weekPreview: DayPreview[];
};

/* ── helpers ── */
function coverageColor(assigned: number, required: number): "success" | "warning" | "error" | "info" {
  if (required === 0) return assigned > 0 ? "info" : "info";
  const pct = assigned / required;
  if (pct >= 1) return "success";
  if (pct >= 0.7) return "warning";
  return "error";
}

function coverageBg(assigned: number, required: number): string {
  if (required === 0) return "transparent";
  const pct = assigned / required;
  if (pct >= 1) return "#e8f5e9";
  if (pct >= 0.7) return "#fff8e1";
  return "#ffebee";
}

function formatDe(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/* ── component ── */
export default function DashboardPage() {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (session?.user?.role !== "PLANNER" && session?.user?.role !== "ADMIN") {
      setLoading(false);
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson<DashboardData>("/api/dashboard/summary");
      setData(res);
    } catch (e) {
      if (e instanceof ApiError) {
        const msg =
          e.body && typeof e.body === "object" && e.body !== null && "error" in e.body
            ? String((e.body as { error: unknown }).error)
            : "Laden fehlgeschlagen.";
        setError(msg);
      } else setError("Netzwerkfehler");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [session?.user?.role]);

  useEffect(() => {
    if (sessionStatus === "authenticated") void load();
    if (sessionStatus === "unauthenticated") setLoading(false);
  }, [load, sessionStatus]);

  if (sessionStatus === "loading" || (sessionStatus === "authenticated" && loading)) {
    return (
      <MainLayout title="Dashboard">
        <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
          <CircularProgress />
        </Box>
      </MainLayout>
    );
  }

  if (session?.user?.role === "DEMO") {
    return (
      <MainLayout title="Dashboard">
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>Willkommen</Typography>
            <Typography color="text.secondary">
              Demo-Zugang — einige Funktionen sind eingeschränkt.
            </Typography>
          </CardContent>
        </Card>
      </MainLayout>
    );
  }

  if (!data) {
    return (
      <MainLayout title="Dashboard">
        {error ? <Alert severity="error">{error}</Alert> : <Typography color="text.secondary">Keine Daten.</Typography>}
      </MainLayout>
    );
  }

  const todayTitle = formatDe(data.todayLabel);

  return (
    <MainLayout title="Dashboard">
      {/* ═══════════ TOP METRIC CARDS ═══════════ */}
      <Box sx={{ display: "flex", gap: { xs: 1, sm: 2 }, flexWrap: "wrap", mb: 3, px: { xs: 0, sm: 0 } }}>
        {/* Active employees */}
        <MetricCard
          icon={<PeopleIcon />}
          color="#1565c0"
          label="Aktive Mitarbeiter"
          value={data.activeCount}
          onClick={() => router.push("/employees")}
        />
        {/* Absent */}
        <MetricCard
          icon={<PersonOffIcon />}
          color="#e65100"
          label="Abwesend"
          value={data.absentCount}
          subtitle={data.absentEmployees.length > 0
            ? data.absentEmployees.slice(0, 3).map((e) => e.name.split(",")[0]).join(", ") +
              (data.absentEmployees.length > 3 ? ` +${data.absentEmployees.length - 3}` : "")
            : undefined
          }
          onClick={() => router.push("/employees")}
        />
        {/* Coverage */}
        <MetricCard
          icon={<CheckCircleIcon />}
          color={data.coveragePct != null && data.coveragePct >= 100 ? "#2e7d32" : data.coveragePct != null && data.coveragePct >= 70 ? "#ed6c02" : "#d32f2f"}
          label="Besetzung heute"
          value={data.coveragePct != null ? `${data.coveragePct}%` : "—"}
        />
        {/* Today's shifts */}
        <MetricCard
          icon={<CalendarMonthIcon />}
          color="#00897b"
          label="Schichten heute"
          value={data.totalAssignmentsToday}
          subtitle={data.schedule ? "Plan aktiv" : "Kein Plan"}
          onClick={() => router.push("/schedule")}
        />
      </Box>

      {/* ═══════════ TODAY'S STAFFING ═══════════ */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ pb: "16px !important", px: { xs: 1.5, sm: 2, md: 3 } }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1, flexWrap: "wrap", mb: 2 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Heute · {todayTitle}
              </Typography>
            </Box>
            <Button
              component={Link}
              href="/schedule"
              endIcon={<ArrowForwardIcon />}
              size="small"
              variant="outlined"
            >
              Tagesansicht
            </Button>
          </Box>

          {data.todayStations.length === 0 && data.todayNight.assigned === 0 ? (
            <Typography color="text.secondary">
              Keine Zuweisungen für heute (oder kein Plan für dieses Datum).
            </Typography>
          ) : (
            <Box sx={{ display: "flex", gap: { xs: 1, sm: 2 }, flexWrap: "wrap" }}>
              {/* Station cards */}
              {data.todayStations.map((st) => (
                <StationCard key={st.station} station={st} />
              ))}
              {/* Night card */}
              <NightCard night={data.todayNight} />
            </Box>
          )}
        </CardContent>
      </Card>

      {/* ═══════════ ABSENT EMPLOYEES ═══════════ */}
      {data.absentEmployees.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ pb: "16px !important", px: { xs: 1.5, sm: 2, md: 3 } }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 1.5 }}>
              Abwesende Mitarbeiter
            </Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {data.absentEmployees.map((emp) => (
                <Chip
                  key={emp.name}
                  label={
                    `${emp.name} · ${STATUS_LABELS[emp.status] ?? emp.status}` +
                    (emp.returnDate ? ` · zurück ${new Date(emp.returnDate + "T12:00:00").toLocaleDateString("de-DE", { day: "numeric", month: "short" })}` : "")
                  }
                  size="small"
                  variant="outlined"
                  sx={{
                    borderColor: emp.status === "KRANK" || emp.status === "LANGZEITKRANK" ? "#ef5350" : "#ff9800",
                    color: emp.status === "KRANK" || emp.status === "LANGZEITKRANK" ? "#c62828" : "#e65100",
                  }}
                />
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* ═══════════ 7-DAY PREVIEW ═══════════ */}
      <Card>
        <CardContent sx={{ pb: "16px !important", px: { xs: 1.5, sm: 2, md: 3 } }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1, flexWrap: "wrap", mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Nächste 7 Tage
            </Typography>
            <Button
              component={Link}
              href="/schedule"
              endIcon={<ArrowForwardIcon />}
              size="small"
              variant="outlined"
            >
              Monatsplan
            </Button>
          </Box>

          <TableContainer sx={{ overflowX: { xs: "auto", sm: "auto" }, mb: 0 }}>
            <Table size="small" sx={{ minWidth: { xs: 360, sm: 600 } }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, minWidth: 100 }} />
                  {data.weekPreview.map((day) => (
                    <TableCell
                      key={day.date}
                      align="center"
                      sx={{
                        fontWeight: day.isToday ? 700 : 500,
                        bgcolor: day.isToday ? "#e3f2fd" : undefined,
                        borderRadius: day.isToday ? 1 : 0,
                        minWidth: 64,
                      }}
                    >
                      <Typography variant="caption" display="block" color="text.secondary">
                        {day.weekday}
                      </Typography>
                      {day.date.slice(8)}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {[1, 2, 3].map((st) => (
                  <TableRow key={st}>
                    <TableCell sx={{ fontWeight: 600 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        <Box
                          sx={{
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            bgcolor: STATION_COLORS[st]?.main,
                          }}
                        />
                        Station {st}
                      </Box>
                    </TableCell>
                    {data.weekPreview.map((day) => {
                      const s = day.stations[st];
                      const early = s?.early ?? 0;
                      const late = s?.late ?? 0;
                      const total = early + late;
                      return (
                        <TableCell
                          key={day.date}
                          align="center"
                          sx={{
                            bgcolor: day.isToday ? "#e3f2fd" : undefined,
                          }}
                        >
                          <Tooltip
                            title={`Früh: ${early} · Spät: ${late}`}
                            arrow
                          >
                            <Typography
                              variant="body2"
                              sx={{
                                fontWeight: 600,
                                color: total === 0 ? "text.disabled" : STATION_COLORS[st]?.main,
                              }}
                            >
                              {total > 0 ? total : "—"}
                            </Typography>
                          </Tooltip>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
                {/* Night row */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          bgcolor: NIGHT_COLOR.main,
                        }}
                      />
                      Nacht
                    </Box>
                  </TableCell>
                  {data.weekPreview.map((day) => (
                    <TableCell
                      key={day.date}
                      align="center"
                      sx={{ bgcolor: day.isToday ? "#e3f2fd" : undefined }}
                    >
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 600,
                          color: day.night === 0 ? "text.disabled" : NIGHT_COLOR.main,
                        }}
                      >
                        {day.night > 0 ? day.night : "—"}
                      </Typography>
                    </TableCell>
                  ))}
                </TableRow>
                {/* Total row */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Gesamt</TableCell>
                  {data.weekPreview.map((day) => {
                    const clr = coverageColor(day.totalAssigned, day.totalRequired);
                    return (
                      <TableCell
                        key={day.date}
                        align="center"
                        sx={{ bgcolor: day.isToday ? "#e3f2fd" : undefined }}
                      >
                        <Tooltip
                          title={`${day.totalAssigned} zugewiesen / ${day.totalRequired} benötigt`}
                          arrow
                        >
                          <Chip
                            label={`${day.totalAssigned}/${day.totalRequired}`}
                            size="small"
                            color={clr}
                            variant="outlined"
                            sx={{ fontWeight: 600, fontSize: 11 }}
                          />
                        </Tooltip>
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </MainLayout>
  );
}

/* ═══════════ SUB-COMPONENTS ═══════════ */

function MetricCard({
  icon,
  color,
  label,
  value,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  value: string | number;
  subtitle?: string;
  onClick?: () => void;
}) {
  return (
    <Card
      sx={{
        flex: { xs: "1 1 calc(50% - 4px)", sm: "1 1 calc(25% - 6px)", md: "1 1 200px" },
        minWidth: { xs: 120, sm: 160, md: 180 },
        cursor: onClick ? "pointer" : "default",
        transition: "box-shadow 0.2s",
        "&:hover": onClick ? { boxShadow: 4 } : undefined,
      }}
      onClick={onClick}
    >
      <CardContent sx={{ py: 2, px: { xs: 1.5, sm: 2, md: 2.5 }, "&:last-child": { pb: 2 } }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 1, sm: 1.5 } }}>
          <Box
            sx={{
              bgcolor: `${color}15`,
              borderRadius: 2,
              p: { xs: 0.75, sm: 1 },
              color,
              display: "flex",
              alignItems: "center",
              fontSize: { xs: "1.25rem", sm: "1.5rem" },
            }}
          >
            {icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" noWrap>
              {label}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {subtitle}
              </Typography>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

function StationCard({ station }: { station: StationData }) {
  const stColor = STATION_COLORS[station.station];
  return (
    <Card
      variant="outlined"
      sx={{
        flex: { xs: "1 1 100%", sm: "1 1 calc(50% - 4px)", md: "1 1 220px" },
        minWidth: { xs: 100, sm: 180, md: 200 },
        borderLeft: `4px solid ${stColor?.main}`,
        bgcolor: stColor?.light,
      }}
    >
      <CardContent sx={{ py: 1.5, px: { xs: 1.5, sm: 2 }, "&:last-child": { pb: 1.5 } }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: stColor?.main, display: "block" }}>
          {station.label}
        </Typography>
        {station.shifts.map((shift) => (
          <Box key={shift.shiftType} sx={{ mb: 0.5 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.25, gap: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {shift.shiftTypeLabel}
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {shift.assigned}/{shift.required}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={shift.required > 0 ? Math.min(100, (shift.assigned / shift.required) * 100) : (shift.assigned > 0 ? 100 : 0)}
              color={coverageColor(shift.assigned, shift.required)}
              sx={{ height: 6, borderRadius: 1, mb: 0.5 }}
            />
            {shift.employees.length > 0 && (
              <AvatarGroup max={{ xs: 3, sm: 5 }} sx={{ justifyContent: "flex-start", mb: 0.5 }}>
                {shift.employees.map((p, i) => (
                  <Tooltip key={`${p.initials}-${i}`} title={p.name} arrow>
                    <Avatar
                      sx={{
                        width: { xs: 20, sm: 24 },
                        height: { xs: 20, sm: 24 },
                        fontSize: { xs: 8, sm: 10 },
                        bgcolor: stColor?.main,
                      }}
                    >
                      {p.initials}
                    </Avatar>
                  </Tooltip>
                ))}
              </AvatarGroup>
            )}
          </Box>
        ))}
      </CardContent>
    </Card>
  );
}

function NightCard({ night }: { night: StationShift }) {
  return (
    <Card
      variant="outlined"
      sx={{
        flex: { xs: "1 1 100%", sm: "1 1 calc(50% - 4px)", md: "1 1 220px" },
        minWidth: { xs: 100, sm: 180, md: 200 },
        borderLeft: `4px solid ${NIGHT_COLOR.main}`,
        bgcolor: NIGHT_COLOR.light,
      }}
    >
      <CardContent sx={{ py: 1.5, px: { xs: 1.5, sm: 2 }, "&:last-child": { pb: 1.5 } }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: NIGHT_COLOR.main, display: "block" }}>
          Nacht (gesamtes Gebäude)
        </Typography>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.25, gap: 1 }}>
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {night.shiftTypeLabel}
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {night.assigned}/{night.required}
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={night.required > 0 ? Math.min(100, (night.assigned / night.required) * 100) : (night.assigned > 0 ? 100 : 0)}
          color={coverageColor(night.assigned, night.required)}
          sx={{ height: 6, borderRadius: 1, mb: 0.5 }}
        />
        {night.employees.length > 0 && (
          <AvatarGroup max={{ xs: 3, sm: 5 }} sx={{ justifyContent: "flex-start" }}>
            {night.employees.map((p, i) => (
              <Tooltip key={`${p.initials}-${i}`} title={p.name} arrow>
                <Avatar
                  sx={{
                    width: { xs: 20, sm: 24 },
                    height: { xs: 20, sm: 24 },
                    fontSize: { xs: 8, sm: 10 },
                    bgcolor: NIGHT_COLOR.main,
                  }}
                >
                  {p.initials}
                </Avatar>
              </Tooltip>
            ))}
          </AvatarGroup>
        )}
      </CardContent>
    </Card>
  );
}
