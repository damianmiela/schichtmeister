"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Box,
  Typography,
  Divider,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import PeopleIcon from "@mui/icons-material/People";
import EventNoteIcon from "@mui/icons-material/EventNote";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import SettingsIcon from "@mui/icons-material/Settings";
import AssignmentIcon from "@mui/icons-material/Assignment";

const DRAWER_WIDTH = 260;

const menuItems = [
  { text: "Dashboard", icon: <DashboardIcon />, href: "/" },
  { text: "Wochenplan", icon: <CalendarMonthIcon />, href: "/schedule" },
  { text: "Mitarbeiter", icon: <PeopleIcon />, href: "/employees" },
  { text: "Dienstwünsche", icon: <EventNoteIcon />, href: "/wishes" },
  { text: "Tausch-Anfragen", icon: <SwapHorizIcon />, href: "/swaps" },
];

const secondaryItems = [
  { text: "Schichtprofile", icon: <AssignmentIcon />, href: "/shift-profiles" },
  { text: "Einstellungen", icon: <SettingsIcon />, href: "/settings" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width: DRAWER_WIDTH,
          boxSizing: "border-box",
          borderRight: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
        },
      }}
    >
      <Toolbar sx={{ px: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <CalendarMonthIcon color="primary" sx={{ fontSize: 32 }} />
          <Box>
            <Typography variant="h6" color="primary" sx={{ lineHeight: 1.2 }}>
              SchichtMeister
            </Typography>
            <Typography variant="caption" color="text.secondary">
              DienstPlanner
            </Typography>
          </Box>
        </Box>
      </Toolbar>
      <Divider />
      <Box sx={{ overflow: "auto", mt: 1 }}>
        <List>
          {menuItems.map((item) => (
            <ListItem key={item.text} disablePadding sx={{ px: 1 }}>
              <ListItemButton
                component={Link}
                href={item.href}
                selected={pathname === item.href}
                sx={{
                  borderRadius: 1,
                  mb: 0.5,
                  "&.Mui-selected": {
                    bgcolor: "primary.main",
                    color: "white",
                    "&:hover": {
                      bgcolor: "primary.dark",
                    },
                    "& .MuiListItemIcon-root": {
                      color: "white",
                    },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                <ListItemText primary={item.text} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
        <Divider sx={{ my: 2 }} />
        <Typography
          variant="overline"
          sx={{ px: 3, color: "text.secondary", fontSize: 11 }}
        >
          Verwaltung
        </Typography>
        <List>
          {secondaryItems.map((item) => (
            <ListItem key={item.text} disablePadding sx={{ px: 1 }}>
              <ListItemButton
                component={Link}
                href={item.href}
                selected={pathname === item.href}
                sx={{
                  borderRadius: 1,
                  mb: 0.5,
                  "&.Mui-selected": {
                    bgcolor: "primary.main",
                    color: "white",
                    "&:hover": {
                      bgcolor: "primary.dark",
                    },
                    "& .MuiListItemIcon-root": {
                      color: "white",
                    },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                <ListItemText primary={item.text} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Box>
    </Drawer>
  );
}

export { DRAWER_WIDTH };
