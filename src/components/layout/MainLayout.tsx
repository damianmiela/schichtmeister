"use client";

import { Box, Toolbar } from "@mui/material";
import Sidebar, { DRAWER_WIDTH } from "./Sidebar";
import Header from "./Header";

interface MainLayoutProps {
  children: React.ReactNode;
  title: string;
}

export default function MainLayout({ children, title }: MainLayoutProps) {
  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      <Sidebar />
      <Header title={title} />
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: `calc(100% - ${DRAWER_WIDTH}px)`,
        }}
      >
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}
