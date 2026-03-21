import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { parseJsonBody, readJsonUnknown } from "@/lib/api/validation";

describe("readJsonUnknown", () => {
  it("rejects invalid JSON with 400 body", async () => {
    const req = new NextRequest("http://localhost/api/x", {
      method: "POST",
      body: "not-json{",
    });
    const out = await readJsonUnknown(req);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.response.status).toBe(400);
      const j = (await out.response.json()) as { error?: string };
      expect(j.error).toBe("Ungültiges JSON");
    }
  });
});

describe("parseJsonBody", () => {
  it("returns zod error response for invalid shape", async () => {
    const req = new NextRequest("http://localhost/api/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: 1 }),
    });
    const out = await parseJsonBody(req, z.object({ name: z.string() }));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.response.status).toBe(400);
    }
  });
});
