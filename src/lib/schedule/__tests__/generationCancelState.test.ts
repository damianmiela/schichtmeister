import { describe, expect, it } from "vitest";
import {
  markGenerationCancelled,
  registerGeneration,
  unregisterGeneration,
} from "../generationCancelState";

describe("generation cancel registry", () => {
  it("keeps a second run of the same month cancellable after the first one ends", () => {
    const first = registerGeneration("s1", "key-1");
    const second = registerGeneration("s1", "key-2");
    unregisterGeneration("s1", first);

    expect(markGenerationCancelled("s1")).toEqual(["key-2"]);
    expect(second.cancelled.value).toBe(true);

    unregisterGeneration("s1", second);
    expect(markGenerationCancelled("s1")).toEqual([]);
  });

  it("cancels every run of the month, not only the newest", () => {
    const a = registerGeneration("s2", "key-a");
    const b = registerGeneration("s2", "key-b");
    expect(markGenerationCancelled("s2").sort()).toEqual(["key-a", "key-b"]);
    expect([a.cancelled.value, b.cancelled.value]).toEqual([true, true]);
  });
});
