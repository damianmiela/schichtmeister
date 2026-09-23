import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findUnique } } }));

import { authOptions } from "../options";

const jwt = authOptions.callbacks!.jwt!;
const oldToken = { sub: "u1", name: "Old", role: "ADMIN", facilityId: "f1", employeeId: null };

describe("jwt callback on later session checks", () => {
  beforeEach(() => findUnique.mockReset());

  it("ends the session when the user no longer exists, e.g. after a demo reset", async () => {
    findUnique.mockResolvedValue(null);
    await expect(jwt({ token: { ...oldToken } } as never)).rejects.toThrow();
  });

  it("takes name, role and facility from the database, not from the old token", async () => {
    findUnique.mockResolvedValue({ name: "New", role: "PLANNER", facilityId: "f2", employeeId: null });
    await expect(jwt({ token: { ...oldToken } } as never)).resolves.toMatchObject({
      name: "New",
      role: "PLANNER",
      facilityId: "f2",
    });
  });
});
