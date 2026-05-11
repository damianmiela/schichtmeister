import { NextResponse } from "next/server";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

type RouteCtx = { params: Promise<{ id: string; versionId: string }> };

const MAX_LABEL_LENGTH = 200;

type StoredAssignment = {
  date: string;
  shiftProfileId: string | null;
  employeeId: string;
  createdByUserId: string;
  stationNumber: number | null;
  markingRow2: string | null;
  markingRow3: string | null;
  dayStatus: string | null;
};

/**
 * DELETE — remove a single version.
 *
 * Three cases when the version being deleted is the schedule's CURRENT
 * (active) version:
 *   a) Other versions exist → auto-restore the next-newest one (so the
 *      planner is never left with a "deleted current" pointer).
 *   b) No other versions exist → clear the schedule's assignments and
 *      null out currentVersionId. Frontend will confirm this case first.
 *
 * Non-active versions just get deleted.
 *
 * Response includes an `action` field so the frontend can show the
 * appropriate toast and decide whether to reload the bundle.
 */
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

  const isActive = schedule.currentVersionId === versionId;

  // Simple case: not the active version — just delete.
  if (!isActive) {
    await prisma.scheduleVersion.delete({ where: { id: versionId } });
    return NextResponse.json({ deleted: true, action: "deleted" });
  }

  // Active version. Find the next-newest remaining version, if any.
  const nextVersion = await prisma.scheduleVersion.findFirst({
    where: { scheduleId, id: { not: versionId } },
    orderBy: { createdAt: "desc" },
  });

  // (a) Other versions exist → auto-restore the next-newest one.
  if (nextVersion) {
    let restoredCount = 0;
    let parsed: StoredAssignment[] | null = null;
    try {
      const raw = JSON.parse(nextVersion.assignmentsJson);
      if (Array.isArray(raw)) parsed = raw as StoredAssignment[];
    } catch {
      parsed = null;
    }
    if (!parsed) {
      return NextResponse.json(
        { error: "Vorherige Version hat fehlerhafte Daten." },
        { status: 500 },
      );
    }
    const inputs = parsed.map((a) => ({
      scheduleId,
      date: new Date(a.date),
      shiftProfileId: a.shiftProfileId,
      employeeId: a.employeeId,
      createdByUserId: a.createdByUserId,
      stationNumber: a.stationNumber,
      markingRow2: a.markingRow2,
      markingRow3: a.markingRow3,
      dayStatus: a.dayStatus,
    }));

    await prisma.$transaction(
      async (tx) => {
        // 1. Wipe current assignments, then write the next-newest version's.
        await tx.assignment.deleteMany({ where: { scheduleId } });
        if (inputs.length > 0) {
          await tx.assignment.createMany({ data: inputs });
        }
        // 2. Point the schedule at the next-newest version.
        await tx.schedule.update({
          where: { id: scheduleId },
          data: {
            scoreReport: nextVersion.scoreReport,
            generationLog: nextVersion.generationLog,
            currentVersionId: nextVersion.id,
          },
        });
        // 3. Now safe to drop the deleted version.
        await tx.scheduleVersion.delete({ where: { id: versionId } });
        restoredCount = inputs.length;
      },
      { maxWait: 20_000, timeout: 300_000 },
    );

    return NextResponse.json({
      deleted: true,
      action: "switched",
      switchedToVersionId: nextVersion.id,
      switchedToLabel: nextVersion.label,
      restoredAssignments: restoredCount,
    });
  }

  // (b) No other versions exist → clear the schedule entirely.
  await prisma.$transaction(
    async (tx) => {
      await tx.assignment.deleteMany({ where: { scheduleId } });
      await tx.schedule.update({
        where: { id: scheduleId },
        data: {
          scoreReport: null,
          generationLog: null,
          currentVersionId: null,
          warningsJson: null,
        },
      });
      await tx.scheduleVersion.delete({ where: { id: versionId } });
    },
    { maxWait: 20_000, timeout: 300_000 },
  );

  return NextResponse.json({ deleted: true, action: "cleared" });
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
