import { NextResponse } from "next/server";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

type RouteCtx = { params: Promise<{ id: string; versionId: string }> };

/** DELETE — remove a single version */
export async function DELETE(_request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id: scheduleId, versionId } = await context.params;
  const facilityId = session!.user.facilityId;

  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, facilityId },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const version = await prisma.scheduleVersion.findFirst({
    where: { id: versionId, scheduleId },
  });
  if (!version) {
    return NextResponse.json({ error: "Version nicht gefunden" }, { status: 404 });
  }

  await prisma.scheduleVersion.delete({ where: { id: versionId } });

  return NextResponse.json({ deleted: true });
}
