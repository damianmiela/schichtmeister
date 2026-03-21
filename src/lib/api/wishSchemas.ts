import { z } from "zod";
import { parseIsoDateOnly } from "@/lib/api/dateOnly";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const wishCreateBodySchema = z
  .object({
    date: isoDate,
    shiftType: z.enum(["EARLY", "LATE", "NIGHT"]).optional(),
    shiftProfileId: z.string().min(1).optional(),
    priority: z.enum(["NORMAL", "STRONG"]).optional(),
    note: z.string().max(2000).optional().nullable(),
  })
  .refine((b) => b.shiftType != null || b.shiftProfileId != null, {
    message: "shiftType oder shiftProfileId angeben",
    path: ["shiftType"],
  });

export const wishDecideBodySchema = z.object({
  status: z.enum(["FULFILLED", "NOT_FULFILLED"]),
  decisionReason: z.string().max(2000).optional().nullable(),
});

export function parseWishQueryDates(
  fromStr: string | null,
  toStr: string | null,
): { ok: true; from: Date; to: Date } | { ok: false; error: string } {
  const now = new Date();
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 30);
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  defaultTo.setUTCDate(defaultTo.getUTCDate() + 180);

  const fromParsed = fromStr ? parseIsoDateOnly(fromStr) : null;
  const toParsed = toStr ? parseIsoDateOnly(toStr) : null;
  if ((fromStr && !fromParsed) || (toStr && !toParsed)) {
    return { ok: false, error: "Parameter from und to müssen YYYY-MM-DD sein." };
  }
  const from = fromParsed ?? defaultFrom;
  const to = toParsed ?? defaultTo;
  if (to < from) {
    return { ok: false, error: "to darf nicht vor from liegen." };
  }
  return { ok: true, from, to };
}
