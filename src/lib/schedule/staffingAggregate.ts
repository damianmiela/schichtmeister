import { localDayOfWeekFromIsoDate } from "@/lib/schedule/viewUtils";

export type StaffingRow = {
  dayOfWeek: number;
  shiftType: string;
  minStaffCount: number;
};

export function requiredCountsForIsoDate(
  iso: string,
  staffing: StaffingRow[],
): Record<string, number> {
  const dow = localDayOfWeekFromIsoDate(iso);
  const out: Record<string, number> = {};
  for (const r of staffing) {
    if (r.dayOfWeek === dow) {
      out[r.shiftType] = (out[r.shiftType] ?? 0) + r.minStaffCount;
    }
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
