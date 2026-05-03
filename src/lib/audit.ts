import type { Prisma } from "@prisma/client";
import { AuditAction } from "@prisma/client";
import type { SwapStatus, WishStatus } from "@prisma/client";
import type { ShiftType } from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";

export const AUDIT_ENTITY_ASSIGNMENT = "Assignment";
export const AUDIT_ENTITY_WISH = "Wish";
export const AUDIT_ENTITY_SWAP_REQUEST = "SwapRequest";

type AuditLogClient = {
  auditLog: {
    create(args: { data: Prisma.AuditLogCreateInput }): Promise<unknown>;
  };
};

export type WriteAuditLogInput = {
  entityType: string;
  entityId: string;
  action: AuditAction;
  actorUserId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
};

export async function writeAuditLog(
  db: AuditLogClient,
  input: WriteAuditLogInput,
): Promise<void> {
  const { entityType, entityId, action, actorUserId, before, after } = input;
  const data: Prisma.AuditLogCreateInput = {
    entityType,
    entityId,
    action,
    actor: { connect: { id: actorUserId } },
  };
  if (before !== undefined) data.before = before;
  if (after !== undefined) data.after = after;
  await db.auditLog.create({ data });
}

export function assignmentAuditSnapshot(a: {
  id: string;
  scheduleId: string;
  date: Date;
  /** Nullable since the Assignment row may be a pure absence marker. */
  shiftProfileId: string | null;
  employeeId: string;
}) {
  return {
    id: a.id,
    scheduleId: a.scheduleId,
    date: toIsoDateOnly(a.date),
    shiftProfileId: a.shiftProfileId,
    employeeId: a.employeeId,
  };
}

export function wishAuditSnapshot(w: {
  id: string;
  status: WishStatus;
  decisionReason: string | null;
  date: Date;
  employeeId: string;
  shiftProfileId: string | null;
  shiftType: ShiftType | null;
}) {
  return {
    id: w.id,
    status: w.status,
    decisionReason: w.decisionReason,
    date: toIsoDateOnly(w.date),
    employeeId: w.employeeId,
    shiftProfileId: w.shiftProfileId,
    shiftType: w.shiftType,
  };
}

export function swapAuditSnapshot(s: {
  id: string;
  status: SwapStatus;
  fromAssignmentId: string;
  toEmployeeId: string | null;
  plannerDecisionReason: string | null;
  approvedByUserId: string | null;
}) {
  return {
    id: s.id,
    status: s.status,
    fromAssignmentId: s.fromAssignmentId,
    toEmployeeId: s.toEmployeeId,
    plannerDecisionReason: s.plannerDecisionReason,
    approvedByUserId: s.approvedByUserId,
  };
}

export { AuditAction };
