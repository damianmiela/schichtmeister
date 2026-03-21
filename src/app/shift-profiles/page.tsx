"use client";

import { useCallback, useEffect, useState } from "react";
import MainLayout from "@/components/layout/MainLayout";
import { ApiError, fetchJson } from "@/lib/api/fetchJson";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Chip,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
} from "@mui/material";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import { shiftTypeLabel } from "@/lib/schedule/viewUtils";

type ShiftProfile = {
  id: string;
  name: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  isActive: boolean;
};

const TYPE_BORDER: Record<string, string> = {
  EARLY: "#ff9800",
  LATE: "#2196f3",
  NIGHT: "#9c27b0",
};

export default function ShiftProfilesPage() {
  const [profiles, setProfiles] = useState<ShiftProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson<{ shiftProfiles: ShiftProfile[] }>("/api/shift-profiles");
      setProfiles(res.shiftProfiles);
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
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (p: ShiftProfile) => {
    setBusyId(p.id);
    try {
      await fetchJson(`/api/shift-profiles/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !p.isActive }),
      });
      await load();
    } catch {
      setError("Aktualisierung fehlgeschlagen.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <MainLayout title="Schichtprofile">
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={3}>
          {profiles.map((profile) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={profile.id}>
              <Card
                sx={{
                  opacity: profile.isActive ? 1 : 0.65,
                  borderLeft: 4,
                  borderColor: TYPE_BORDER[profile.shiftType] ?? "grey.500",
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
                        label={shiftTypeLabel(profile.shiftType)}
                        size="small"
                        sx={{
                          bgcolor: TYPE_BORDER[profile.shiftType] ?? "grey.500",
                          color: "white",
                          mt: 0.5,
                        }}
                      />
                    </Box>
                  </Box>

                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                    <AccessTimeIcon fontSize="small" color="action" />
                    <Typography>
                      {profile.startTime} – {profile.endTime}
                    </Typography>
                  </Box>

                  <Typography variant="body2" color="text.secondary">
                    Pause {profile.breakMinutes} min
                  </Typography>

                  <Box sx={{ mt: 2 }}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={profile.isActive}
                          disabled={busyId === profile.id}
                          onChange={() => void toggleActive(profile)}
                        />
                      }
                      label={profile.isActive ? "Aktiv" : "Inaktiv"}
                    />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </MainLayout>
  );
}
