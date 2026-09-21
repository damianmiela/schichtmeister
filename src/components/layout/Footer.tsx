"use client";

import { Box, Typography } from "@mui/material";

/**
 * Site-wide footer. Mounted once from the root layout so every page,
 * sub-page, and view gets the same band at the bottom.
 *
 * Edit the constants below to change the copyright text or the author name
 * without touching the layout.
 */

const COPYRIGHT_YEAR = 2026;
const COPYRIGHT_TEXT = "All rights reserved.";
const AUTHOR_NAME = "Damian Miela";

/** Hard-pinned footer height. Kept in sync with the body padding-bottom and
 *  MainLayout's "minHeight: calc(100vh - <this>)" math so short pages don't
 *  leave a ghost-scroll gap. If you make the footer taller, bump these too:
 *    - src/app/layout.tsx  (paddingBottom)
 *    - src/components/layout/MainLayout.tsx  (minHeight calc) */
export const FOOTER_HEIGHT_PX = 40;

export default function Footer() {
  return (
    <Box
      component="footer"
      sx={{
        // Pinned to the bottom of the viewport, always visible. z-index sits
        // above the MUI Drawer/Sidebar (default 1200) but below modals/dialogs
        // (1300), so it stays on top of the side menu without ever covering
        // an open dialog.
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1250,
        // Pinned height — see FOOTER_HEIGHT_PX. The two-value array lets the
        // mobile breakpoint stack (column) without exploding the height.
        height: { xs: "auto", sm: `${FOOTER_HEIGHT_PX}px` },
        minHeight: `${FOOTER_HEIGHT_PX}px`,
        py: 0,
        px: 2,
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
        bgcolor: "background.paper",
        color: "text.secondary",
        fontSize: "0.78rem",
        borderTop: "1px solid",
        borderColor: "divider",
        backdropFilter: "saturate(180%) blur(6px)",
      }}
    >
      {/* Left: copyright */}
      <Typography variant="caption" sx={{ color: "inherit", fontSize: "0.78rem" }}>
        © {COPYRIGHT_YEAR} {COPYRIGHT_TEXT}
      </Typography>

      {/* Right: author */}
      <Typography variant="caption" sx={{ color: "inherit", fontSize: "0.78rem" }}>
        Created by {AUTHOR_NAME}
      </Typography>
    </Box>
  );
}
