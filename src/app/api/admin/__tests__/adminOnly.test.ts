import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getLogs } from "../logs/route";
import { POST as cleanAbsences } from "../clean-absences/route";

// A real session check with the shared demo login signed in.
vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { id: "demo-id", role: "DEMO", facilityId: "f1" } }),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { user: { update: vi.fn().mockResolvedValue({}) } },
}));

describe("admin-only API routes", () => {
  it("refuse the shared demo login", async () => {
    expect((await getLogs(new NextRequest("http://localhost/api/admin/logs?type=system"))).status).toBe(403);
    expect((await cleanAbsences()).status).toBe(403);
  });
});
