import { describe, expect, it } from "vitest";

import { computeEv, packsForProbability, type EvInput } from "./compute";
import {
  DEFAULT_EV_OPTIONS,
  type CardPriceData,
  type EvOptions,
  type PullRateTable,
  type SealedProductInput,
} from "./types";

const opts = (over: Partial<EvOptions> = {}): EvOptions => ({
  ...DEFAULT_EV_OPTIONS,
  selectedSources: ["a"],
  ...over,
});

const table = (over: Partial<PullRateTable> = {}): PullRateTable => ({
  setId: "s1",
  version: 1,
  sampleSizePacks: 1000,
  sourceUrl: "https://example.test/data",
  sourceNote: "toy",
  confidence: "high",
  slots: [],
  guaranteedSlots: [],
  ...over,
});

const product = (over: Partial<SealedProductInput> = {}): SealedProductInput => ({
  productId: "p1",
  name: "Toy Booster Box",
  slug: "toy-booster-box",
  type: "booster_box",
  packsContained: 36,
  msrpCents: 14400,
  sealed: { a: 10000 },
  guaranteedCardIds: [],
  boxGuarantees: [],
  ...over,
});

const card = (
  id: string,
  rarity: string,
  raw: Record<string, number>,
  extra: Partial<CardPriceData> = {},
): CardPriceData => ({
  cardId: id,
  name: `Card ${id}`,
  number: `${id}/100`,
  rarity,
  raw,
  ...extra,
});

// ---------------------------------------------------------------------------
// Hand-computed baseline
// ---------------------------------------------------------------------------

describe("computeEv — hand-computed baseline", () => {
  /**
   * Two tiers, one card each, so tier average == that card's price.
   *
   *   ultra_rare        p=0.05  value $20.00 (2000c) -> 0.05 * 2000 = 100c
   *   hyper_rare        p=0.01  value $80.00 (8000c) -> 0.01 * 8000 =  80c
   *   EV(pack)                                        = 180c
   *   EV(box) = 180 * 10 packs                        = 1800c
   *   price   = 2000c
   *   ROI     = 1800/2000 - 1 = -0.10
   */
  const input: EvInput = {
    product: product({ packsContained: 10, sealed: { a: 2000 }, msrpCents: null }),
    table: table({
      slots: [
        { rarity: "ultra_rare", perPackProbability: 0.05 },
        { rarity: "hyper_rare", perPackProbability: 0.01 },
      ],
    }),
    cards: [card("1", "ultra_rare", { a: 2000 }), card("2", "hyper_rare", { a: 8000 })],
  };

  it("computes EV(pack) as the probability-weighted sum of tier values", () => {
    expect(computeEv(input, opts()).evPackCents).toBeCloseTo(180, 6);
  });

  it("computes EV(product) as EV(pack) * packs", () => {
    expect(computeEv(input, opts()).evProductCents).toBeCloseTo(1800, 6);
  });

  it("computes ROI against the sealed price", () => {
    expect(computeEv(input, opts()).roi).toBeCloseTo(-0.1, 10);
  });

  it("breaks EV down per tier", () => {
    const r = computeEv(input, opts());
    expect(r.tiers).toEqual([
      {
        rarity: "ultra_rare",
        perPackProbability: 0.05,
        avgValueCents: 2000,
        evContributionCents: 100,
        pricedCardCount: 1,
        totalCardCount: 1,
      },
      {
        rarity: "hyper_rare",
        perPackProbability: 0.01,
        avgValueCents: 8000,
        evContributionCents: 80,
        pricedCardCount: 1,
        totalCardCount: 1,
      },
    ]);
  });

  it("emits no warnings for a clean, fully-priced, high-confidence set", () => {
    expect(computeEv(input, opts()).warnings).toEqual([]);
  });

  it("reports a positive ROI when EV exceeds price", () => {
    // Same EV(box)=1800c against a 1500c box: 1800/1500 - 1 = +0.20
    const r = computeEv(
      { ...input, product: product({ packsContained: 10, sealed: { a: 1500 }, msrpCents: null }) },
      opts(),
    );
    expect(r.roi).toBeCloseTo(0.2, 10);
  });
});

// ---------------------------------------------------------------------------
// Tier averaging feeding EV
// ---------------------------------------------------------------------------

describe("computeEv — tier averaging", () => {
  it("averages multiple cards within a tier before weighting", () => {
    // ultra_rare mean = (1000 + 3000)/2 = 2000; 0.1 * 2000 = 200c per pack
    const r = computeEv(
      {
        product: product({ packsContained: 1, sealed: { a: 400 } }),
        table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 0.1 }] }),
        cards: [card("1", "ultra_rare", { a: 1000 }), card("2", "ultra_rare", { a: 3000 })],
      },
      opts(),
    );
    expect(r.evPackCents).toBeCloseTo(200, 6);
  });

  it("ignores cards whose rarity the table does not list", () => {
    // The common is real and priced, but the table says nothing about how
    // often it appears, so it cannot contribute a knowable expectation.
    const r = computeEv(
      {
        product: product({ packsContained: 1 }),
        table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 0.1 }] }),
        cards: [card("1", "ultra_rare", { a: 1000 }), card("2", "common", { a: 50000 })],
      },
      opts(),
    );
    expect(r.evPackCents).toBeCloseTo(100, 6);
  });
});

// ---------------------------------------------------------------------------
// Guaranteed slots and box guarantees
// ---------------------------------------------------------------------------

describe("computeEv — guaranteed per-pack slots", () => {
  it("adds a deterministic slot's full value to every pack", () => {
    // reverse holo slot: 1 per pack * 200c = 200c, on top of 0.1*1000 = 100c
    const r = computeEv(
      {
        product: product({ packsContained: 1 }),
        table: table({
          slots: [{ rarity: "ultra_rare", perPackProbability: 0.1 }],
          guaranteedSlots: [{ label: "Reverse holo", rarity: "rare", countPerPack: 1 }],
        }),
        cards: [card("1", "ultra_rare", { a: 1000 }), card("2", "rare", { a: 200 })],
      },
      opts(),
    );
    expect(r.guaranteedSlotValueCents).toBeCloseTo(200, 6);
    expect(r.evPackCents).toBeCloseTo(300, 6);
  });
});

describe("computeEv — box guarantees", () => {
  const base = (mode: "additive" | "floor") => ({
    product: product({
      packsContained: 10,
      sealed: { a: 5000 },
      boxGuarantees: [{ label: "SR or better", rarity: "super_rare", count: 1, mode }],
    }),
    table: table({ slots: [{ rarity: "super_rare", perPackProbability: 0.2 }] }),
    cards: [card("1", "super_rare", { a: 1000 })],
  });

  it("additive mode adds the guaranteed card on top of random pulls", () => {
    // EV(pack) = 0.2 * 1000 = 200 -> box = 2000; + 1 * 1000 guaranteed = 3000
    const r = computeEv(base("additive"), opts());
    expect(r.productExtrasValueCents).toBeCloseTo(1000, 6);
    expect(r.evProductCents).toBeCloseTo(3000, 6);
  });

  it("floor mode contributes nothing when random pulls already clear the bar", () => {
    // Expected random SRs = 0.2 * 10 = 2 >= 1 guaranteed, so no shortfall.
    // Adding 1000c here would double-count the guarantee the odds already
    // reflect — the exact bug 'floor' exists to prevent.
    const r = computeEv(base("floor"), opts());
    expect(r.productExtrasValueCents).toBe(0);
    expect(r.evProductCents).toBeCloseTo(2000, 6);
  });

  it("floor mode contributes only the shortfall", () => {
    // Expected random = 0.02 * 10 = 0.2; guarantee 1 => shortfall 0.8
    // extras = 0.8 * 1000 = 800; EV(box) = 0.02*1000*10 = 200; total 1000
    const b = base("floor");
    const r = computeEv(
      {
        ...b,
        table: table({ slots: [{ rarity: "super_rare", perPackProbability: 0.02 }] }),
      },
      opts(),
    );
    expect(r.productExtrasValueCents).toBeCloseTo(800, 6);
    expect(r.evProductCents).toBeCloseTo(1000, 6);
  });
});

describe("computeEv — fixed extras (ETB promo)", () => {
  it("adds a guaranteed promo card's value once per product", () => {
    // EV(pack) 0.1*1000=100 * 8 packs = 800; + promo 500 = 1300
    const r = computeEv(
      {
        product: product({
          type: "etb",
          packsContained: 8,
          sealed: { a: 5000 },
          guaranteedCardIds: ["promo"],
        }),
        table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 0.1 }] }),
        cards: [card("1", "ultra_rare", { a: 1000 }), card("promo", "rare", { a: 500 })],
      },
      opts(),
    );
    expect(r.productExtrasValueCents).toBe(500);
    expect(r.evProductCents).toBeCloseTo(1300, 6);
  });

  it("warns and skips when a guaranteed card exists but has no price", () => {
    // The ETB promo is in the catalog, but the selected source doesn't cover
    // it. Counting it as 0 silently understates the ETB; the warning is what
    // makes that visible.
    const r = computeEv(
      {
        product: product({ packsContained: 1, guaranteedCardIds: ["promo"] }),
        table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 0.1 }] }),
        cards: [card("1", "ultra_rare", { a: 1000 }), card("promo", "rare", { b: 500 })],
      },
      opts(),
    );
    expect(r.productExtrasValueCents).toBe(0);
    expect(r.warnings.join(" ")).toContain("no price from the selected sources");
  });

  it("warns and skips when a guaranteed card is missing from the card list", () => {
    const r = computeEv(
      {
        product: product({ packsContained: 1, guaranteedCardIds: ["ghost"] }),
        table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 0.1 }] }),
        cards: [card("1", "ultra_rare", { a: 1000 })],
      },
      opts(),
    );
    expect(r.productExtrasValueCents).toBe(0);
    expect(r.warnings.join(" ")).toContain("ghost");
  });
});

// ---------------------------------------------------------------------------
// Sealed price fallback chain
// ---------------------------------------------------------------------------

describe("computeEv — sealed price fallback", () => {
  const input = (sealed: Record<string, number>, msrpCents: number | null = null) => ({
    product: product({ packsContained: 1, sealed, msrpCents }),
    table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 0.1 }] }),
    cards: [card("1", "ultra_rare", { a: 1000 })],
  });

  it("uses the selected source and labels it", () => {
    const r = computeEv(input({ a: 500 }), opts({ selectedSources: ["a"] }));
    expect(r.sealedPriceCents).toBe(500);
    expect(r.sealedPriceOrigin).toEqual({ kind: "selected", sourceIds: ["a"] });
  });

  it("labels only the selected sources that actually had a price", () => {
    const r = computeEv(
      input({ a: 500 }),
      opts({ selectedSources: ["a", "missing"], blend: "mean" }),
    );
    expect(r.sealedPriceOrigin).toEqual({ kind: "selected", sourceIds: ["a"] });
  });

  it("falls back to pricecharting before the tcgplayer mirror", () => {
    const r = computeEv(
      input({ pricecharting_ebay: 700, tcgplayer_market: 900 }),
      opts({ selectedSources: ["a"] }),
    );
    expect(r.sealedPriceCents).toBe(700);
    expect(r.sealedPriceOrigin).toEqual({ kind: "fallback", sourceId: "pricecharting_ebay" });
  });

  it("falls back to the tcgplayer mirror when pricecharting has nothing", () => {
    const r = computeEv(input({ tcgplayer_market: 900 }), opts({ selectedSources: ["a"] }));
    expect(r.sealedPriceOrigin).toEqual({ kind: "fallback", sourceId: "tcgplayer_market" });
  });

  it("falls back to MSRP last, and warns", () => {
    const r = computeEv(input({}, 4200), opts({ selectedSources: ["a"] }));
    expect(r.sealedPriceCents).toBe(4200);
    expect(r.sealedPriceOrigin).toEqual({ kind: "msrp" });
    expect(r.warnings.join(" ")).toContain("MSRP");
  });

  it("returns a null ROI, not a bogus one, when nothing prices the product", () => {
    const r = computeEv(input({}, null), opts({ selectedSources: ["a"] }));
    expect(r.sealedPriceCents).toBeNull();
    expect(r.sealedPriceOrigin).toEqual({ kind: "none" });
    expect(r.roi).toBeNull();
    // EV is still knowable even when ROI is not.
    expect(r.evProductCents).toBeCloseTo(100, 6);
  });

  it("returns a null ROI rather than dividing by a zero price", () => {
    const r = computeEv(input({ a: 0 }), opts({ selectedSources: ["a"] }));
    expect(r.roi).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Variance extras
// ---------------------------------------------------------------------------

describe("computeEv — variance extras", () => {
  const input = {
    product: product({ packsContained: 36, sealed: { a: 10000 } }),
    table: table({
      slots: [
        { rarity: "ultra_rare", perPackProbability: 0.05 },
        { rarity: "special_illustration_rare", perPackProbability: 0.0139 },
      ],
    }),
    cards: [
      card("1", "ultra_rare", { a: 2000 }),
      card("2", "special_illustration_rare", { a: 9000 }),
    ],
  };

  it("computes P(at least one) per rarity across the product", () => {
    // 1 - (1 - 0.0139)^36 = 0.39825...
    const r = computeEv(input, opts());
    expect(r.probAtLeastOne["special_illustration_rare"]).toBeCloseTo(
      1 - Math.pow(1 - 0.0139, 36),
      10,
    );
    expect(r.probAtLeastOne["ultra_rare"]).toBeCloseTo(1 - Math.pow(0.95, 36), 10);
  });

  it("sums expected hits across every enumerated tier", () => {
    // (0.05 + 0.0139) * 36 = 2.3004
    expect(computeEv(input, opts()).expectedHits).toBeCloseTo(2.3004, 6);
  });

  it("reports P(at least one) of 0 for an impossible tier", () => {
    const r = computeEv(
      {
        ...input,
        table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 0 }] }),
      },
      opts(),
    );
    expect(r.probAtLeastOne["ultra_rare"]).toBe(0);
  });

  it("reports P(at least one) of 1 for a guaranteed tier", () => {
    const r = computeEv(
      {
        ...input,
        table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 1 }] }),
      },
      opts(),
    );
    expect(r.probAtLeastOne["ultra_rare"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Chase table
// ---------------------------------------------------------------------------

describe("computeEv — chase table", () => {
  it("splits tier odds evenly across the cards in the tier", () => {
    // 2 SIRs share p=0.02 => 0.01 each => 1 in 100 packs
    const r = computeEv(
      {
        product: product({ packsContained: 36 }),
        table: table({ slots: [{ rarity: "special_illustration_rare", perPackProbability: 0.02 }] }),
        cards: [
          card("1", "special_illustration_rare", { a: 9000 }),
          card("2", "special_illustration_rare", { a: 4000 }),
        ],
      },
      opts(),
    );
    expect(r.chase).toHaveLength(2);
    expect(r.chase[0]!.name).toBe("Card 1");
    expect(r.chase[0]!.perPackProbability).toBeCloseTo(0.01, 10);
    expect(r.chase[0]!.oneInPacks).toBeCloseTo(100, 10);
    expect(r.chase[0]!.probPerProduct).toBeCloseTo(1 - Math.pow(0.99, 36), 10);
  });

  it("sorts by value descending", () => {
    const r = computeEv(
      {
        product: product({ packsContained: 36 }),
        table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 0.1 }] }),
        cards: [
          card("low", "ultra_rare", { a: 1500 }),
          card("high", "ultra_rare", { a: 9000 }),
          card("mid", "ultra_rare", { a: 2000 }),
        ],
      },
      opts(),
    );
    expect(r.chase.map((c) => c.cardId)).toEqual(["high", "mid", "low"]);
  });

  it("shows every card over $10, not an arbitrary top-N", () => {
    // 25 cards from $1 to $25; only the 16 at/over $10 are worth chasing.
    const cards = Array.from({ length: 25 }, (_, i) =>
      card(`c${i}`, "ultra_rare", { a: (i + 1) * 100 }),
    );
    const r = computeEv(
      {
        product: product({ packsContained: 36 }),
        table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 0.1 }] }),
        cards,
      },
      opts(),
    );
    expect(r.chase).toHaveLength(16);
    expect(r.chase[0]!.cardId).toBe("c24");
    expect(r.chase.every((c) => c.valueCents >= 1000)).toBe(true);
  });

  it("caps the list so a pathological set can't render hundreds of tiles", () => {
    const cards = Array.from({ length: 80 }, (_, i) =>
      card(`c${i}`, "ultra_rare", { a: 2000 + i }),
    );
    const r = computeEv(
      {
        product: product({ packsContained: 36 }),
        table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 0.1 }] }),
        cards,
      },
      opts(),
    );
    expect(r.chase).toHaveLength(60);
  });

  it("keeps the single best card when nothing clears $10, so the section is never empty", () => {
    const r = computeEv(
      {
        product: product({ packsContained: 36 }),
        table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 0.1 }] }),
        cards: [
          card("cheap1", "ultra_rare", { a: 300 }),
          card("cheap2", "ultra_rare", { a: 800 }),
        ],
      },
      opts(),
    );
    expect(r.chase.map((c) => c.cardId)).toEqual(["cheap2"]);
  });

  it("excludes bulk cards — nobody chases a card worth a cent", () => {
    const r = computeEv(
      {
        product: product({ packsContained: 36 }),
        table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 0.1 }] }),
        cards: [card("bulk", "ultra_rare", { a: 10 }), card("real", "ultra_rare", { a: 5000 })],
      },
      opts(),
    );
    expect(r.chase.map((c) => c.cardId)).toEqual(["real"]);
  });

  it("excludes cards whose rarity the table does not describe", () => {
    const r = computeEv(
      {
        product: product({ packsContained: 36 }),
        table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 0.1 }] }),
        cards: [card("1", "ultra_rare", { a: 5000 }), card("2", "mystery", { a: 90000 })],
      },
      opts(),
    );
    expect(r.chase.map((c) => c.cardId)).toEqual(["1"]);
  });
});

// ---------------------------------------------------------------------------
// Warnings / honesty guarantees
// ---------------------------------------------------------------------------

describe("computeEv — warnings", () => {
  const base = {
    product: product({ packsContained: 1, sealed: { a: 500 } }),
    table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 0.1 }] }),
    cards: [card("1", "ultra_rare", { a: 1000 })],
  };

  it("warns loudly on placeholder pull rates", () => {
    const r = computeEv({ ...base, table: table({ ...base.table, confidence: "placeholder" }) }, opts());
    expect(r.warnings.join(" ")).toContain("placeholder");
  });

  it("warns when the table names a rarity the set has no cards of", () => {
    const r = computeEv(
      { ...base, table: table({ slots: [{ rarity: "typo_rare", perPackProbability: 0.1 }] }) },
      opts(),
    );
    expect(r.warnings.join(" ")).toContain("typo_rare");
  });

  it("warns when a tier has cards but none are priced", () => {
    const r = computeEv({ ...base, cards: [card("1", "ultra_rare", { b: 1000 })] }, opts());
    expect(r.warnings.join(" ")).toContain("No priced cards");
  });

  it("warns when a tier is priced from under half its cards", () => {
    const r = computeEv(
      {
        ...base,
        cards: [
          card("1", "ultra_rare", { a: 1000 }),
          card("2", "ultra_rare", { b: 1 }),
          card("3", "ultra_rare", { b: 1 }),
        ],
      },
      opts(),
    );
    expect(r.warnings.join(" ")).toContain("extrapolation");
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe("computeEv — purity", () => {
  const input = {
    product: product({ packsContained: 36 }),
    table: table({ slots: [{ rarity: "ultra_rare", perPackProbability: 0.1 }] }),
    cards: [card("1", "ultra_rare", { a: 1000 })],
  };

  it("is deterministic across repeated calls", () => {
    expect(computeEv(input, opts())).toEqual(computeEv(input, opts()));
  });

  it("does not mutate its inputs", () => {
    const snapshot = structuredClone(input);
    computeEv(input, opts());
    expect(input).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// packsForProbability
// ---------------------------------------------------------------------------

describe("packsForProbability", () => {
  it("solves for a 50% chance", () => {
    // p=0.01: log(0.5)/log(0.99) = 68.97 -> 69 packs
    expect(packsForProbability(0.01, 0.5)).toBe(69);
  });

  it("solves for a 90% chance", () => {
    // p=0.01: log(0.1)/log(0.99) = 229.1 -> 230 packs
    expect(packsForProbability(0.01, 0.9)).toBe(230);
  });

  it("rounds up — a fractional pack does not exist", () => {
    const n = packsForProbability(0.01, 0.5);
    expect(Number.isInteger(n)).toBe(true);
    expect(1 - Math.pow(0.99, n)).toBeGreaterThanOrEqual(0.5);
  });

  it("needs one pack when the card is in every pack", () => {
    expect(packsForProbability(1, 0.9)).toBe(1);
  });

  it("returns Infinity for an unpullable card", () => {
    expect(packsForProbability(0, 0.5)).toBe(Infinity);
  });

  it("returns Infinity for certainty — you can never be sure", () => {
    expect(packsForProbability(0.5, 1)).toBe(Infinity);
  });

  it("needs no packs for a zero-probability target", () => {
    expect(packsForProbability(0.5, 0)).toBe(0);
  });
});
