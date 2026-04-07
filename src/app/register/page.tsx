"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Alert,
  CircularProgress,
} from "@mui/material";
import PersonAddOutlinedIcon from "@mui/icons-material/PersonAddOutlined";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [secretPassword, setSecretPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== password2) {
      setError("Passwörter stimmen nicht überein.");
      return;
    }
    if (password.length < 8) {
      setError("Passwort mindestens 8 Zeichen.");
      return;
    }
    if (!secretPassword) {
      setError("Registrierungspasswort erforderlich.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          secretPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Registrierung fehlgeschlagen.");
        return;
      }
      router.push("/login?registered=1");
      router.refresh();
    } catch {
      setError("Ein Fehler ist aufgetreten.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="xs">
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <Paper elevation={3} sx={{ p: 4 }}>
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              mb: 3,
            }}
          >
            <Box
              sx={{
                bgcolor: "primary.main",
                color: "white",
                borderRadius: "50%",
                p: 1.5,
                mb: 2,
              }}
            >
              <PersonAddOutlinedIcon />
            </Box>
            <Typography variant="h5" component="h1">
              Konto anlegen
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: "center" }}>
              Zum Registrieren benötigen Sie das Registrierungspasswort.
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              type="password"
              label="Registrierungspasswort"
              value={secretPassword}
              onChange={(e) => setSecretPassword(e.target.value)}
              disabled={loading}
              sx={{ mb: 2 }}
              helperText="Fragen Sie Ihren Administrator nach dem Passwort"
            />
            <TextField
              fullWidth
              type="email"
              label="E-Mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              disabled={loading}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              type="password"
              label="Passwort"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              type="password"
              label="Passwort wiederholen"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              autoComplete="new-password"
              disabled={loading}
              sx={{ mb: 2 }}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              disabled={loading || !email || !password || !password2 || !secretPassword}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : "Registrieren"}
            </Button>
          </form>

          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: "center" }}>
            Bereits registriert?{" "}
            <Link href="/login" style={{ fontWeight: 600 }}>
              Anmelden
            </Link>
          </Typography>
        </Paper>
      </Box>
    </Container>
  );
}
