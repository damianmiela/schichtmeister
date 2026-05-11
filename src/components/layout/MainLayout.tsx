"use client";

import { useState } from "react";
import { Box, Toolbar, useMediaQuery, useTheme } from "@mui/material";
import Sidebar, { DRAWER_WIDTH } from "./Sidebar";
import Header from "./Header";
import { useActivityTracker } from "@/hooks/useActivityTracker";

interface MainLayoutProps {
  children: React.ReactNode;
  title: string;
}

export default function MainLayout({ children, title }: MainLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));

  // Activity tracking — lightweight, batched, fire-and-forget
  useActivityTracker();

  return (
    <Box sx={{ display: "flex", minHeight: "calc(100vh - 40px)", bgcolor: "background.default" }}>
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <Header title={title} onMenuToggle={() => setMobileOpen((p) => !p)} />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 1.5, sm: 2, md: 3 },
          width: { xs: "100%", md: `calc(100% - ${DRAWER_WIDTH}px)` },
          maxWidth: "100vw",
          overflow: "hidden",
        }}
      >
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}
