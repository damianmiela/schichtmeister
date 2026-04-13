import { describe, expect, it } from "vitest";
import { eachIsoDateInPeriod } from "@/lib/export/exportDateRange";

describe("eachIsoDateInPeriod", () => {
  it("returns inclusive ISO dates", () => {
    const start = new Date(Date.UTC(2026, 2, 10));
    const end = new Date(Date.UTC(2026, 2, 12));
    expect(eachIsoDateInPeriod(start, end)).toEqual([
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
    ]);
  });

  it("returns single day when start equals end", () => {
    const d = new Date(Date.UTC(2026, 0, 1));
    expect(eachIsoDateInPeriod(d, d)).toEqual(["2026-01-01"]);
  });
});
