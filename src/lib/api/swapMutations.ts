import type { Prisma } from "@prisma/client";
import { SwapStatus } from "@prisma/client";
import { validateScheduleAssignments } from "@/lib/api/planningScheduleValidation";
import type { AssignmentInput } from "@/lib/planning/types";

export type SwapApproveFailure =
  | { kind: "http"; status: number; error: string }
  | { kind: "rules"; errors: unknown[]; warnings: unknown[] };

export class SwapApproveRejected extends Error {
  constructor(public readonly failure: SwapApproveFailure) {
    super("SwapApproveRejected");
    this.name = "SwapApproveRejected";
  }
}

/**
 * Applies an approved swap: `fromAssignment.employeeId` becomes `toEmployeeId`.
 * Validates the full schedule roster with phase-06 hard rules before commit.
 */
export async function applyApprovedSwap(
  tx: Prisma.TransactionClient,
  facilityId: string,
  fromAssignmentId: string,
  toEmployeeId: string,
  approvedByUserId: string,
  swapId: string,
): Promise<{ ok: true } | { ok: false; failure: SwapApproveFailure }> {
  const from = await tx.assignment.findUnique({
    where: { id: fromAssignmentId },
    include: { schedule: true },
  });
  if (!from || from.schedule.facilityId !== facilityId) {
    return {
      ok: false,
      failure: { kind: "http", status: 404, error: "Zuweisung nicht gefunden." },
    };
  }

  if (from.employeeId === toEmployeeId) {
    return {
      ok: false,
      failure: {
        kind: "http",
        status: 400,
        error: "Ziel-Mitarbeiter ist bereits für diese Schicht eingeteilt.",
      },
    };
  }

  const toEmp = await tx.employee.findFirst({
    where: { id: toEmployeeId, facilityId },
  });
  if (!toEmp) {
    return {
      ok: false,
      failure: { kind: "http", status: 400, error: "Ziel-Mitarbeiter nicht gefunden." },
    };
  }

  const all = await tx.assignment.findMany({
    where: { scheduleId: from.scheduleId },
  });

  const proposed: AssignmentInput[] = all.map((a) => ({
    id: a.id,
    date: a.date,
    shiftProfileId: a.shiftProfileId,
    employeeId: a.id === from.id ? toEmployeeId : a.employeeId,
  }));

  const v = await validateScheduleAssignments(
    tx,
    facilityId,
    {
      periodStart: from.schedule.periodStart,
      periodEnd: from.schedule.periodEnd,
    },
    proposed,
  );

  if (!v.ok) {
    return {
      ok: false,
      failure: { kind: "http", status: v.status, error: v.error },
    };
  }
  if (v.result.errors.length > 0) {
    return {
      ok: false,
      failure: {
        kind: "rules",
        errors: v.result.errors,
        warnings: v.result.warnings,
      },
    };
  }

  await tx.assignment.update({
    where: { id: from.id },
    data: { employeeId: toEmployeeId },
  });

  await tx.swapRequest.update({
    where: { id: swapId },
    data: {
      status: SwapStatus.APPROVED,
      toEmployeeId,
      approvedByUserId,
      approvedAt: new Date(),
      plannerDecisionReason: null,
    },
  });

  return { ok: true };
}
