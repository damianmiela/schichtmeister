"use client";

import { useState } from "react";
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
import MailOutlineIcon from "@mui/icons-material/MailOutline";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Ein Fehler ist aufgetreten.");
        return;
      }
      setSent(true);
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
                bgcolor: "warning.main",
                color: "white",
                borderRadius: "50%",
                p: 1.5,
                mb: 2,
              }}
            >
              <MailOutlineIcon />
            </Box>
            <Typography variant="h5" component="h1">
              Passwort vergessen
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: "center" }}>
              Geben Sie Ihre E-Mail-Adresse ein. Sie erhalten einen Link zum Zurücksetzen.
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {sent ? (
            <Alert severity="success" sx={{ mb: 2 }}>
              Falls ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet. Bitte prüfen Sie Ihr Postfach.
            </Alert>
          ) : (
            <form onSubmit={handleSubmit}>
              <TextField
                fullWidth
                type="email"
                label="E-Mail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                disabled={loading}
                sx={{ mb: 2 }}
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={loading || !email}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : "Link senden"}
              </Button>
            </form>
          )}

          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: "center" }}>
            <Link href="/login" style={{ fontWeight: 600 }}>
              Zurück zur Anmeldung
            </Link>
          </Typography>
        </Paper>
      </Box>
    </Container>
  );
}
