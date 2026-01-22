import MainLayout from "@/components/layout/MainLayout";
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
} from "@mui/material";
import PeopleIcon from "@mui/icons-material/People";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

// Demo data
const stats = [
  {
    title: "Mitarbeiter",
    value: "42",
    subtitle: "aktiv",
    icon: <PeopleIcon />,
    color: "#1565c0",
  },
  {
    title: "Diese Woche",
    value: "156",
    subtitle: "geplante Schichten",
    icon: <EventAvailableIcon />,
    color: "#00897b",
  },
  {
    title: "Offene Wünsche",
    value: "8",
    subtitle: "zu bearbeiten",
    icon: <WarningAmberIcon />,
    color: "#ed6c02",
  },
  {
    title: "Besetzung",
    value: "94%",
    subtitle: "diese Woche",
    icon: <CheckCircleIcon />,
    color: "#2e7d32",
  },
];

const todayShifts = [
  {
    type: "Früh",
    time: "06:00 - 14:30",
    required: 8,
    assigned: 8,
    staff: ["MK", "TS", "AB", "CD", "EF", "GH", "IJ", "KL"],
  },
  {
    type: "Spät",
    time: "14:00 - 22:00",
    required: 7,
    assigned: 6,
    staff: ["LM", "NO", "PQ", "RS", "TU", "VW"],
  },
  {
    type: "Nacht",
    time: "21:30 - 06:30",
    required: 3,
    assigned: 3,
    staff: ["XY", "ZA", "BC"],
  },
];

const recentWishes = [
  { name: "Maria Müller", date: "25.01", type: "Früh", priority: "Stark" },
  { name: "Thomas Schmidt", date: "26.01", type: "Frei", priority: "Normal" },
  { name: "Anna Weber", date: "27.01", type: "Spät", priority: "Normal" },
];

export default function DashboardPage() {
  return (
    <MainLayout title="Dashboard">
      <Grid container spacing={3}>
        {/* Stats Cards */}
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

        {/* Today's Shifts */}
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
                <Typography variant="h6">Heute - Mittwoch, 22. Januar</Typography>
                <Button endIcon={<ArrowForwardIcon />} size="small">
                  Zum Wochenplan
                </Button>
              </Box>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Schicht</TableCell>
                      <TableCell>Zeit</TableCell>
                      <TableCell>Besetzung</TableCell>
                      <TableCell>Mitarbeiter</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {todayShifts.map((shift) => (
                      <TableRow key={shift.type}>
                        <TableCell>
                          <Chip
                            label={shift.type}
                            size="small"
                            color={
                              shift.type === "Früh"
                                ? "warning"
                                : shift.type === "Spät"
                                ? "info"
                                : "secondary"
                            }
                            sx={{ fontWeight: 500 }}
                          />
                        </TableCell>
                        <TableCell>{shift.time}</TableCell>
                        <TableCell>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Box sx={{ flexGrow: 1, maxWidth: 100 }}>
                              <LinearProgress
                                variant="determinate"
                                value={(shift.assigned / shift.required) * 100}
                                color={
                                  shift.assigned >= shift.required
                                    ? "success"
                                    : "warning"
                                }
                                sx={{ height: 8, borderRadius: 1 }}
                              />
                            </Box>
                            <Typography variant="body2">
                              {shift.assigned}/{shift.required}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <AvatarGroup max={5} sx={{ justifyContent: "flex-start" }}>
                            {shift.staff.map((initials) => (
                              <Avatar
                                key={initials}
                                sx={{
                                  width: 28,
                                  height: 28,
                                  fontSize: 11,
                                  bgcolor: "primary.main",
                                }}
                              >
                                {initials}
                              </Avatar>
                            ))}
                          </AvatarGroup>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Recent Wishes */}
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
                <Typography variant="h6">Aktuelle Dienstwünsche</Typography>
                <Chip label="8 offen" size="small" color="warning" />
              </Box>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {recentWishes.map((wish, index) => (
                  <Box
                    key={index}
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
                      {wish.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </Avatar>
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="body2" fontWeight={500}>
                        {wish.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {wish.date} • {wish.type}
                      </Typography>
                    </Box>
                    <Chip
                      label={wish.priority}
                      size="small"
                      variant="outlined"
                      color={wish.priority === "Stark" ? "error" : "default"}
                    />
                  </Box>
                ))}
              </Box>
              <Button fullWidth sx={{ mt: 2 }} variant="outlined">
                Alle Wünsche anzeigen
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </MainLayout>
  );
}
