import { randomUUID } from "node:crypto";
import type { Assignment, Prisma } from "@prisma/client";
import { ScheduleStatus } from "@prisma/client";
import type { PlanningValidationResult } from "@/lib/api/planningScheduleValidation";
import { validateScheduleAssignments } from "@/lib/api/planningScheduleValidation";
import type { AssignmentInput } from "@/lib/planning/types";

export type DbTx = Prisma.TransactionClient;

export type AssignmentOpFailure =
  | { kind: "http"; status: number; error: string }
  | { kind: "rules"; result: PlanningValidationResult };

function toInputs(rows: Assignment[]): AssignmentInput[] {
  return rows.map((a) => ({
    id: a.id,
    date: a.date,
    shiftProfileId: a.shiftProfileId,
    employeeId: a.employeeId,
  }));
}

export async function loadDraftScheduleForFacility(
  tx: DbTx,
  scheduleId: string,
  facilityId: string,
): Promise<
  | { ok: true; schedule: { id: string; periodStart: Date; periodEnd: Date } }
  | { ok: false; failure: AssignmentOpFailure }
> {
  const schedule = await tx.schedule.findFirst({
    where: { id: scheduleId, facilityId },
  });
  if (!schedule) {
    return {
      ok: false,
      failure: { kind: "http", status: 404, error: "Dienstplan nicht gefunden." },
    };
  }
  if (schedule.status !== ScheduleStatus.DRAFT) {
    return {
      ok: false,
      failure: {
        kind: "http",
        status: 409,
        error: "Nur Entwürfe können bearbeitet werden.",
      },
    };
  }
  return {
    ok: true,
    schedule: {
      id: schedule.id,
      periodStart: schedule.periodStart,
      periodEnd: schedule.periodEnd,
    },
  };
}

export async function requireActiveProfile(
  tx: DbTx,
  shiftProfileId: string,
  facilityId: string,
): Promise<{ ok: true } | { ok: false; failure: AssignmentOpFailure }> {
  const profile = await tx.shiftProfile.findFirst({
    where: { id: shiftProfileId, facilityId, isActive: true },
  });
  if (!profile) {
    return {
      ok: false,
      failure: {
        kind: "http",
        status: 400,
        error: "Schichtprofil nicht gefunden oder inaktiv.",
      },
    };
  }
  return { ok: true };
}

export async function requireEmployee(
  tx: DbTx,
  employeeId: string,
  facilityId: string,
): Promise<{ ok: true } | { ok: false; failure: AssignmentOpFailure }> {
  const employee = await tx.employee.findFirst({
    where: { id: employeeId, facilityId },
  });
  if (!employee) {
    return {
      ok: false,
      failure: { kind: "http", status: 400, error: "Mitarbeiter nicht gefunden." },
    };
  }
  return { ok: true };
}

async function runPlanningValidation(
  tx: DbTx,
  facilityId: string,
  schedule: { periodStart: Date; periodEnd: Date },
  proposed: AssignmentInput[],
): Promise<{ ok: true } | { ok: false; failure: AssignmentOpFailure }> {
  const v = await validateScheduleAssignments(tx, facilityId, schedule, proposed);
  if (!v.ok) {
    return {
      ok: false,
      failure: { kind: "http", status: v.status, error: v.error },
    };
  }
  if (v.result.errors.length > 0) {
    return { ok: false, failure: { kind: "rules", result: v.result } };
  }
  return { ok: true };
}

export async function validateNewAssignmentInTx(
  tx: DbTx,
  facilityId: string,
  schedule: { id: string; periodStart: Date; periodEnd: Date },
  newRow: { date: Date; shiftProfileId: string; employeeId: string },
): Promise<{ ok: true } | { ok: false; failure: AssignmentOpFailure }> {
  const existing = await tx.assignment.findMany({ where: { scheduleId: schedule.id } });
  const proposed: AssignmentInput[] = [
    ...toInputs(existing),
    {
      id: `pending:${randomUUID()}`,
      date: newRow.date,
      shiftProfileId: newRow.shiftProfileId,
      employeeId: newRow.employeeId,
    },
  ];
  return runPlanningValidation(tx, facilityId, schedule, proposed);
}

export async function validatePatchedAssignmentInTx(
  tx: DbTx,
  facilityId: string,
  schedule: { id: string; periodStart: Date; periodEnd: Date },
  assignmentId: string,
  patch: { date?: Date; shiftProfileId?: string; employeeId?: string },
): Promise<{ ok: true } | { ok: false; failure: AssignmentOpFailure }> {
  const existing = await tx.assignment.findMany({ where: { scheduleId: schedule.id } });
  const hit = existing.find((a) => a.id === assignmentId);
  if (!hit) {
    return {
      ok: false,
      failure: { kind: "http", status: 404, error: "Zuweisung nicht gefunden." },
    };
  }
  const proposed: AssignmentInput[] = existing.map((a) =>
    a.id === assignmentId
      ? {
          id: a.id,
          date: patch.date ?? a.date,
          shiftProfileId: patch.shiftProfileId ?? a.shiftProfileId,
          employeeId: patch.employeeId ?? a.employeeId,
        }
      : {
          id: a.id,
          date: a.date,
          shiftProfileId: a.shiftProfileId,
          employeeId: a.employeeId,
        },
  );
  return runPlanningValidation(tx, facilityId, schedule, proposed);
}
