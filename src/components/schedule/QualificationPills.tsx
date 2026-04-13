"use client";

import { Box, Tooltip } from "@mui/material";
import {
  generateColorFromAbbreviation,
  contrastTextColor,
} from "@/lib/qualificationColor";

interface QualificationPillsProps {
  qualifications?: { abbreviation: string; name: string; color?: string | null }[];
  tags?: string[];
  compact?: boolean;
}

function pillColor(abbreviation: string, dbColor?: string | null): string {
  if (dbColor) return dbColor;
  return generateColorFromAbbreviation(abbreviation);
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
          const bg = pillColor(q.abbreviation, q.color);
          const fg = contrastTextColor(bg);
          return (
            <Tooltip key={q.abbreviation} title={q.name} arrow>
              <Box
                sx={{
                  minWidth: 20,
                  height,
                  px: "3px",
                  borderRadius: height / 2,
                  bgcolor: bg,
                  color: fg,
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
                {q.abbreviation}
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
        const bg = pillColor(tag);
        const fg = contrastTextColor(bg);
        return (
          <Tooltip key={tag} title={tag} arrow>
            <Box
              sx={{
                minWidth: 20,
                height,
                px: "3px",
                borderRadius: height / 2,
                bgcolor: bg,
                color: fg,
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
              {tag}
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
