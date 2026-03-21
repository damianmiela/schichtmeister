import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export type ApiErrorBody = { error: string; details?: unknown };

export const plannerJsonErrors = {
  unauthorized: () =>
    NextResponse.json({ error: "Nicht angemeldet" } satisfies ApiErrorBody, {
      status: 401,
    }),
  forbidden: () =>
    NextResponse.json({ error: "Keine Berechtigung" } satisfies ApiErrorBody, {
      status: 403,
    }),
};

export async function readJsonUnknown(
  request: NextRequest,
): Promise<
  { ok: true; data: unknown } | { ok: false; response: NextResponse<ApiErrorBody> }
> {
  try {
    const data: unknown = await request.json();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Ungültiges JSON" } satisfies ApiErrorBody,
        { status: 400 },
      ),
    };
  }
}

export function zodErrorResponse(
  error: InstanceType<typeof z.ZodError>,
  message = "Ungültige Eingabe",
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: message, details: error.flatten() } satisfies ApiErrorBody,
    { status: 400 },
  );
}

export async function parseJsonBody<T extends z.ZodType>(
  request: NextRequest,
  schema: T,
): Promise<
  | { ok: true; data: z.infer<T> }
  | { ok: false; response: NextResponse<ApiErrorBody> }
> {
  const raw = await readJsonUnknown(request);
  if (!raw.ok) return raw;
  const parsed = schema.safeParse(raw.data);
  if (!parsed.success) {
    return { ok: false, response: zodErrorResponse(parsed.error) };
  }
  return { ok: true, data: parsed.data };
}

export const hhmmSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Format HH:MM")
  .refine((s) => {
    const [h, m] = s.split(":").map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }, "Ungültige Uhrzeit");
