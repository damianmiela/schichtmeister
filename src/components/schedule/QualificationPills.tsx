"use client";

import { Box, Tooltip } from "@mui/material";

interface QualificationPillsProps {
  tags: string[];
  /** Compact mode uses smaller pills (for dense table cells) */
  compact?: boolean;
}

const TAG_COLORS: Record<string, string> = {
  F: "#1565c0",
  N: "#2e7d32",
  P: "#6a1b9a",
  A: "#c62828",
  H: "#e65100",
};

function pillColor(letter: string): string {
  return TAG_COLORS[letter] ?? "#546e7a";
}

export default function QualificationPills({ tags, compact }: QualificationPillsProps) {
  if (!tags || tags.length === 0) return null;
  const size = compact ? 16 : 18;
  const fontSize = compact ? 9 : 10;
  return (
    <Box sx={{ display: "inline-flex", gap: "2px", flexWrap: "wrap", verticalAlign: "middle" }}>
      {tags.map((tag) => {
        const letter = tag.charAt(0).toUpperCase();
        return (
          <Tooltip key={tag} title={tag} arrow>
            <Box
              sx={{
                width: size,
                height: size,
                borderRadius: "50%",
                bgcolor: pillColor(letter),
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize,
                fontWeight: 700,
                lineHeight: 1,
                cursor: "default",
                flexShrink: 0,
              }}
            >
              {letter}
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
