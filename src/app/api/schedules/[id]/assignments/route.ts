import { NextRequest, NextResponse } from "next/server";
import { parseIsoDateOnly, toIsoDateOnly } from "@/lib/api/dateOnly";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

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

  const { id: scheduleId } = await context.params;
  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, facilityId: session!.user.facilityId },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const fromStr = request.nextUrl.searchParams.get("from");
  const toStr = request.nextUrl.searchParams.get("to");
  const from = fromStr ? parseIsoDateOnly(fromStr) : null;
  const to = toStr ? parseIsoDateOnly(toStr) : null;
  if ((fromStr && !from) || (toStr && !to)) {
    return NextResponse.json(
      { error: "Parameter from/to müssen YYYY-MM-DD sein." },
      { status: 400 },
    );
  }

  const where: {
    scheduleId: string;
    date?: { gte?: Date; lte?: Date };
  } = { scheduleId };
  if (from && to) {
    where.date = { gte: from, lte: to };
  } else if (from) {
    where.date = { gte: from };
  } else if (to) {
    where.date = { lte: to };
  }

  const assignments = await prisma.assignment.findMany({
    where,
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  return NextResponse.json({
    assignments: assignments.map(serializeAssignment),
  });
}
