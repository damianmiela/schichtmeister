import type { SwapRequest } from "@prisma/client";

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
