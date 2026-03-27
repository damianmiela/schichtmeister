export type StaffingRow = {
  shiftType: string;
  minTotalCount: number;
};

/** Same minimum staffing applies every calendar day. */
export function requiredCountsForIsoDate(
  _iso: string,
  staffing: StaffingRow[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of staffing) {
    out[r.shiftType] = (out[r.shiftType] ?? 0) + r.minTotalCount;
  }
  return out;
}

export function assignedCountsForIsoDate(
  iso: string,
  assignments: { date: string; shiftProfileId: string }[],
  profilesById: Record<string, { shiftType: string }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of assignments) {
    if (a.date !== iso) continue;
    const p = profilesById[a.shiftProfileId];
    if (!p) continue;
    out[p.shiftType] = (out[p.shiftType] ?? 0) + 1;
  }
  return out;
}
