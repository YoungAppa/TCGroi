import { describe, expect, it } from "vitest";

import { DEFAULT_FILTER_STATE } from "@packroi/ev/url-state";
import type { CardPriceData } from "@packroi/ev/types";

import { computeForPayload, computeProduct } from "./compute";
import type { ProductPayload } from "./types";

const SRC = "tcgplayer_market";
const IDS = [SRC];
const FILTER = { ...DEFAULT_FILTER_STATE };

function card(id: string, rarity: string, cents: number): CardPriceData {
  return { cardId: id, name: id, number: id, rarity, imageUrl: null, raw: { [SRC]: cents } };
}

type PullRates = ProductPayload["pullRates"];
function pullRates(slots: { rarity: string; perPackProbability: number }[]): PullRates {
  return {
    version: 1,
    sampleSizePacks: 1000,
    sourceUrl: "https://example.test",
    sourceNote: "test",
    confidence: "low",
    slots,
    guaranteedSlots: [],
    alternateEstimates: [],
  };
}

/** A minimal single-set payload — everything the blend doesn't touch is filler. */
function payload(over: Partial<ProductPayload>): ProductPayload {
  return {
    gameSlug: "pokemon",
    gameName: "Pokémon",
    setCode: "test",
    setName: "Test Set",
    setLanguage: "EN",
    releaseDate: null,
    productId: "p",
    productName: "Product",
    productSlug: "product",
    productType: "booster_pack",
    packsContained: 1,
    imageUrl: null,
    msrpCents: null,
    market: { priceCents: null, isManual: false, asOf: null, source: null },
    sealed: {},
    guaranteedCardIds: [],
    promos: [],
    contentsNote: null,
    boxGuarantees: [],
    pullRates: pullRates([]),
    cards: [],
    ...over,
  };
}

// Two component sets with distinct rarities/prices so per-pack EVs differ.
const compA = {
  setCode: "a",
  setName: "Set A",
  pullRates: { ...pullRates([{ rarity: "rare", perPackProbability: 0.25 }]) },
  cards: [card("a1", "rare", 10000)],
};
const compB = {
  setCode: "b",
  setName: "Set B",
  pullRates: { ...pullRates([{ rarity: "rare", perPackProbability: 0.5 }]) },
  cards: [card("b1", "rare", 4000)],
};

/** Per-pack EV of a component, computed the same way the blend does (1 pack). */
function packEv(comp: { setCode: string; pullRates: PullRates; cards: CardPriceData[] }): number {
  return computeForPayload(
    payload({ setCode: comp.setCode, productType: "booster_pack", packsContained: 1, pullRates: comp.pullRates, cards: comp.cards }),
    FILTER,
    IDS,
  ).evPackCents;
}

describe("computeBlendedEv", () => {
  const blended = payload({
    productType: "case",
    packsContained: 5,
    msrpCents: 10000,
    market: { priceCents: 20000, isManual: true, asOf: "2026-07-24", source: "test" },
    componentPacks: [
      { ...compA, count: 2 },
      { ...compB, count: 3 },
    ],
  });

  it("sums each component's per-pack EV weighted by pack count", () => {
    const ev = computeForPayload(blended, FILTER, IDS);
    const expected = 2 * packEv(compA) + 3 * packEv(compB);
    expect(ev.evProductCents).toBeCloseTo(expected, 5);
    expect(ev.evPackCents).toBeCloseTo(expected / 5, 5);
  });

  it("blends P(at least one) independently across every pack", () => {
    const ev = computeForPayload(blended, FILTER, IDS);
    // rare appears at 0.25/pack in 2 A-packs and 0.5/pack in 3 B-packs.
    const expected = 1 - Math.pow(1 - 0.25, 2) * Math.pow(1 - 0.5, 3);
    expect(ev.probAtLeastOne["rare"]).toBeCloseTo(expected, 6);
  });

  it("derives both ROIs from the blended product EV", () => {
    const c = computeProduct(blended, FILTER, IDS);
    const ev = 2 * packEv(compA) + 3 * packEv(compB);
    expect(c.roiRetail).toBeCloseTo(ev / 10000 - 1, 6);
    expect(c.roiMarket).toBeCloseTo(ev / 20000 - 1, 6);
  });

  it("discloses the blend and any unattributed packs in a warning", () => {
    const ev = computeForPayload(blended, FILTER, IDS);
    expect(ev.warnings).toHaveLength(1);
    // 5 stated packs, 5 modelled — no gap phrasing.
    expect(ev.warnings[0]).toContain("Blended EV");
    expect(ev.warnings[0]).not.toContain("Published breakdowns attribute");

    const withGap = computeForPayload({ ...blended, packsContained: 6 }, FILTER, IDS);
    expect(withGap.warnings[0]).toContain("Published breakdowns attribute 5 of the 6 packs");
  });
});
