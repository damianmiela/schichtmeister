import MainLayout from "@/components/layout/MainLayout";
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Switch,
  FormControlLabel,
  Button,
  Divider,
  Grid,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";

export default function SettingsPage() {
  return (
    <MainLayout title="Einstellungen">
      <Grid container spacing={3}>
        {/* Facility Settings */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Einrichtung
              </Typography>
              <Divider sx={{ mb: 3 }} />

              <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <TextField
                  label="Name der Einrichtung"
                  defaultValue="Demo-Einrichtung"
                  fullWidth
                />
                <TextField
                  label="Adresse"
                  defaultValue="Demostraße 1, 12345 Musterstadt"
                  fullWidth
                />
                <TextField label="Telefon" defaultValue="+49 123 456789" fullWidth />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Rules Settings */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Regeln
              </Typography>
              <Divider sx={{ mb: 3 }} />

              <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <TextField
                  label="Mindest-Ruhezeit (Stunden)"
                  type="number"
                  defaultValue="11"
                  helperText="Gesetzliche Mindestruhezeit zwischen Schichten"
                />
                <TextField
                  label="Mini-Job Max. Stunden/Monat"
                  type="number"
                  defaultValue="43"
                  helperText="Maximale Arbeitszeit für Mini-Jobs"
                />
                <FormControlLabel
                  control={<Switch defaultChecked />}
                  label="Überlappende Schichten warnen"
                />
                <FormControlLabel
                  control={<Switch defaultChecked />}
                  label="Unterbesetzung warnen"
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Staffing Requirements */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Mindestbesetzung
              </Typography>
              <Divider sx={{ mb: 3 }} />

              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Box sx={{ display: "flex", gap: 2 }}>
                  <TextField
                    label="Frühschicht"
                    type="number"
                    defaultValue="8"
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="Davon Fachkräfte"
                    type="number"
                    defaultValue="4"
                    sx={{ flex: 1 }}
                  />
                </Box>
                <Box sx={{ display: "flex", gap: 2 }}>
                  <TextField
                    label="Spätschicht"
                    type="number"
                    defaultValue="7"
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="Davon Fachkräfte"
                    type="number"
                    defaultValue="3"
                    sx={{ flex: 1 }}
                  />
                </Box>
                <Box sx={{ display: "flex", gap: 2 }}>
                  <TextField
                    label="Nachtschicht"
                    type="number"
                    defaultValue="3"
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="Davon Fachkräfte"
                    type="number"
                    defaultValue="1"
                    sx={{ flex: 1 }}
                  />
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Notifications */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Benachrichtigungen
              </Typography>
              <Divider sx={{ mb: 3 }} />

              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <FormControlLabel
                  control={<Switch defaultChecked />}
                  label="E-Mail bei neuen Dienstwünschen"
                />
                <FormControlLabel
                  control={<Switch defaultChecked />}
                  label="E-Mail bei Tausch-Anfragen"
                />
                <FormControlLabel
                  control={<Switch />}
                  label="Tägliche Zusammenfassung"
                />
                <TextField
                  label="E-Mail für Benachrichtigungen"
                  type="email"
                  defaultValue="planer@example.com"
                  fullWidth
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Save Button */}
        <Grid size={12}>
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="contained" startIcon={<SaveIcon />} size="large">
              Einstellungen speichern
            </Button>
          </Box>
        </Grid>
      </Grid>
    </MainLayout>
  );
}
