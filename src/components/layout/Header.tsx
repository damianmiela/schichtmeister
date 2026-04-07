"use client";

import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box,
  Avatar,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Alert,
  CircularProgress,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { DRAWER_WIDTH } from "./Sidebar";
import { fetchJson } from "@/lib/api/fetchJson";

interface HeaderProps {
  title: string;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Guten Morgen";
  if (hour < 18) return "Guten Nachmittag";
  return "Guten Abend";
}

export default function Header({ title }: HeaderProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const { data: session, update: updateSession } = useSession();

  // Profile dialog
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const openProfile = useCallback(() => {
    setProfileName(session?.user?.name ?? "");
    setProfileEmail(session?.user?.email ?? "");
    setCurrentPassword("");
    setNewPassword("");
    setProfileError(null);
    setProfileSuccess(null);
    setProfileOpen(true);
    handleClose();
  }, [session]);

  const handleProfileSave = async () => {
    setProfileBusy(true);
    setProfileError(null);
    setProfileSuccess(null);
    try {
      const body: Record<string, string> = {
        name: profileName,
        email: profileEmail,
      };
      if (newPassword) {
        body.currentPassword = currentPassword;
        body.newPassword = newPassword;
      }
      await fetchJson("/api/profile", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setProfileSuccess("Profil aktualisiert. Bitte neu anmelden um Änderungen zu sehen.");
      // Trigger session refresh
      void updateSession();
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setProfileBusy(false);
    }
  };

  const displayName = session?.user?.name || session?.user?.email?.split("@")[0] || "?";
  const initials = displayName.includes(" ")
    ? displayName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()
    : displayName.slice(0, 2).toUpperCase();

  return (
    <>
      <AppBar
        position="fixed"
        color="inherit"
        sx={{
          width: `calc(100% - ${DRAWER_WIDTH}px)`,
          ml: `${DRAWER_WIDTH}px`,
        }}
      >
        <Toolbar>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h5" component="h1">
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: -0.5 }}>
              {getGreeting()}, {displayName}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton onClick={handleMenu}>
              <Avatar sx={{ bgcolor: "primary.main", width: 36, height: 36 }}>
                {initials}
              </Avatar>
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleClose}
              anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
              transformOrigin={{ vertical: "top", horizontal: "right" }}
            >
              <MenuItem disabled sx={{ opacity: "1 !important", fontSize: 12 }}>
                {session?.user?.email}
              </MenuItem>
              <MenuItem onClick={openProfile}>Profil</MenuItem>
              <MenuItem
                onClick={() => {
                  handleClose();
                  void signOut({ callbackUrl: "/login" });
                }}
              >
                Abmelden
              </MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Profile edit dialog */}
      <Dialog
        open={profileOpen}
        onClose={() => !profileBusy && setProfileOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Profil bearbeiten</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            {profileError && (
              <Alert severity="error" onClose={() => setProfileError(null)}>
                {profileError}
              </Alert>
            )}
            {profileSuccess && (
              <Alert severity="success" onClose={() => setProfileSuccess(null)}>
                {profileSuccess}
              </Alert>
            )}
            <TextField
              label="Name"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              fullWidth
              size="small"
              placeholder="Ihr Name"
            />
            <TextField
              label="E-Mail"
              type="email"
              value={profileEmail}
              onChange={(e) => setProfileEmail(e.target.value)}
              fullWidth
              size="small"
            />
            <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1 }}>
              Passwort ändern (optional)
            </Typography>
            <TextField
              label="Aktuelles Passwort"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Neues Passwort"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              fullWidth
              size="small"
              helperText="Mindestens 8 Zeichen. Leer lassen, wenn nicht ändern."
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProfileOpen(false)} disabled={profileBusy}>
            Abbrechen
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleProfileSave()}
            disabled={profileBusy || !profileEmail}
          >
            {profileBusy ? <CircularProgress size={20} /> : "Speichern"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
