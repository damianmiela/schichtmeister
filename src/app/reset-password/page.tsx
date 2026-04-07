"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
import LockResetIcon from "@mui/icons-material/LockReset";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <Paper elevation={3} sx={{ p: 4 }}>
        <Alert severity="error">
          Ungültiger Link. Bitte fordern Sie einen neuen Zurücksetzungslink an.
        </Alert>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: "center" }}>
          <Link href="/forgot-password" style={{ fontWeight: 600 }}>
            Neuen Link anfordern
          </Link>
        </Typography>
      </Paper>
    );
  }

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

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Ein Fehler ist aufgetreten.");
        return;
      }
      setSuccess(true);
    } catch {
      setError("Ein Fehler ist aufgetreten.");
    } finally {
      setLoading(false);
    }
  };

  return (
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
          <LockResetIcon />
        </Box>
        <Typography variant="h5" component="h1">
          Neues Passwort vergeben
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Geben Sie Ihr neues Passwort ein.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {success ? (
        <>
          <Alert severity="success" sx={{ mb: 2 }}>
            Passwort erfolgreich geändert. Sie können sich jetzt anmelden.
          </Alert>
          <Button
            component={Link}
            href="/login"
            fullWidth
            variant="contained"
            size="large"
          >
            Zur Anmeldung
          </Button>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          <TextField
            fullWidth
            type="password"
            label="Neues Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            autoFocus
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
            disabled={loading || !password || !password2}
          >
            {loading ? <CircularProgress size={24} color="inherit" /> : "Passwort ändern"}
          </Button>
        </form>
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: "center" }}>
        <Link href="/login" style={{ fontWeight: 600 }}>
          Zurück zur Anmeldung
        </Link>
      </Typography>
    </Paper>
  );
}

export default function ResetPasswordPage() {
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
        <Suspense
          fallback={
            <Paper elevation={3} sx={{ p: 4, textAlign: "center" }}>
              <CircularProgress />
            </Paper>
          }
        >
          <ResetPasswordForm />
        </Suspense>
      </Box>
    </Container>
  );
}
