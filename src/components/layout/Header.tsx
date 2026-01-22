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
  Chip,
} from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import { useState } from "react";
import { DRAWER_WIDTH } from "./Sidebar";

interface HeaderProps {
  title: string;
}

export default function Header({ title }: HeaderProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <AppBar
      position="fixed"
      color="inherit"
      sx={{
        width: `calc(100% - ${DRAWER_WIDTH}px)`,
        ml: `${DRAWER_WIDTH}px`,
      }}
    >
      <Toolbar>
        <Typography variant="h5" component="h1" sx={{ flexGrow: 1 }}>
          {title}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Chip
            label="Januar 2026"
            variant="outlined"
            color="primary"
            size="small"
          />
          <IconButton color="inherit">
            <NotificationsIcon />
          </IconButton>
          <IconButton onClick={handleMenu}>
            <Avatar sx={{ bgcolor: "primary.main", width: 36, height: 36 }}>
              P
            </Avatar>
          </IconButton>
          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={handleClose}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
          >
            <MenuItem onClick={handleClose}>Profil</MenuItem>
            <MenuItem onClick={handleClose}>Abmelden</MenuItem>
          </Menu>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
