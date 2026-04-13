"use client";

import { Box, Tooltip } from "@mui/material";

interface QualificationPillsProps {
  qualifications?: { abbreviation: string; name: string }[];
  tags?: string[];
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

export default function QualificationPills({ qualifications, tags, compact }: QualificationPillsProps) {
  const hasQualifications = qualifications && qualifications.length > 0;
  const hasTags = tags && tags.length > 0;
  if (!hasQualifications && !hasTags) return null;

  const height = compact ? 16 : 18;
  const fontSize = compact ? 8 : 9;

  if (hasQualifications) {
    return (
      <Box sx={{ display: "inline-flex", gap: "2px", flexWrap: "wrap", verticalAlign: "middle" }}>
        {qualifications.map((q) => {
          const abbr = q.abbreviation;
          const colorKey = q.abbreviation.charAt(0).toUpperCase();
          return (
            <Tooltip key={q.abbreviation} title={q.name} arrow>
              <Box
                sx={{
                  minWidth: 20,
                  height,
                  px: "3px",
                  borderRadius: height / 2,
                  bgcolor: pillColor(colorKey),
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize,
                  fontWeight: 700,
                  lineHeight: 1,
                  cursor: "default",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                {abbr}
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    );
  }

  return (
    <Box sx={{ display: "inline-flex", gap: "2px", flexWrap: "wrap", verticalAlign: "middle" }}>
      {tags!.map((tag) => {
        const letter = tag.charAt(0).toUpperCase();
        return (
          <Tooltip key={tag} title={tag} arrow>
            <Box
              sx={{
                minWidth: 20,
                height,
                px: "3px",
                borderRadius: height / 2,
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
                whiteSpace: "nowrap",
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
