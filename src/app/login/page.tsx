"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Alert,
  CircularProgress,
  Divider,
} from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";

// The public demo login seeded by prisma/seed.ts (also listed in the README)
const DEMO_EMAIL = "demo@schichtmeister.local";
const DEMO_PASSWORD = "demo1234";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const justRegistered = searchParams.get("registered") === "1";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login(email, password);
  };

  const login = async (loginEmail: string, loginPassword: string) => {
    setError("");
    setLoading(true);

    try {
      const res = await signIn("credentials", {
        email: loginEmail.trim().toLowerCase(),
        password: loginPassword,
        redirect: false,
      });

      if (res?.error) {
        setError("E-Mail oder Passwort ist falsch.");
        return;
      }

      const from = searchParams.get("from") || "/";
      router.push(from);
      router.refresh();
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
          <LockOutlinedIcon />
        </Box>
        <Typography variant="h5" component="h1">
          SchichtMeister
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Mit E-Mail und Passwort anmelden
        </Typography>
      </Box>

      {justRegistered && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Registrierung erfolgreich. Bitte melden Sie sich an.
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

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
        <TextField
          fullWidth
          type="password"
          label="Passwort"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={loading}
          sx={{ mb: 2 }}
        />
        <Button
          type="submit"
          fullWidth
          variant="contained"
          size="large"
          disabled={loading || !email || !password}
        >
          {loading ? "Wird geprüft…" : "Anmelden"}
        </Button>
      </form>

      <Divider sx={{ my: 3 }} />
      <Box sx={{ textAlign: "center" }}>
        <Button
          fullWidth
          variant="outlined"
          size="large"
          disabled={loading}
          onClick={() => login(DEMO_EMAIL, DEMO_PASSWORD)}
        >
          Try the demo
        </Button>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          Or sign in with <strong>{DEMO_EMAIL}</strong> / <strong>{DEMO_PASSWORD}</strong>.
          Change anything you like, the data resets every night.
        </Typography>
      </Box>

      <Box sx={{ mt: 2, textAlign: "center" }}>
        {/* "Passwort vergessen" is hidden because the reset flow isn't wired
            up yet. The /forgot-password route still exists — re-enable this
            block once the flow is finished. */}
        {/*
        <Typography variant="body2" color="text.secondary">
          <Link href="/forgot-password" style={{ fontWeight: 600 }}>
            Passwort vergessen?
          </Link>
        </Typography>
        */}
        {/* Registration is intentionally hidden — the /register route still
            exists and works, we just don't surface it on the login screen yet.
            Re-enable by uncommenting this block when public sign-up is wanted. */}
        {/*
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Noch kein Konto?{" "}
          <Link href="/register" style={{ fontWeight: 600 }}>
            Registrieren
          </Link>
        </Typography>
        */}
      </Box>
    </Paper>
  );
}

function LoginLoading() {
  return (
    <Paper elevation={3} sx={{ p: 4, textAlign: "center" }}>
      <CircularProgress />
    </Paper>
  );
}

export default function LoginPage() {
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
        <Suspense fallback={<LoginLoading />}>
          <LoginForm />
        </Suspense>
      </Box>
    </Container>
  );
}
