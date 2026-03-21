"use client";

import { Box, Paper, Typography } from "@mui/material";
import EventBusyIcon from "@mui/icons-material/EventBusy";

interface ScheduleDataPlaceholderProps {
  title?: string;
}

export default function ScheduleDataPlaceholder({
  title = "Dienstplan",
}: ScheduleDataPlaceholderProps) {
  return (
    <Paper
      elevation={0}
      variant="outlined"
      sx={{
        p: 4,
        textAlign: "center",
        borderStyle: "dashed",
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <EventBusyIcon sx={{ fontSize: 48, color: "text.secondary" }} />
        <Typography variant="h6" color="text.secondary">
          {title}: noch keine API-Anbindung
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480 }}>
          Es werden keine Demo-Daten mehr angezeigt. Sobald die Terminplanung an die Datenbank
          angebunden ist (spätere Phase), erscheinen hier echte Schichten und Besetzung.
        </Typography>
      </Box>
    </Paper>
  );
}
