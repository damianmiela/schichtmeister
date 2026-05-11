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
        // Sits at the bottom of every page; pushed away from content by the
        // flex column in the body root (see globals/layout).
        mt: "auto",
        py: 1.5,
        px: 2,
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
        // The logo is transparent and designed for a dark background, so the
        // whole footer band is dark. Text colors are inverted accordingly.
        bgcolor: "#1a1a1a",
        color: "rgba(255,255,255,0.78)",
        fontSize: "0.78rem",
        borderTop: "1px solid rgba(255,255,255,0.06)",
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
          underline="hover"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.75,
            color: "rgba(255,255,255,0.95)",
            fontWeight: 600,
            fontSize: "0.8rem",
            "&:hover": { color: "#fff" },
          }}
        >
          <Image
            src={AGENCY_LOGO_SRC}
            alt={`${AGENCY_NAME} Logo`}
            width={88}
            height={22}
            // Keep aspect ratio flexible — the actual logo proportions are
            // preserved by next/image and the box just provides bounds.
            style={{ height: 22, width: "auto", objectFit: "contain" }}
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
