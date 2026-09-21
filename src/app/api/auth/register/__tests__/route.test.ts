import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";

const register = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

const validBody = { email: "neu@example.com", password: "12345678", secretPassword: "falsch" };

describe("POST /api/auth/register", () => {
  afterEach(() => {
    delete process.env.REGISTER_SECRET;
  });

  it("is closed while REGISTER_SECRET is not set", async () => {
    expect((await register(validBody)).status).toBe(403);
  });

  it("rejects a wrong registration password", async () => {
    process.env.REGISTER_SECRET = "richtig";
    expect((await register(validBody)).status).toBe(403);
  });
});
