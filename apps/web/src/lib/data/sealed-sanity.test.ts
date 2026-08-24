import { describe, expect, it } from "vitest";

import { dropImplausibleSealedPrices } from "./db";

/** Shorthand: a set's products as (id, packs) plus their priced values. */
function build(rows: [string, number, number | null][]) {
  const products = rows.map(([productId, packsContained]) => ({ productId, packsContained }));
  const sealed = new Map<string, Record<string, number>>();
  for (const [id, , cents] of rows) if (cents !== null) sealed.set(id, { pricecharting_ebay: cents });
  return { products, sealed };
}

describe("dropImplausibleSealedPrices", () => {
  it("drops a single-pack price that matched a box listing", () => {
    // Sword & Shield JP: a 'booster pack' at $1,724.80 beside its own 30-pack
    // box at $148.50 — the real failure this exists for.
    const { products, sealed } = build([
      ["pack", 1, 172_480],
      ["box", 30, 14_850],
      ["etb", 10, 5_500],
    ]);
    dropImplausibleSealedPrices(products, sealed);
    expect(sealed.has("pack")).toBe(false);
    expect(sealed.get("box")).toEqual({ pricecharting_ebay: 14_850 });
    expect(sealed.get("etb")).toEqual({ pricecharting_ebay: 5_500 });
  });

  it("keeps the loose-pack premium, which is real", () => {
    // Loose packs run ~2.5-3.5x the same pack bought inside a box. That is a
    // genuine market premium and must survive.
    const { products, sealed } = build([
      ["pack", 1, 900],
      ["box", 30, 8_300],
      ["etb", 10, 3_200],
    ]);
    dropImplausibleSealedPrices(products, sealed);
    expect(sealed.has("pack")).toBe(true);
    expect(sealed.has("box")).toBe(true);
  });

  it("drops an implausibly CHEAP product too", () => {
    // The dangerous direction: a box priced like a pack would read as a huge
    // positive ROI, which is the one error this site must never publish.
    const { products, sealed } = build([
      ["pack", 1, 1_000],
      ["box", 36, 900],
      ["etb", 8, 7_000],
    ]);
    dropImplausibleSealedPrices(products, sealed);
    expect(sealed.has("box")).toBe(false);
  });

  it("leaves a two-product set alone when neither dominates the other", () => {
    // With only two products the median is just the pair, so a merely odd-looking
    // ratio proves nothing about which one is wrong. Only the dominance rule may
    // act here, and it does not fire: the pack is dearer per pack but far cheaper
    // in total than the box, which is exactly what a loose-pack premium looks like.
    const { products, sealed } = build([
      ["pack", 1, 2_400],
      ["box", 30, 25_500],
    ]);
    dropImplausibleSealedPrices(products, sealed);
    expect(sealed.size).toBe(2);
  });

  it("ignores products with no packs and no prices", () => {
    const { products, sealed } = build([
      ["case", 0, 50_000],
      ["pack", 1, 900],
      ["box", 30, 8_300],
      ["etb", 10, null],
    ]);
    expect(() => dropImplausibleSealedPrices(products, sealed)).not.toThrow();
    expect(sealed.has("case")).toBe(true); // packs<=0 never voted, never judged
  });
});

describe("dropImplausibleSealedPrices — dominance", () => {
  it("drops a pack that costs more than its own box, even with only two products", () => {
    // Battle Partners: a $222.93 single pack beside a $79.00 thirty-pack box.
    // No median can arbitrate two products, but buying the box and splitting it
    // strictly dominates, so the pack price cannot be real.
    const products = [
      { productId: "pack", packsContained: 1 },
      { productId: "box", packsContained: 30 },
    ];
    const sealed = new Map([
      ["pack", { pricecharting_ebay: 22_293 }],
      ["box", { pricecharting_ebay: 7_900 }],
    ]);
    dropImplausibleSealedPrices(products, sealed);
    expect(sealed.has("pack")).toBe(false);
    expect(sealed.has("box")).toBe(true);
  });

  it("keeps a scarce small product that is dearer per pack but cheaper in total", () => {
    // Eevee Heroes: a $59.95 loose pack against a $740 box. Expensive per pack,
    // but nowhere near the box's total — a real premium, not a mismatch.
    const products = [
      { productId: "pack", packsContained: 1 },
      { productId: "box", packsContained: 30 },
    ];
    const sealed = new Map([
      ["pack", { pricecharting_ebay: 5_995 }],
      ["box", { pricecharting_ebay: 74_000 }],
    ]);
    dropImplausibleSealedPrices(products, sealed);
    expect(sealed.size).toBe(2);
  });
});
