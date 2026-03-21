import { describe, it, expect } from "vitest";
import { wishCreateBodySchema, parseWishQueryDates } from "@/lib/api/wishSchemas";

describe("wishSchemas", () => {
  it("requires shiftType or shiftProfileId on create", () => {
    const bad = wishCreateBodySchema.safeParse({ date: "2026-06-01" });
    expect(bad.success).toBe(false);
    const ok = wishCreateBodySchema.safeParse({
      date: "2026-06-01",
      shiftType: "EARLY",
    });
    expect(ok.success).toBe(true);
  });

  it("parseWishQueryDates rejects invalid from/to", () => {
    const r = parseWishQueryDates("bad", null);
    expect(r.ok).toBe(false);
  });

  it("parseWishQueryDates defaults window when params omitted", () => {
    const r = parseWishQueryDates(null, null);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.from.getTime()).toBeLessThanOrEqual(r.to.getTime());
    }
  });
});
