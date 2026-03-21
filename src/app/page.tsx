"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import MainLayout from "@/components/layout/MainLayout";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
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
} from "@mui/material";
import PeopleIcon from "@mui/icons-material/People";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

type DashboardSummary = {
  employeeCount: number;
  openWishCount: number;
  openSwapCount: number;
  draftScheduleCount: number;
  publishedScheduleCount: number;
  assignmentsThisWeek: number;
  coveragePct: number | null;
  todayLabel: string;
  todayShifts: {
    shiftType: string;
    shiftTypeLabel: string;
    required: number;
    assigned: number;
    employees: { initials: string; name: string }[];
  }[];
  recentWishes: {
    id: string;
    employeeName: string;
    date: string;
    shiftType: string | null;
    priority: string;
    status: string;
  }[];
};

function priorityDe(p: string) {
  return p === "STRONG" ? "Stark" : "Normal";
}

function wishStatusDe(s: string) {
  if (s === "OPEN") return "Offen";
  if (s === "FULFILLED") return "Erfüllt";
  if (s === "NOT_FULFILLED") return "Abgelehnt";
  return s;
}

export default function DashboardPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (session?.user?.role !== "PLANNER") {
      setLoading(false);
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson<DashboardSummary>("/api/dashboard/summary");
      setData(res);
    } catch (e) {
      if (e instanceof ApiError) {
        const msg =
          e.body &&
          typeof e.body === "object" &&
          e.body !== null &&
          "error" in e.body &&
          typeof (e.body as { error: unknown }).error === "string"
            ? (e.body as { error: string }).error
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

  if (session?.user?.role === "EMPLOYEE") {
    return (
      <MainLayout title="Dashboard">
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Willkommen
            </Typography>
            <Typography color="text.secondary" paragraph>
              Diese Übersicht ist für Planer sichtbar. Sie können Ihre Dienstwünsche und Tauschanfragen über
              die Menüpunkte pflegen.
            </Typography>
            <Button component={Link} href="/wishes" variant="contained" sx={{ mr: 1 }}>
              Dienstwünsche
            </Button>
            <Button component={Link} href="/swaps" variant="outlined">
              Tausch
            </Button>
          </CardContent>
        </Card>
      </MainLayout>
    );
  }

  if (!data) {
    return (
      <MainLayout title="Dashboard">
        {error ? (
          <Alert severity="error">{error}</Alert>
        ) : (
          <Typography color="text.secondary">Keine Daten.</Typography>
        )}
      </MainLayout>
    );
  }

  const stats = [
    {
      title: "Mitarbeiter",
      value: String(data.employeeCount),
      subtitle: "in der Einrichtung",
      icon: <PeopleIcon />,
      color: "#1565c0",
    },
    {
      title: "Diese Woche",
      value: String(data.assignmentsThisWeek),
      subtitle: "Zuweisungen (Mo–So)",
      icon: <EventAvailableIcon />,
      color: "#00897b",
    },
    {
      title: "Offene Wünsche",
      value: String(data.openWishCount),
      subtitle: "zu bearbeiten",
      icon: <WarningAmberIcon />,
      color: "#ed6c02",
    },
    {
      title: "Besetzung heute",
      value: data.coveragePct != null ? `${data.coveragePct}%` : "—",
      subtitle:
        data.todayShifts.length > 0
          ? "nach Mindestbesetzung"
          : "kein Plan / keine Schichten",
      icon: <CheckCircleIcon />,
      color: "#2e7d32",
    },
  ];

  const todayTitle = new Date(`${data.todayLabel}T12:00:00`).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <MainLayout title="Dashboard">
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12 }}>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
            <Chip size="small" label={`Entwürfe: ${data.draftScheduleCount}`} variant="outlined" />
            <Chip
              size="small"
              label={`Veröffentlicht: ${data.publishedScheduleCount}`}
              color="success"
              variant="outlined"
            />
            <Chip
              size="small"
              icon={<SwapHorizIcon sx={{ fontSize: 18 }} />}
              label={`Tausch offen: ${data.openSwapCount}`}
              variant="outlined"
            />
          </Box>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {stats.map((stat) => (
          <Grid size={{ xs: 12, sm: 6, md: 3 }} key={stat.title}>
            <Card>
              <CardContent>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Box>
                    <Typography color="text.secondary" variant="body2">
                      {stat.title}
                    </Typography>
                    <Typography variant="h4" sx={{ my: 1 }}>
                      {stat.value}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {stat.subtitle}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      bgcolor: `${stat.color}15`,
                      borderRadius: 2,
                      p: 1.5,
                      height: "fit-content",
                      color: stat.color,
                    }}
                  >
                    {stat.icon}
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}

        <Grid size={{ xs: 12, md: 8 }}>
          <Card>
            <CardContent>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  mb: 2,
                }}
              >
                <Typography variant="h6">Heute · {todayTitle}</Typography>
                <Button component={Link} href="/schedule" endIcon={<ArrowForwardIcon />} size="small">
                  Zum Monatplan
                </Button>
              </Box>
              {data.todayShifts.length === 0 ? (
                <Typography color="text.secondary">
                  Keine Zuweisungen für heute (oder kein Plan für dieses Datum).
                </Typography>
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Schicht</TableCell>
                        <TableCell>Besetzung</TableCell>
                        <TableCell>Mitarbeiter</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.todayShifts.map((shift) => {
                        const req = shift.required;
                        const pct =
                          req > 0
                            ? Math.min(100, (shift.assigned / req) * 100)
                            : shift.assigned > 0
                              ? 100
                              : 0;
                        const color =
                          req === 0
                            ? "info"
                            : shift.assigned >= req
                              ? "success"
                              : "warning";
                        return (
                          <TableRow key={shift.shiftType}>
                            <TableCell>
                              <Chip
                                label={shift.shiftTypeLabel}
                                size="small"
                                color={
                                  shift.shiftType === "EARLY"
                                    ? "warning"
                                    : shift.shiftType === "LATE"
                                      ? "info"
                                      : "secondary"
                                }
                                sx={{ fontWeight: 500 }}
                              />
                            </TableCell>
                            <TableCell>
                              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                <Box sx={{ flexGrow: 1, maxWidth: 120 }}>
                                  <LinearProgress
                                    variant="determinate"
                                    value={pct}
                                    color={color}
                                    sx={{ height: 8, borderRadius: 1 }}
                                  />
                                </Box>
                                <Typography variant="body2">
                                  {shift.assigned}/{req || "—"}
                                </Typography>
                              </Box>
                            </TableCell>
                            <TableCell>
                              <AvatarGroup max={6} sx={{ justifyContent: "flex-start" }}>
                                {shift.employees.map((p) => (
                                  <Avatar
                                    key={`${shift.shiftType}-${p.initials}-${p.name}`}
                                    sx={{
                                      width: 28,
                                      height: 28,
                                      fontSize: 11,
                                      bgcolor: "primary.main",
                                    }}
                                    title={p.name}
                                  >
                                    {p.initials}
                                  </Avatar>
                                ))}
                              </AvatarGroup>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: "100%" }}>
            <CardContent>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  mb: 2,
                }}
              >
                <Typography variant="h6">Letzte Dienstwünsche</Typography>
                <Chip label={`${data.openWishCount} offen`} size="small" color="warning" />
              </Box>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {data.recentWishes.length === 0 ? (
                  <Typography color="text.secondary">Noch keine Wünsche.</Typography>
                ) : (
                  data.recentWishes.map((wish) => (
                    <Box
                      key={wish.id}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 2,
                        p: 1.5,
                        bgcolor: "background.default",
                        borderRadius: 1,
                      }}
                    >
                      <Avatar sx={{ bgcolor: "primary.light", width: 36, height: 36 }}>
                        {wish.employeeName
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </Avatar>
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={500} noWrap>
                          {wish.employeeName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {new Date(`${wish.date}T12:00:00`).toLocaleDateString("de-DE")} ·{" "}
                          {wish.shiftType ? shiftTypeLabel(wish.shiftType) : "—"}
                        </Typography>
                      </Box>
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, alignItems: "flex-end" }}>
                        <Chip
                          label={priorityDe(wish.priority)}
                          size="small"
                          variant="outlined"
                          color={wish.priority === "STRONG" ? "error" : "default"}
                        />
                        <Chip label={wishStatusDe(wish.status)} size="small" variant="filled" />
                      </Box>
                    </Box>
                  ))
                )}
              </Box>
              <Button fullWidth sx={{ mt: 2 }} variant="outlined" component={Link} href="/wishes">
                Alle Wünsche
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </MainLayout>
  );
}
