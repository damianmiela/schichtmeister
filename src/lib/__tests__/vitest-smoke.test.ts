import { describe, it, expect } from "vitest";
import { getStaffingStatus } from "@/lib/schedule/viewUtils";

describe("vitest tooling (phase 01)", () => {
  it("resolves @ path alias and runs existing lib code", () => {
    expect(getStaffingStatus(5, 5)).toBe("success");
  });
});
