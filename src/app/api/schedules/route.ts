import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseIsoDateOnly, toIsoDateOnly } from "@/lib/api/dateOnly";
import { parseJsonBody, plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

const createSchema = z
  .object({
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .superRefine((val, ctx) => {
    const a = parseIsoDateOnly(val.periodStart);
    const b = parseIsoDateOnly(val.periodEnd);
    if (!a || !b) {
      ctx.addIssue({ code: "custom", message: "Ungültiges Datum" });
      return;
    }
    if (b < a) {
      ctx.addIssue({
        code: "custom",
        message: "periodEnd darf nicht vor periodStart liegen",
        path: ["periodEnd"],
      });
    }
  });

function serializeSchedule(s: {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: s.id,
    periodStart: toIsoDateOnly(s.periodStart),
    periodEnd: toIsoDateOnly(s.periodEnd),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function GET() {
  try {
    const { session, error } = await requirePlanner();
    if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
    if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

    const facilityId = session!.user.facilityId;
    if (!facilityId) {
      return NextResponse.json(
        { error: "Keine Einrichtung in der Sitzung. Bitte abmelden und neu anmelden." },
        { status: 403 },
      );
    }

    const schedules = await prisma.schedule.findMany({
      where: { facilityId },
      orderBy: [{ periodStart: "desc" }],
    });
    return NextResponse.json({
      schedules: schedules.map(serializeSchedule),
    });
  } catch (e) {
    console.error("GET /api/schedules", e);
    return NextResponse.json(
      {
        error:
          "Dienstpläne konnten nicht geladen werden (Server oder Datenbank). Bitte später erneut versuchen.",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;

  const periodStart = parseIsoDateOnly(parsed.data.periodStart);
  const periodEnd = parseIsoDateOnly(parsed.data.periodEnd);
  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 });
  }

  try {
    const schedule = await prisma.schedule.create({
      data: {
        facilityId: session!.user.facilityId,
        periodStart,
        periodEnd,
      },
    });
    return NextResponse.json({ schedule: serializeSchedule(schedule) }, { status: 201 });
  } catch (e) {
    console.error("POST /api/schedules", e);
    return NextResponse.json(
      { error: "Dienstplan konnte nicht angelegt werden." },
      { status: 500 },
    );
  }
}
