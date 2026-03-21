import { z } from "zod";

export const auditListQuerySchema = z.object({
  entityType: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
});

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
