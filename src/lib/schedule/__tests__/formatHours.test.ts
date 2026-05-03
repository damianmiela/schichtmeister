import { describe, it, expect } from "vitest";
import { formatHours } from "@/lib/schedule/viewUtils";

describe("formatHours", () => {
  it("renders whole numbers without decimals", () => {
    expect(formatHours(0)).toBe("0");
    expect(formatHours(8)).toBe("8");
    expect(formatHours(168)).toBe("168");
  });

  it("renders one-decimal values without trailing zero", () => {
    expect(formatHours(8.5)).toBe("8.5");
    expect(formatHours(7.1)).toBe("7.1");
  });

  it("renders two-decimal values exactly (no rounding to 1 decimal)", () => {
    // The original bug: an 8 h shift with 45 min break = 8.75 h paid,
    // but the old formatter (toFixed(1)) rendered it as "8.8".
    expect(formatHours(8.75)).toBe("8.75");
    expect(formatHours(8.25)).toBe("8.25");
    expect(formatHours(0.05)).toBe("0.05");
  });

  it("rounds beyond 2 decimals to avoid float noise", () => {
    expect(formatHours(8.749999999)).toBe("8.75");
    expect(formatHours(8.000000001)).toBe("8");
  });

  it("handles negative deltas", () => {
    expect(formatHours(-1.5)).toBe("-1.5");
    expect(formatHours(-0.25)).toBe("-0.25");
  });

  it("returns '0' for non-finite input", () => {
    expect(formatHours(NaN)).toBe("0");
    expect(formatHours(Infinity)).toBe("0");
  });
});
