import { NextResponse } from "next/server";
import { plannerJsonErrors } from "@/lib/api/validation";
import { requirePlanner } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { snapshotCurrentVersion } from "@/lib/schedule/versionSnapshot";

type RouteCtx = { params: Promise<{ id: string; versionId: string }> };

/** POST — restore a version (auto-snapshots current state first) */
export async function POST(_request: Request, context: RouteCtx) {
  const { session, error } = await requirePlanner();
  if (error === "UNAUTHORIZED") return plannerJsonErrors.unauthorized();
  if (error === "FORBIDDEN") return plannerJsonErrors.forbidden();

  const { id: scheduleId, versionId } = await context.params;
  const facilityId = session!.user.facilityId;
  const userId = session!.user.id;

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

  // Parse the stored assignments
  let storedAssignments: Array<{
    date: string;
    shiftProfileId: string | null;
    employeeId: string;
    createdByUserId: string;
    stationNumber: number | null;
    markingRow2: string | null;
    markingRow3: string | null;
    dayStatus: string | null;
  }>;
  try {
    storedAssignments = JSON.parse(version.assignmentsJson);
  } catch {
    return NextResponse.json({ error: "Fehlerhafte Versionsdaten" }, { status: 500 });
  }

  const restoredCount = await prisma.$transaction(
    async (tx) => {
      // 1. Auto-snapshot current state before overwriting
      await snapshotCurrentVersion(scheduleId, "Vor Wiederherstellung", tx);

      // 2. Delete all current assignments
      await tx.assignment.deleteMany({ where: { scheduleId } });

      // 3. Recreate assignments from snapshot
      const inputs = storedAssignments.map((a) => ({
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

      if (inputs.length > 0) {
        await tx.assignment.createMany({ data: inputs });
      }

      // 4. Restore score report, generation log, and mark this version as current
      await tx.schedule.update({
        where: { id: scheduleId },
        data: {
          scoreReport: version.scoreReport,
          generationLog: version.generationLog,
          currentVersionId: versionId,
        },
      });

      return inputs.length;
    },
    { maxWait: 20_000, timeout: 300_000 },
  );

  return NextResponse.json({ restoredAssignments: restoredCount });
}
