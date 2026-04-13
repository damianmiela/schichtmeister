import { NextResponse } from "next/server";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { snapshotCurrentVersion } from "@/lib/schedule/versionSnapshot";

type RouteCtx = { params: Promise<{ id: string }> };

/** GET — list all versions for a schedule */
export async function GET(_request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id: scheduleId } = await context.params;
  const facilityId = session!.user.facilityId;

  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, facilityId },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const versions = await prisma.scheduleVersion.findMany({
    where: { scheduleId },
    select: {
      id: true,
      label: true,
      assignmentCount: true,
      scoreReport: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ versions, currentVersionId: schedule.currentVersionId ?? null });
}

/** POST — manually create a snapshot ("Version speichern") */
export async function POST(_request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id: scheduleId } = await context.params;
  const facilityId = session!.user.facilityId;

  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, facilityId },
  });
  if (!schedule) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  let label = "Manuell gesichert";
  try {
    const body = await _request.json();
    if (typeof body?.label === "string" && body.label.trim()) {
      label = body.label.trim();
    }
  } catch { /* no body or invalid JSON — use default label */ }

  const versionId = await snapshotCurrentVersion(scheduleId, label, undefined, true);

  if (!versionId) {
    return NextResponse.json(
      { error: "Keine Zuweisungen vorhanden — nichts zu sichern" },
      { status: 400 },
    );
  }

  return NextResponse.json({ versionId });
}
