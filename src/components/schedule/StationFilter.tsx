"use client";

import { Chip, Box } from "@mui/material";
import { STATIONS } from "@/lib/schedule-data";

interface StationFilterProps {
  selected: string | null;
  onChange: (stationId: string | null) => void;
}

export default function StationFilter({ selected, onChange }: StationFilterProps) {
  return (
    <Box sx={{ display: "flex", gap: 1 }}>
      <Chip
        label="Alle"
        color={selected === null ? "primary" : "default"}
        variant={selected === null ? "filled" : "outlined"}
        onClick={() => onChange(null)}
        sx={{ fontWeight: selected === null ? 600 : 400 }}
      />
      {STATIONS.map((station) => (
        <Chip
          key={station.id}
          label={station.name}
          color={selected === station.id ? "primary" : "default"}
          variant={selected === station.id ? "filled" : "outlined"}
          onClick={() => onChange(station.id)}
          sx={{ fontWeight: selected === station.id ? 600 : 400 }}
        />
      ))}
    </Box>
  );
}
