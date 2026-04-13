"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
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
  useMediaQuery,
  useTheme,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import CalendarViewWeekIcon from "@mui/icons-material/CalendarViewWeek";
import TodayIcon from "@mui/icons-material/Today";
import PersonIcon from "@mui/icons-material/Person";
import PeopleIcon from "@mui/icons-material/People";
import SettingsIcon from "@mui/icons-material/Settings";
import AssignmentIcon from "@mui/icons-material/Assignment";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";

const DRAWER_WIDTH = 260;

const menuItems = [
  { text: "Dashboard", icon: <DashboardIcon />, href: "/" },
  { text: "Mitarbeiter", icon: <PeopleIcon />, href: "/employees" },
];

const scheduleItems = [
  { text: "Monatsansicht", icon: <CalendarMonthIcon />, href: "/schedule/month" },
  { text: "Wochenansicht", icon: <CalendarViewWeekIcon />, href: "/schedule/week" },
  { text: "Tagesansicht", icon: <TodayIcon />, href: "/schedule/day" },
  { text: "Mitarbeiteransicht", icon: <PersonIcon />, href: "/schedule/employee" },
];

const secondaryItems = [
  { text: "Schichtprofile", icon: <AssignmentIcon />, href: "/shift-profiles" },
  { text: "Einstellungen", icon: <SettingsIcon />, href: "/settings" },
];

const adminItems = [
  { text: "Admin-Tools", icon: <AdminPanelSettingsIcon />, href: "/admin" },
];

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));

  const handleNavClick = () => {
    if (!isDesktop && onMobileClose) {
      onMobileClose();
    }
  };

  const drawerContent = (
    <>
      <Toolbar sx={{ px: 2, py: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <CalendarMonthIcon color="primary" sx={{ fontSize: 34 }} />
          <Box>
            <Typography
              variant="h6"
              sx={{
                lineHeight: 1.2,
                fontWeight: 700,
                background: "linear-gradient(135deg, #1565c0 0%, #1976d2 50%, #42a5f5 100%)",
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                letterSpacing: "0.02em",
              }}
            >
              Demo-Einrichtung
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              Dienst Planner
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
                onClick={handleNavClick}
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
          Dienstplan
        </Typography>
        <List>
          {scheduleItems.map((item) => {
            const isActive =
              pathname === item.href ||
              pathname?.startsWith(item.href + "?") ||
              (item.href === "/schedule/month" && (pathname === "/schedule" || pathname === "/schedule/"));
            return (
              <ListItem key={item.text} disablePadding sx={{ px: 1 }}>
                <ListItemButton
                  component={Link}
                  href={item.href}
                  selected={isActive}
                  onClick={handleNavClick}
                  sx={{
                    borderRadius: 1,
                    mb: 0.5,
                    py: 0.5,
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
                  <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
                  <ListItemText primary={item.text} primaryTypographyProps={{ fontSize: 14 }} />
                </ListItemButton>
              </ListItem>
            );
          })}
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
                onClick={handleNavClick}
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
        {isAdmin && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography
              variant="overline"
              sx={{ px: 3, color: "error.main", fontSize: 11, fontWeight: 700 }}
            >
              Administration
            </Typography>
            <List>
              {adminItems.map((item) => (
                <ListItem key={item.text} disablePadding sx={{ px: 1 }}>
                  <ListItemButton
                    component={Link}
                    href={item.href}
                    selected={pathname === item.href || pathname?.startsWith(item.href + "/")}
                    onClick={handleNavClick}
                    sx={{
                      borderRadius: 1,
                      mb: 0.5,
                      "&.Mui-selected": {
                        bgcolor: "error.main",
                        color: "white",
                        "&:hover": { bgcolor: "error.dark" },
                        "& .MuiListItemIcon-root": { color: "white" },
                      },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                    <ListItemText primary={item.text} />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </>
        )}
      </Box>
    </>
  );

  if (isDesktop) {
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
        {drawerContent}
      </Drawer>
    );
  }

  return (
    <Drawer
      variant="temporary"
      open={mobileOpen}
      onClose={onMobileClose}
      ModalProps={{ keepMounted: true }}
      sx={{
        "& .MuiDrawer-paper": {
          width: DRAWER_WIDTH,
          boxSizing: "border-box",
          borderRight: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
        },
      }}
    >
      {drawerContent}
    </Drawer>
  );
}

export { DRAWER_WIDTH };
