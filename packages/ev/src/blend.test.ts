import { describe, expect, it } from "vitest";

import { blendPrices, median } from "./blend";

describe("median", () => {
  it("returns the middle value for odd-length input", () => {
    expect(median([300, 100, 200])).toBe(200);
  });

  it("averages the two middle values for even-length input", () => {
    expect(median([100, 200, 300, 400])).toBe(250);
  });

  it("does not mutate its input", () => {
    const xs = [300, 100, 200];
    median(xs);
    expect(xs).toEqual([300, 100, 200]);
  });

  it("returns null for empty input", () => {
    expect(median([])).toBeNull();
  });

  it("handles a single value", () => {
    expect(median([42])).toBe(42);
  });
});

describe("blendPrices", () => {
  const prices = { a: 100, b: 300, c: 200 };

  it("returns the single selected source's price untouched", () => {
    expect(blendPrices(prices, ["b"], "median")).toBe(300);
  });

  it("medians across selected sources", () => {
    expect(blendPrices(prices, ["a", "b", "c"], "median")).toBe(200);
  });

  it("means across selected sources", () => {
    expect(blendPrices(prices, ["a", "b", "c"], "mean")).toBe(200);
  });

  it("takes the min", () => {
    expect(blendPrices(prices, ["a", "b", "c"], "min")).toBe(100);
  });

  it("takes the max", () => {
    expect(blendPrices(prices, ["a", "b", "c"], "max")).toBe(300);
  });

  it("ignores selected sources that have no price for this entity", () => {
    // 'zz' is toggled on but has no data — it must not drag the blend toward
    // zero, and must not make the whole blend null.
    expect(blendPrices(prices, ["a", "zz", "c"], "median")).toBe(150);
  });

  it("returns null when no selected source has a price", () => {
    expect(blendPrices(prices, ["zz"], "median")).toBeNull();
  });

  it("returns null when nothing is selected", () => {
    expect(blendPrices(prices, [], "median")).toBeNull();
  });

  it("ignores unselected sources that do have prices", () => {
    expect(blendPrices(prices, ["a"], "mean")).toBe(100);
  });

  it("treats a zero price as real data, not as missing", () => {
    // A genuine 0 is a signal (worthless card); dropping it would inflate EV.
    expect(blendPrices({ a: 0, b: 100 }, ["a", "b"], "mean")).toBe(50);
  });

  it("keeps fractional results from mean/median rather than rounding", () => {
    // Rounding here then summing across ~8 tiers drifts EV by cents.
    expect(blendPrices({ a: 100, b: 101 }, ["a", "b"], "mean")).toBe(100.5);
  });
});
