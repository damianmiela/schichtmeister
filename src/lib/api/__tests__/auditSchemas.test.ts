import { describe, expect, it } from "vitest";
import { auditListQuerySchema } from "@/lib/api/auditSchemas";

describe("auditListQuerySchema", () => {
  it("applies default limit", () => {
    const r = auditListQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(100);
  });

  it("accepts entity filters and dates", () => {
    const r = auditListQuerySchema.safeParse({
      entityType: "Wish",
      entityId: "w1",
      from: "2026-01-01",
      to: "2026-01-31",
      limit: "50",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.entityType).toBe("Wish");
      expect(r.data.entityId).toBe("w1");
      expect(r.data.from).toBe("2026-01-01");
      expect(r.data.to).toBe("2026-01-31");
      expect(r.data.limit).toBe(50);
    }
  });

  it("rejects limit above cap", () => {
    const r = auditListQuerySchema.safeParse({ limit: "501" });
    expect(r.success).toBe(false);
  });
});
