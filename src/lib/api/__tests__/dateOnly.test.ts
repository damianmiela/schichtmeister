import { describe, it, expect } from "vitest";
import {
  isDateWithinPeriodInclusive,
  parseIsoDateOnly,
  toIsoDateOnly,
} from "@/lib/api/dateOnly";

describe("dateOnly", () => {
  it("parses and serializes YYYY-MM-DD in UTC", () => {
    const d = parseIsoDateOnly("2026-03-15");
    expect(d).not.toBeNull();
    expect(toIsoDateOnly(d!)).toBe("2026-03-15");
  });

  it("rejects invalid date strings", () => {
    expect(parseIsoDateOnly("03-15-2026")).toBeNull();
    expect(parseIsoDateOnly("2026-1-05")).toBeNull();
  });

  it("includes boundaries for schedule period", () => {
    const start = parseIsoDateOnly("2026-01-05")!;
    const end = parseIsoDateOnly("2026-01-11")!;
    expect(isDateWithinPeriodInclusive(start, start, end)).toBe(true);
    expect(isDateWithinPeriodInclusive(end, start, end)).toBe(true);
    expect(isDateWithinPeriodInclusive(parseIsoDateOnly("2026-01-04")!, start, end)).toBe(
      false,
    );
  });
});
