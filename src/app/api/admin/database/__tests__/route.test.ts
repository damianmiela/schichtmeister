import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ session: {}, error: null }),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([{ id: "row-1", passwordHash: "SECRET-HASH" }]),
    },
    passwordResetToken: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([{ id: "row-1", token: "SECRET-TOKEN" }]),
    },
  },
}));

describe("GET /api/admin/database", () => {
  it("masks password hashes and reset tokens", async () => {
    for (const table of ["user", "passwordResetToken"]) {
      const res = await GET(new NextRequest(`http://localhost/api/admin/database?table=${table}`));
      const text = await res.text();
      expect(text).toContain("row-1");
      expect(text).not.toContain("SECRET");
    }
  });
});
