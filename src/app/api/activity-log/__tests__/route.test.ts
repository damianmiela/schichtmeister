import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { writeBatch } from "@/lib/logging/serverLogger";
import { POST } from "../route";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { update: vi.fn().mockResolvedValue({}) } } }));
vi.mock("@/lib/logging/serverLogger", () => ({ writeBatch: vi.fn() }));

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/activity-log", { method: "POST", body: JSON.stringify(body) }));
const pageView = (extra: object = {}) => ({ type: "page_view", ts: new Date().toISOString(), data: { path: "/schedule" }, ...extra });
const written = () => vi.mocked(writeBatch).mock.calls.flatMap(([, entries]) => entries);

describe("POST /api/activity-log", () => {
  beforeEach(() => {
    vi.mocked(writeBatch).mockClear();
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u1", name: "Demo", role: "DEMO", facilityId: "f1" } });
  });

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null);
    expect((await post({ events: [pageView()] })).status).toBe(401);
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it("keeps only page views, rebuilt from known fields with a safe timestamp", async () => {
    await post({ events: [pageView({ ts: "../../../x", junk: "x".repeat(5000) }), { type: "click", ts: "2026-01-01" }] });
    const [entry, ...rest] = written();
    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({ type: "page_view", userId: "u1", data: { path: "/schedule" } });
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry).not.toHaveProperty("junk");
  });

  it("rejects oversized batches and stops at the hourly budget", async () => {
    expect((await post({ events: Array.from({ length: 101 }, () => pageView()) })).status).toBe(400);
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u2", name: "", role: "PLANNER", facilityId: "f1" } });
    for (let i = 0; i < 4; i++) await post({ events: Array.from({ length: 100 }, () => pageView()) });
    expect(written()).toHaveLength(300);
  });
});
