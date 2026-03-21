import { z } from "zod";

export const swapCreateBodySchema = z.object({
  fromAssignmentId: z.string().min(1),
  toEmployeeId: z.string().min(1).optional().nullable(),
});

export const swapApproveBodySchema = z.object({
  /** Required when the swap was created without `toEmployeeId`. */
  toEmployeeId: z.string().min(1).optional(),
});

export const swapRejectBodySchema = z.object({
  plannerDecisionReason: z.string().max(2000).optional().nullable(),
});
