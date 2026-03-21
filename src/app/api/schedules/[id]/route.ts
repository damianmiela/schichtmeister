import { NextRequest, NextResponse } from "next/server";
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

function serializeAssignment(a: {
  id: string;
  scheduleId: string;
  date: Date;
  shiftProfileId: string;
  employeeId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: a.id,
    scheduleId: a.scheduleId,
    date: toIsoDateOnly(a.date),
    shiftProfileId: a.shiftProfileId,
    employeeId: a.employeeId,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteCtx) {
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

  const include = request.nextUrl.searchParams.get("include") ?? "";
  const withAssignments = include.split(",").map((s) => s.trim()).includes("assignments");

  const body: Record<string, unknown> = { schedule: serializeSchedule(schedule) };

  if (withAssignments) {
    const assignments = await prisma.assignment.findMany({
      where: { scheduleId: id },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    body.assignments = assignments.map(serializeAssignment);
  }

  return NextResponse.json(body);
}
