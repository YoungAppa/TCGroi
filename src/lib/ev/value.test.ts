import { describe, expect, it } from "vitest";

import { effectiveCardValue } from "./value";
import { DEFAULT_EV_OPTIONS, type CardPriceData, type EvOptions } from "./types";

const opts = (over: Partial<EvOptions> = {}): EvOptions => ({
  ...DEFAULT_EV_OPTIONS,
  selectedSources: ["a"],
  ...over,
});

const card = (over: Partial<CardPriceData> = {}): CardPriceData => ({
  cardId: "c1",
  name: "Test Card",
  number: "001/100",
  rarity: "rare",
  raw: { a: 1000 },
  ...over,
});

describe("effectiveCardValue — raw", () => {
  it("uses the blended raw price", () => {
    const r = effectiveCardValue(card({ raw: { a: 1000, b: 2000 } }), opts({ selectedSources: ["a", "b"], blend: "mean" }));
    expect(r).toEqual({ valueCents: 1500, isBulk: false, isGraded: false });
  });

  it("returns null when no selected source prices the card", () => {
    // Unknown must stay unknown: a null here excludes the card from its tier
    // average rather than pulling that average toward zero.
    expect(effectiveCardValue(card({ raw: { b: 500 } }), opts())).toBeNull();
  });
});

describe("effectiveCardValue — bulk floor", () => {
  it("floors a card priced below the threshold to the bulk value", () => {
    const r = effectiveCardValue(card({ raw: { a: 30 } }), opts());
    expect(r).toEqual({ valueCents: 1, isBulk: true, isGraded: false });
  });

  it("does not floor a card exactly at the threshold", () => {
    // Threshold is exclusive: 50c is not bulk.
    const r = effectiveCardValue(card({ raw: { a: 50 } }), opts());
    expect(r).toEqual({ valueCents: 50, isBulk: false, isGraded: false });
  });

  it("floors based on the blended price, not any single source", () => {
    // a says 10c, b says 60c; mean is 35c => bulk. The blend decides.
    const r = effectiveCardValue(
      card({ raw: { a: 10, b: 60 } }),
      opts({ selectedSources: ["a", "b"], blend: "mean" }),
    );
    expect(r).toEqual({ valueCents: 1, isBulk: true, isGraded: false });
  });

  it("respects a configured bulk value and threshold", () => {
    const r = effectiveCardValue(
      card({ raw: { a: 90 } }),
      opts({ bulkThresholdCents: 100, bulkValueCents: 5 }),
    );
    expect(r).toEqual({ valueCents: 5, isBulk: true, isGraded: false });
  });

  it("bulk floor can raise a near-zero price up to the bulk value", () => {
    // A 0c listing is still a physical card worth bulk rate.
    const r = effectiveCardValue(card({ raw: { a: 0 } }), opts());
    expect(r).toEqual({ valueCents: 1, isBulk: true, isGraded: false });
  });
});

describe("effectiveCardValue — graded mode", () => {
  const gradedOpts = opts({ graded: true });

  it("replaces raw with the graded expectation above the min value", () => {
    // 10000*0.45 + 6000*0.35 - 1900 = 4500 + 2100 - 1900 = 4700
    const r = effectiveCardValue(
      card({ raw: { a: 3000 }, psa10: { a: 10000 }, psa9: { a: 6000 } }),
      gradedOpts,
    );
    expect(r).toEqual({ valueCents: 4700, isBulk: false, isGraded: true });
  });

  it("leaves cards below the grading min value raw", () => {
    // $15 raw < $20 min: nobody grades this, so graded mode changes nothing.
    const r = effectiveCardValue(
      card({ raw: { a: 1500 }, psa10: { a: 10000 }, psa9: { a: 6000 } }),
      gradedOpts,
    );
    expect(r).toEqual({ valueCents: 1500, isBulk: false, isGraded: false });
  });

  it("falls back to raw when graded prices are missing", () => {
    const r = effectiveCardValue(card({ raw: { a: 3000 } }), gradedOpts);
    expect(r).toEqual({ valueCents: 3000, isBulk: false, isGraded: false });
  });

  it("falls back to raw when only psa10 is known", () => {
    // Half the formula is not a usable estimate.
    const r = effectiveCardValue(
      card({ raw: { a: 3000 }, psa10: { a: 10000 } }),
      gradedOpts,
    );
    expect(r).toEqual({ valueCents: 3000, isBulk: false, isGraded: false });
  });

  it("can produce a graded value below raw when grading is not worth it", () => {
    // 2500*0.45 + 2200*0.35 - 1900 = 1125 + 770 - 1900 = -5 -> clamped to 0.
    // The mode answers "what if you graded these", so it must be allowed to
    // show that grading destroys value. It is not clamped up to raw.
    const r = effectiveCardValue(
      card({ raw: { a: 2400 }, psa10: { a: 2500 }, psa9: { a: 2200 } }),
      gradedOpts,
    );
    expect(r).toEqual({ valueCents: 0, isBulk: false, isGraded: true });
  });

  it("never returns a negative value", () => {
    const r = effectiveCardValue(
      card({ raw: { a: 2100 }, psa10: { a: 2100 }, psa9: { a: 2000 } }),
      gradedOpts,
    );
    expect(r!.valueCents).toBe(0);
  });

  it("honours adjusted grading assumptions", () => {
    // 10000*0.5 + 6000*0.4 - 1000 = 5000 + 2400 - 1000 = 6400
    const r = effectiveCardValue(
      card({ raw: { a: 3000 }, psa10: { a: 10000 }, psa9: { a: 6000 } }),
      opts({
        graded: true,
        grading: {
          gemRate: 0.5,
          grade9Rate: 0.4,
          gradingFeeCents: 1000,
          gradingMinValueCents: 2000,
        },
      }),
    );
    expect(r).toEqual({ valueCents: 6400, isBulk: false, isGraded: true });
  });

  it("blends graded prices across sources like raw prices", () => {
    // psa10 mean = 11000, psa9 mean = 5000
    // 11000*0.45 + 5000*0.35 - 1900 = 4950 + 1750 - 1900 = 4800
    const r = effectiveCardValue(
      card({
        raw: { a: 3000, b: 3000 },
        psa10: { a: 10000, b: 12000 },
        psa9: { a: 4000, b: 6000 },
      }),
      opts({ graded: true, selectedSources: ["a", "b"], blend: "mean" }),
    );
    expect(r).toEqual({ valueCents: 4800, isBulk: false, isGraded: true });
  });

  it("applies the bulk floor before considering grading", () => {
    const r = effectiveCardValue(
      card({ raw: { a: 20 }, psa10: { a: 10000 }, psa9: { a: 6000 } }),
      gradedOpts,
    );
    expect(r).toEqual({ valueCents: 1, isBulk: true, isGraded: false });
  });
});
