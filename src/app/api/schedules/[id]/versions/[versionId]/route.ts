import { NextResponse } from "next/server";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

type RouteCtx = { params: Promise<{ id: string; versionId: string }> };

const MAX_LABEL_LENGTH = 200;

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

/** PATCH — rename a version (update label) */
export async function PATCH(request: Request, context: RouteCtx) {
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

  let label: string | undefined;
  try {
    const body = await request.json();
    if (typeof body?.label === "string") label = body.label.trim();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  if (!label) {
    return NextResponse.json({ error: "Name darf nicht leer sein" }, { status: 400 });
  }
  if (label.length > MAX_LABEL_LENGTH) {
    return NextResponse.json(
      { error: `Name darf maximal ${MAX_LABEL_LENGTH} Zeichen lang sein` },
      { status: 400 },
    );
  }

  const updated = await prisma.scheduleVersion.update({
    where: { id: versionId },
    data: { label },
    select: { id: true, label: true },
  });

  return NextResponse.json({ version: updated });
}
