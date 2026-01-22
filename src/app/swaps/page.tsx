import MainLayout from "@/components/layout/MainLayout";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Avatar,
  Chip,
  Button,
  IconButton,
} from "@mui/material";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";

// Demo data
const swapRequests = [
  {
    id: 1,
    from: { name: "Maria Müller", date: "25.01", shift: "Früh" },
    to: { name: "Thomas Schmidt", date: "25.01", shift: "Spät" },
    status: "offen",
    requestedAt: "Vor 2 Stunden",
  },
  {
    id: 2,
    from: { name: "Anna Weber", date: "27.01", shift: "Nacht" },
    to: { name: "Sandra Becker", date: "27.01", shift: "Nacht" },
    status: "offen",
    requestedAt: "Gestern",
  },
  {
    id: 3,
    from: { name: "Klaus Wagner", date: "23.01", shift: "Früh" },
    to: { name: "Michael Fischer", date: "23.01", shift: "Früh" },
    status: "genehmigt",
    requestedAt: "Vor 3 Tagen",
  },
];

export default function SwapsPage() {
  return (
    <MainLayout title="Tausch-Anfragen">
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {swapRequests.map((swap) => (
          <Card key={swap.id}>
            <CardContent>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                {/* From */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 2, flex: 1 }}>
                  <Avatar sx={{ bgcolor: "primary.main" }}>
                    {swap.from.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </Avatar>
                  <Box>
                    <Typography variant="body1" fontWeight={500}>
                      {swap.from.name}
                    </Typography>
                    <Box sx={{ display: "flex", gap: 1, mt: 0.5 }}>
                      <Chip label={swap.from.date} size="small" variant="outlined" />
                      <Chip
                        label={swap.from.shift}
                        size="small"
                        color={
                          swap.from.shift === "Früh"
                            ? "warning"
                            : swap.from.shift === "Spät"
                            ? "info"
                            : "secondary"
                        }
                      />
                    </Box>
                  </Box>
                </Box>

                {/* Arrow */}
                <Box sx={{ px: 4 }}>
                  <SwapHorizIcon sx={{ fontSize: 32, color: "text.secondary" }} />
                </Box>

                {/* To */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 2, flex: 1 }}>
                  <Avatar sx={{ bgcolor: "secondary.main" }}>
                    {swap.to.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </Avatar>
                  <Box>
                    <Typography variant="body1" fontWeight={500}>
                      {swap.to.name}
                    </Typography>
                    <Box sx={{ display: "flex", gap: 1, mt: 0.5 }}>
                      <Chip label={swap.to.date} size="small" variant="outlined" />
                      <Chip
                        label={swap.to.shift}
                        size="small"
                        color={
                          swap.to.shift === "Früh"
                            ? "warning"
                            : swap.to.shift === "Spät"
                            ? "info"
                            : "secondary"
                        }
                      />
                    </Box>
                  </Box>
                </Box>

                {/* Status & Actions */}
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    pl: 4,
                    borderLeft: 1,
                    borderColor: "divider",
                  }}
                >
                  <Box sx={{ textAlign: "right" }}>
                    <Chip
                      label={swap.status}
                      size="small"
                      color={swap.status === "offen" ? "warning" : "success"}
                    />
                    <Typography
                      variant="caption"
                      display="block"
                      color="text.secondary"
                      sx={{ mt: 0.5 }}
                    >
                      {swap.requestedAt}
                    </Typography>
                  </Box>
                  {swap.status === "offen" && (
                    <Box>
                      <IconButton color="success">
                        <CheckIcon />
                      </IconButton>
                      <IconButton color="error">
                        <CloseIcon />
                      </IconButton>
                    </Box>
                  )}
                </Box>
              </Box>
            </CardContent>
          </Card>
        ))}

        {swapRequests.length === 0 && (
          <Card>
            <CardContent sx={{ textAlign: "center", py: 6 }}>
              <SwapHorizIcon sx={{ fontSize: 48, color: "text.disabled", mb: 2 }} />
              <Typography color="text.secondary">
                Keine Tausch-Anfragen vorhanden
              </Typography>
            </CardContent>
          </Card>
        )}
      </Box>
    </MainLayout>
  );
}
