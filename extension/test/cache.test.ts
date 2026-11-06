import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/content/meet/cache";

describe("TtlCache", () => {
  it("expires an entry a fixed time after it was stored, however often it is read", () => {
    let now = 0;
    const cache = new TtlCache<string, number>(100, () => now);
    cache.set("a", 1);
    for (now = 0; now < 100; now += 10) expect(cache.get("a")).toBe(1);
    now = 100;
    expect(cache.get("a")).toBeUndefined();
  });

  it("starts the time again when an entry is stored again", () => {
    let now = 0;
    const cache = new TtlCache<string, number>(100, () => now);
    cache.set("a", 1);
    now = 90;
    cache.set("a", 2);
    now = 150;
    expect(cache.get("a")).toBe(2);
  });

  it("forgets one entry, or all of them", () => {
    const cache = new TtlCache<string, number>(100, () => 0);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    cache.clear();
    expect(cache.get("b")).toBeUndefined();
  });
});
