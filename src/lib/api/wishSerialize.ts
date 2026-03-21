import type { Wish } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";

export function serializeWish(
  w: Wish,
  employeeName?: string | null,
): Record<string, unknown> {
  return {
    id: w.id,
    employeeId: w.employeeId,
    ...(employeeName != null && employeeName !== ""
      ? { employeeName }
      : {}),
    date: toIsoDateOnly(w.date),
    shiftType: w.shiftType,
    shiftProfileId: w.shiftProfileId,
    priority: w.priority,
    status: w.status,
    note: w.note,
    decisionReason: w.decisionReason,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}
