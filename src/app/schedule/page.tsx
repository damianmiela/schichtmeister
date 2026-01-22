import MainLayout from "@/components/layout/MainLayout";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Button,
  Avatar,
  AvatarGroup,
  IconButton,
  Tooltip,
  Paper,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import PublishIcon from "@mui/icons-material/Publish";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import DownloadIcon from "@mui/icons-material/Download";
import AddIcon from "@mui/icons-material/Add";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

// Demo data for the week
const weekDays = [
  { day: "Mo", date: "20", isToday: false },
  { day: "Di", date: "21", isToday: false },
  { day: "Mi", date: "22", isToday: true },
  { day: "Do", date: "23", isToday: false },
  { day: "Fr", date: "24", isToday: false },
  { day: "Sa", date: "25", isToday: false, isWeekend: true },
  { day: "So", date: "26", isToday: false, isWeekend: true },
];

const shifts = [
  { name: "Früh", time: "06:00-14:30", color: "#ff9800", required: 8 },
  { name: "Spät", time: "14:00-22:00", color: "#2196f3", required: 7 },
  { name: "Nacht", time: "21:30-06:30", color: "#9c27b0", required: 3 },
];

// Demo assignments
const assignments: Record<string, Record<string, string[]>> = {
  "20": {
    Früh: ["MM", "TS", "AB", "CD", "EF", "GH", "IJ", "KL"],
    Spät: ["LM", "NO", "PQ", "RS", "TU", "VW", "XY"],
    Nacht: ["ZA", "BC", "DE"],
  },
  "21": {
    Früh: ["MM", "TS", "AB", "CD", "EF", "GH", "IJ", "KL"],
    Spät: ["LM", "NO", "PQ", "RS", "TU", "VW"],
    Nacht: ["ZA", "BC", "DE"],
  },
  "22": {
    Früh: ["MM", "TS", "AB", "CD", "EF", "GH", "IJ", "KL"],
    Spät: ["LM", "NO", "PQ", "RS", "TU", "VW"],
    Nacht: ["ZA", "BC", "DE"],
  },
  "23": {
    Früh: ["MM", "TS", "AB", "CD", "EF", "GH"],
    Spät: ["LM", "NO", "PQ", "RS", "TU", "VW", "XY"],
    Nacht: ["ZA", "BC", "DE"],
  },
  "24": {
    Früh: ["MM", "TS", "AB", "CD", "EF", "GH", "IJ", "KL"],
    Spät: ["LM", "NO", "PQ", "RS", "TU"],
    Nacht: ["ZA", "BC"],
  },
  "25": {
    Früh: ["MM", "TS", "AB", "CD", "EF"],
    Spät: ["LM", "NO", "PQ", "RS"],
    Nacht: ["ZA", "BC"],
  },
  "26": {
    Früh: ["MM", "TS", "AB", "CD", "EF"],
    Spät: ["LM", "NO", "PQ", "RS"],
    Nacht: ["ZA", "BC"],
  },
};

function ShiftCell({
  shift,
  date,
  isWeekend,
}: {
  shift: (typeof shifts)[0];
  date: string;
  isWeekend?: boolean;
}) {
  const assigned = assignments[date]?.[shift.name] || [];
  const isFull = assigned.length >= shift.required;
  const hasWarning = assigned.length < shift.required;

  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.5,
        bgcolor: isWeekend ? "grey.50" : "background.paper",
        border: 1,
        borderColor: hasWarning ? "warning.main" : "divider",
        borderRadius: 1,
        minHeight: 100,
        position: "relative",
        "&:hover": {
          bgcolor: "action.hover",
          cursor: "pointer",
        },
      }}
    >
      {hasWarning && (
        <Tooltip title={`${shift.required - assigned.length} Mitarbeiter fehlen`}>
          <WarningAmberIcon
            sx={{
              position: "absolute",
              top: 4,
              right: 4,
              fontSize: 16,
              color: "warning.main",
            }}
          />
        </Tooltip>
      )}
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
        <Chip
          label={`${assigned.length}/${shift.required}`}
          size="small"
          color={isFull ? "success" : "warning"}
          sx={{ height: 20, fontSize: 11 }}
        />
      </Box>
      <AvatarGroup
        max={4}
        sx={{
          justifyContent: "flex-start",
          "& .MuiAvatar-root": {
            width: 24,
            height: 24,
            fontSize: 10,
            bgcolor: shift.color,
          },
        }}
      >
        {assigned.map((initials) => (
          <Avatar key={initials}>{initials}</Avatar>
        ))}
      </AvatarGroup>
      <IconButton
        size="small"
        sx={{
          position: "absolute",
          bottom: 4,
          right: 4,
          opacity: 0.5,
          "&:hover": { opacity: 1 },
        }}
      >
        <AddIcon fontSize="small" />
      </IconButton>
    </Paper>
  );
}

export default function SchedulePage() {
  return (
    <MainLayout title="Wochenplan">
      {/* Header Actions */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton>
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="h6">KW 4 • 20. - 26. Januar 2026</Typography>
          <IconButton>
            <ChevronRightIcon />
          </IconButton>
          <Chip label="ENTWURF" color="warning" size="small" />
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button variant="outlined" startIcon={<AutoFixHighIcon />}>
            Auto-Planen
          </Button>
          <Button variant="outlined" startIcon={<DownloadIcon />}>
            Export
          </Button>
          <Button variant="contained" startIcon={<PublishIcon />}>
            Veröffentlichen
          </Button>
        </Box>
      </Box>

      {/* Schedule Grid */}
      <Card>
        <CardContent sx={{ p: 0 }}>
          {/* Header Row - Days */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "100px repeat(7, 1fr)",
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            <Box sx={{ p: 2 }}></Box>
            {weekDays.map((day) => (
              <Box
                key={day.date}
                sx={{
                  p: 2,
                  textAlign: "center",
                  bgcolor: day.isToday
                    ? "primary.main"
                    : day.isWeekend
                    ? "grey.100"
                    : "transparent",
                  color: day.isToday ? "white" : "text.primary",
                }}
              >
                <Typography variant="body2" fontWeight={day.isToday ? 600 : 400}>
                  {day.day}
                </Typography>
                <Typography variant="h6" fontWeight={day.isToday ? 600 : 400}>
                  {day.date}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Shift Rows */}
          {shifts.map((shift) => (
            <Box
              key={shift.name}
              sx={{
                display: "grid",
                gridTemplateColumns: "100px repeat(7, 1fr)",
                borderBottom: 1,
                borderColor: "divider",
                "&:last-child": { borderBottom: 0 },
              }}
            >
              {/* Shift Label */}
              <Box
                sx={{
                  p: 2,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  borderRight: 1,
                  borderColor: "divider",
                }}
              >
                <Chip
                  label={shift.name}
                  size="small"
                  sx={{
                    bgcolor: shift.color,
                    color: "white",
                    fontWeight: 500,
                    mb: 0.5,
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  {shift.time}
                </Typography>
              </Box>

              {/* Day Cells */}
              {weekDays.map((day) => (
                <Box key={day.date} sx={{ p: 1 }}>
                  <ShiftCell shift={shift} date={day.date} isWeekend={day.isWeekend} />
                </Box>
              ))}
            </Box>
          ))}
        </CardContent>
      </Card>

      {/* Legend */}
      <Box sx={{ display: "flex", gap: 3, mt: 2, justifyContent: "center" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box
            sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: "#ff9800" }}
          />
          <Typography variant="caption">Frühschicht</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box
            sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: "#2196f3" }}
          />
          <Typography variant="caption">Spätschicht</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box
            sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: "#9c27b0" }}
          />
          <Typography variant="caption">Nachtschicht</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <WarningAmberIcon sx={{ fontSize: 14, color: "warning.main" }} />
          <Typography variant="caption">Unterbesetzt</Typography>
        </Box>
      </Box>
    </MainLayout>
  );
}
