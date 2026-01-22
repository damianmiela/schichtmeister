import MainLayout from "@/components/layout/MainLayout";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Chip,
  Button,
  IconButton,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import AccessTimeIcon from "@mui/icons-material/AccessTime";

// Demo data
const shiftProfiles = [
  {
    id: 1,
    name: "Früh 100%",
    type: "Früh",
    start: "06:00",
    end: "14:30",
    break: 30,
    hours: 8,
    color: "#ff9800",
    active: true,
  },
  {
    id: 2,
    name: "Früh 75%",
    type: "Früh",
    start: "06:00",
    end: "12:00",
    break: 0,
    hours: 6,
    color: "#ff9800",
    active: true,
  },
  {
    id: 3,
    name: "Spät 100%",
    type: "Spät",
    start: "14:00",
    end: "22:00",
    break: 30,
    hours: 7.5,
    color: "#2196f3",
    active: true,
  },
  {
    id: 4,
    name: "Spät 75%",
    type: "Spät",
    start: "14:00",
    end: "20:00",
    break: 0,
    hours: 6,
    color: "#2196f3",
    active: true,
  },
  {
    id: 5,
    name: "Nacht",
    type: "Nacht",
    start: "21:30",
    end: "06:30",
    break: 30,
    hours: 8.5,
    color: "#9c27b0",
    active: true,
  },
  {
    id: 6,
    name: "Tagdienst",
    type: "Sonder",
    start: "08:00",
    end: "16:00",
    break: 30,
    hours: 7.5,
    color: "#607d8b",
    active: false,
  },
];

export default function ShiftProfilesPage() {
  return (
    <MainLayout title="Schichtprofile">
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 3 }}>
        <Button variant="contained" startIcon={<AddIcon />}>
          Neues Profil
        </Button>
      </Box>

      <Grid container spacing={3}>
        {shiftProfiles.map((profile) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={profile.id}>
            <Card
              sx={{
                opacity: profile.active ? 1 : 0.6,
                borderLeft: 4,
                borderColor: profile.color,
              }}
            >
              <CardContent>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    mb: 2,
                  }}
                >
                  <Box>
                    <Typography variant="h6">{profile.name}</Typography>
                    <Chip
                      label={profile.type}
                      size="small"
                      sx={{ bgcolor: profile.color, color: "white", mt: 0.5 }}
                    />
                  </Box>
                  <IconButton size="small">
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Box>

                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                  <AccessTimeIcon fontSize="small" color="action" />
                  <Typography>
                    {profile.start} - {profile.end}
                  </Typography>
                </Box>

                <Box sx={{ display: "flex", gap: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {profile.hours}h Arbeitszeit
                  </Typography>
                  {profile.break > 0 && (
                    <Typography variant="body2" color="text.secondary">
                      {profile.break}min Pause
                    </Typography>
                  )}
                </Box>

                <Box sx={{ mt: 2 }}>
                  <Chip
                    label={profile.active ? "Aktiv" : "Inaktiv"}
                    size="small"
                    color={profile.active ? "success" : "default"}
                    variant="outlined"
                  />
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </MainLayout>
  );
}
