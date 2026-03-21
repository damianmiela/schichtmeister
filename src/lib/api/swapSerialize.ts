import type {
  Assignment,
  Employee,
  ShiftProfile,
  SwapRequest,
} from "@prisma/client";
import { toIsoDateOnly } from "@/lib/api/dateOnly";

export function serializeSwap(s: SwapRequest): Record<string, unknown> {
  return {
    id: s.id,
    fromAssignmentId: s.fromAssignmentId,
    toEmployeeId: s.toEmployeeId,
    status: s.status,
    plannerDecisionReason: s.plannerDecisionReason,
    approvedByUserId: s.approvedByUserId,
    approvedAt: s.approvedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export type SwapWithRelations = SwapRequest & {
  fromAssignment: Assignment & {
    employee: Employee;
    shiftProfile: ShiftProfile;
  };
  toEmployee: Employee | null;
};

/** Planner list: human-readable shift + names for UI. */
export function serializeSwapListItem(s: SwapWithRelations): Record<string, unknown> {
  const a = s.fromAssignment;
  const dateStr = toIsoDateOnly(a.date);
  const shiftLabel = `${a.shiftProfile.name} (${a.shiftProfile.startTime}–${a.shiftProfile.endTime})`;
  return {
    ...serializeSwap(s),
    assignmentDate: dateStr,
    shiftType: a.shiftProfile.shiftType,
    shiftLabel,
    fromEmployeeName: `${a.employee.firstName} ${a.employee.lastName}`.trim(),
    toEmployeeName: s.toEmployee
      ? `${s.toEmployee.firstName} ${s.toEmployee.lastName}`.trim()
      : null,
  };
}
