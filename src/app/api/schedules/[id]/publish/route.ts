import { NextResponse } from "next/server";
import { ScheduleStatus } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

function serializeSchedule(s: {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: s.id,
    periodStart: toIsoDateOnly(s.periodStart),
    periodEnd: toIsoDateOnly(s.periodEnd),
    status: s.status,
    publishedAt: s.publishedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id } = await context.params;
  const schedule = await prisma.schedule.findFirst({
    where: { id, facilityId: session!.user.facilityId },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  if (schedule.status === ScheduleStatus.PUBLISHED) {
    return NextResponse.json({
      schedule: serializeSchedule(schedule),
      alreadyPublished: true,
    });
  }

  const updated = await prisma.schedule.update({
    where: { id },
    data: {
      status: ScheduleStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });

  return NextResponse.json({
    schedule: serializeSchedule(updated),
    alreadyPublished: false,
  });
}
