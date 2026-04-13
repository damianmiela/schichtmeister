import { prisma } from "@/lib/db/prisma";
import type { PrismaClient } from "@prisma/client";

type TxClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * Create a snapshot of the current schedule state (assignments + metadata).
 * Can be called inside or outside a transaction.
 *
 * @param scheduleId  The schedule to snapshot
 * @param label       Human-readable label, e.g. "Vor Neugenerierung"
 * @param tx          Optional transaction client (if called inside $transaction)
 * @returns           The created ScheduleVersion id, or null if schedule had 0 assignments
 */
export async function snapshotCurrentVersion(
  scheduleId: string,
  label: string,
  tx?: TxClient,
): Promise<string | null> {
  const db = tx ?? prisma;

  // Load current assignments
  const assignments = await db.assignment.findMany({
    where: { scheduleId },
    select: {
      date: true,
      shiftProfileId: true,
      employeeId: true,
      createdByUserId: true,
      stationNumber: true,
      markingRow2: true,
      markingRow3: true,
      dayStatus: true,
    },
  });

  if (assignments.length === 0) return null;

  // Load schedule metadata
  const schedule = await db.schedule.findUniqueOrThrow({
    where: { id: scheduleId },
    select: { scoreReport: true, generationLog: true },
  });

  // Serialize assignments — convert Date to ISO string for portability
  const serialized = assignments.map((a) => ({
    ...a,
    date: a.date.toISOString().slice(0, 10),
  }));

  const version = await db.scheduleVersion.create({
    data: {
      scheduleId,
      label,
      assignmentsJson: JSON.stringify(serialized),
      assignmentCount: assignments.length,
      scoreReport: schedule.scoreReport,
      generationLog: schedule.generationLog,
    },
  });

  return version.id;
}
