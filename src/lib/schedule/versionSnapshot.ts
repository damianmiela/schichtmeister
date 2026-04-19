import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import type { PrismaClient } from "@prisma/client";

type TxClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * Build a deterministic hash of assignment data for dedup.
 * Sorts by employeeId+date so ordering doesn't matter.
 */
function hashAssignments(
  serialized: Array<Record<string, unknown>>,
): string {
  const sorted = [...serialized].sort((a, b) => {
    const keyA = `${a.employeeId}|${a.date}`;
    const keyB = `${b.employeeId}|${b.date}`;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/**
 * Create a snapshot of the current schedule state (assignments + metadata).
 * Skips creation if an identical version (same content hash) already exists.
 * Can be called inside or outside a transaction.
 *
 * @param scheduleId     The schedule to snapshot
 * @param label          Human-readable label, e.g. "Vor Neugenerierung"
 * @param tx             Optional transaction client (if called inside $transaction)
 * @param markAsCurrent  If true, sets schedule.currentVersionId to this version
 * @returns              The existing or created ScheduleVersion id, or null if 0 assignments
 */
export async function snapshotCurrentVersion(
  scheduleId: string,
  label: string,
  tx?: TxClient,
  markAsCurrent?: boolean,
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

  // Serialize assignments — convert Date to ISO string for portability
  const serialized = assignments.map((a) => ({
    ...a,
    date: a.date.toISOString().slice(0, 10),
  }));

  const hash = hashAssignments(serialized);

  // Check if any version with the same content already exists
  const existing = await db.scheduleVersion.findFirst({
    where: { scheduleId, contentHash: hash },
    select: { id: true },
  });

  if (existing) {
    if (markAsCurrent) {
      await db.schedule.update({
        where: { id: scheduleId },
        data: { currentVersionId: existing.id },
      });
    }
    return existing.id;
  }

  // Load schedule metadata
  const schedule = await db.schedule.findUniqueOrThrow({
    where: { id: scheduleId },
    select: { scoreReport: true, generationLog: true, warningsJson: true },
  });

  // Derive warning count from the schedule's current warningsJson.
  // We always persist a number (0 for no warnings) so new snapshots can be
  // distinguished from legacy ones (where the column is still null).
  let warningCount = 0;
  if (schedule.warningsJson) {
    try {
      const parsed = JSON.parse(schedule.warningsJson);
      if (Array.isArray(parsed)) warningCount = parsed.length;
    } catch { /* ignore malformed JSON — treat as 0 */ }
  }

  const version = await db.scheduleVersion.create({
    data: {
      scheduleId,
      label,
      assignmentsJson: JSON.stringify(serialized),
      assignmentCount: assignments.length,
      warningCount,
      contentHash: hash,
      scoreReport: schedule.scoreReport,
      generationLog: schedule.generationLog,
    },
  });

  if (markAsCurrent) {
    await db.schedule.update({
      where: { id: scheduleId },
      data: { currentVersionId: version.id },
    });
  }

  return version.id;
}
