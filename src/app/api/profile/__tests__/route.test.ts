import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PATCH } from "../route";

vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn().mockResolvedValue({ session: { user: { id: "demo-id", role: "DEMO" } }, error: null }),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

describe("PATCH /api/profile", () => {
  it("keeps the shared demo login unchanged", async () => {
    const res = await PATCH(
      new NextRequest("http://localhost/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword: "demo", newPassword: "12345678" }),
      }),
    );
    expect(res.status).toBe(403);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
