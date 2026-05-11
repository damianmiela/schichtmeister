"use client";

import Image from "next/image";
import { Box, Typography, Link as MuiLink } from "@mui/material";

/**
 * Site-wide footer. Mounted once from the root layout so every page,
 * sub-page, and view gets the same band at the bottom.
 *
 * Edit the constants below to change copyright text, agency name, link,
 * or logo without touching the layout.
 */

const COPYRIGHT_YEAR = 2026;
const COPYRIGHT_TEXT = "All rights reserved.";
const AGENCY_NAME = "DEN Digital";
const AGENCY_URL = "https://www.dendigital.de";
/** Path served from /public — replace the file there to swap logos. */
const AGENCY_LOGO_SRC = "/dendigital-logo.png";

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
        py: 0.75,
        px: 2,
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
        // Footer matches the rest of the page now — only the logo gets a
        // dark backdrop (see below) since the artwork was designed for it.
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

      {/* Right: "Created by" + DEN Digital logo + link */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="caption" sx={{ color: "inherit", fontSize: "0.78rem" }}>
          Created by
        </Typography>
        <MuiLink
          href={AGENCY_URL}
          target="_blank"
          rel="noopener noreferrer"
          underline="none"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.75,
            // The logo's transparent artwork was designed for a dark
            // backdrop, so the link wrapper itself acts as that backdrop —
            // a small rounded dark pill that hugs the logo only, leaving
            // the rest of the footer flush with the page.
            bgcolor: "#1a1a1a",
            borderRadius: "6px",
            px: 1,
            py: 0.4,
            color: "rgba(255,255,255,0.95)",
            fontWeight: 600,
            fontSize: "0.8rem",
            transition: "background-color 0.15s, box-shadow 0.15s",
            "&:hover": {
              bgcolor: "#000",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.18)",
            },
          }}
        >
          <Image
            src={AGENCY_LOGO_SRC}
            alt={`${AGENCY_NAME} Logo`}
            width={88}
            height={20}
            // Keep aspect ratio flexible — the actual logo proportions are
            // preserved by next/image and the box just provides bounds.
            style={{ height: 20, width: "auto", objectFit: "contain", display: "block" }}
            priority={false}
          />
          {/* Screen-reader-only name (logo conveys it visually). */}
          <Box
            component="span"
            sx={{
              position: "absolute",
              width: "1px",
              height: "1px",
              overflow: "hidden",
              clip: "rect(0 0 0 0)",
              whiteSpace: "nowrap",
            }}
          >
            {AGENCY_NAME}
          </Box>
        </MuiLink>
      </Box>
    </Box>
  );
}
