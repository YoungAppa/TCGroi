import { describe, expect, it } from "vitest";

import { groupByRarity, tierValue } from "./tiers";
import { DEFAULT_EV_OPTIONS, type CardPriceData, type EvOptions } from "./types";

const opts = (over: Partial<EvOptions> = {}): EvOptions => ({
  ...DEFAULT_EV_OPTIONS,
  selectedSources: ["a"],
  ...over,
});

const c = (
  id: string,
  rarity: string,
  raw: Record<string, number>,
): CardPriceData => ({
  cardId: id,
  name: `Card ${id}`,
  number: `${id}/100`,
  rarity,
  raw,
});

describe("groupByRarity", () => {
  it("buckets cards by rarity", () => {
    const g = groupByRarity([
      c("1", "rare", { a: 100 }),
      c("2", "hyper_rare", { a: 900 }),
      c("3", "rare", { a: 300 }),
    ]);
    expect(g.get("rare")).toHaveLength(2);
    expect(g.get("hyper_rare")).toHaveLength(1);
    expect(g.get("nope")).toBeUndefined();
  });

  it("returns an empty map for no cards", () => {
    expect(groupByRarity([]).size).toBe(0);
  });
});

describe("tierValue", () => {
  it("means card values across the tier by default", () => {
    const g = groupByRarity([
      c("1", "rare", { a: 100 }),
      c("2", "rare", { a: 300 }),
    ]);
    expect(tierValue("rare", g, opts())).toEqual({
      avgValueCents: 200,
      pricedCardCount: 2,
      totalCardCount: 2,
    });
  });

  it("medians when asked", () => {
    // Mean would be 3400; median resists the one chase card skewing the tier.
    const g = groupByRarity([
      c("1", "rare", { a: 100 }),
      c("2", "rare", { a: 100 }),
      c("3", "rare", { a: 10000 }),
    ]);
    expect(tierValue("rare", g, opts({ tierAggregation: "median" })).avgValueCents).toBe(100);
    expect(tierValue("rare", g, opts({ tierAggregation: "mean" })).avgValueCents).toBe(3400);
  });

  it("excludes unpriced cards from the average but still counts them", () => {
    // The unpriced card must not drag the mean to 50 — that would be a
    // silent, invisible EV error. It shows up as a coverage gap instead.
    const g = groupByRarity([
      c("1", "rare", { a: 100 }),
      c("2", "rare", { b: 999 }), // source 'b' not selected => unpriced
    ]);
    expect(tierValue("rare", g, opts())).toEqual({
      avgValueCents: 100,
      pricedCardCount: 1,
      totalCardCount: 2,
    });
  });

  it("reports zero value and zero coverage for a tier with no priced cards", () => {
    const g = groupByRarity([c("1", "rare", { b: 999 })]);
    expect(tierValue("rare", g, opts())).toEqual({
      avgValueCents: 0,
      pricedCardCount: 0,
      totalCardCount: 1,
    });
  });

  it("reports zero for a rarity the set has no cards of", () => {
    // A pull-rate table naming a tier the catalog lacks: real scenario when a
    // rarity slug is misspelled. Must not throw.
    const g = groupByRarity([c("1", "rare", { a: 100 })]);
    expect(tierValue("hyper_rare", g, opts())).toEqual({
      avgValueCents: 0,
      pricedCardCount: 0,
      totalCardCount: 0,
    });
  });

  it("applies the bulk floor per card before aggregating", () => {
    // (1 + 1000) / 2 = 500.5 — the 30c card contributes bulk, not 30.
    const g = groupByRarity([
      c("1", "rare", { a: 30 }),
      c("2", "rare", { a: 1000 }),
    ]);
    expect(tierValue("rare", g, opts()).avgValueCents).toBe(500.5);
  });
});
