import { describe, expect, it } from "vitest";

import { percentile, probAbove, simulateUnboxes, type ProfitGroup } from "./profit";
import type { CardPriceData, EvOptions, PullRateTable } from "./types";

const OPTS: EvOptions = {
  selectedSources: ["src"],
  blend: "median",
  bulkThresholdCents: 50,
  bulkValueCents: 1,
  graded: false,
  gradingMinValueCents: 10000,
  gradingFeeCents: 2500,
  gemRate: 0.45,
  grade9Rate: 0.35,
};

function card(id: string, rarity: string, cents: number): CardPriceData {
  return { cardId: id, name: id, number: "1", rarity, raw: { src: cents } };
}

function table(slots: { rarity: string; perPackProbability: number }[]): PullRateTable {
  return {
    setId: "t",
    version: 1,
    sampleSizePacks: 1000,
    sourceUrl: "https://example.com",
    sourceNote: "test",
    confidence: "high",
    slots,
    guaranteedSlots: [],
  };
}

describe("simulateUnboxes", () => {
  it("is deterministic for the same seed", () => {
    const groups: ProfitGroup[] = [
      { table: table([{ rarity: "rare", perPackProbability: 0.3 }]), cards: [card("a", "rare", 1000)], packs: 10 },
    ];
    const d1 = simulateUnboxes(groups, 0, OPTS, 2000, 42)!;
    const d2 = simulateUnboxes(groups, 0, OPTS, 2000, 42)!;
    expect(Array.from(d1.totalsCents)).toEqual(Array.from(d2.totalsCents));
  });

  it("returns null when nothing is priced", () => {
    const groups: ProfitGroup[] = [
      { table: table([{ rarity: "rare", perPackProbability: 0.3 }]), cards: [], packs: 10 },
    ];
    expect(simulateUnboxes(groups, 0, OPTS)).toBeNull();
  });

  it("certain hit worth more than price -> probability 1", () => {
    const groups: ProfitGroup[] = [
      { table: table([{ rarity: "rare", perPackProbability: 1 }]), cards: [card("a", "rare", 5000)], packs: 2 },
    ];
    const d = simulateUnboxes(groups, 0, OPTS, 1000, 7)!;
    // Every trial: 2 packs x guaranteed $50 hit = $100 > $60.
    expect(probAbove(d, 6000)).toBe(1);
    expect(probAbove(d, 10000)).toBe(0); // never STRICTLY above $100
  });

  it("impossible hit -> probability 0 and all-bulk totals", () => {
    const groups: ProfitGroup[] = [
      { table: table([{ rarity: "rare", perPackProbability: 0 }]), cards: [card("a", "rare", 5000)], packs: 36 },
    ];
    const d = simulateUnboxes(groups, 0, OPTS, 1000, 7)!;
    expect(probAbove(d, 100)).toBe(0);
    expect(percentile(d, 0.5)).toBe(0);
  });

  it("matches the analytic probability for a single Bernoulli slot", () => {
    // One pack, one 30% slot, one $10 card, threshold $5: P(win) = 0.3.
    const groups: ProfitGroup[] = [
      { table: table([{ rarity: "rare", perPackProbability: 0.3 }]), cards: [card("a", "rare", 1000)], packs: 1 },
    ];
    const d = simulateUnboxes(groups, 0, OPTS, 50000, 99)!;
    expect(probAbove(d, 500)).toBeGreaterThan(0.28);
    expect(probAbove(d, 500)).toBeLessThan(0.32);
  });

  it("fixed extras shift the whole distribution", () => {
    const groups: ProfitGroup[] = [
      { table: table([{ rarity: "rare", perPackProbability: 0 }]), cards: [card("a", "rare", 5000)], packs: 1 },
    ];
    const d = simulateUnboxes(groups, 2000, OPTS, 100, 7)!;
    expect(percentile(d, 0.5)).toBe(2000);
    expect(probAbove(d, 1999)).toBe(1);
  });

  it("fractional packs land between the whole-pack bounds", () => {
    const mk = (packs: number) =>
      simulateUnboxes(
        [{ table: table([{ rarity: "rare", perPackProbability: 1 }]), cards: [card("a", "rare", 1000)], packs }],
        0,
        OPTS,
        20000,
        123,
      )!;
    // 1.5 packs of a guaranteed $10 hit: mean sits near $15, between 1 and 2 packs.
    const d = mk(1.5);
    const mean = Array.from(d.totalsCents).reduce((s, x) => s + x, 0) / d.trials;
    expect(mean).toBeGreaterThan(1400);
    expect(mean).toBeLessThan(1600);
  });
});
