import { mean, median } from "./blend";
import { effectiveCardValue } from "./value";
import type { CardPriceData, EvOptions, TierAggregation } from "./types";

export interface TierValue {
  avgValueCents: number;
  pricedCardCount: number;
  totalCardCount: number;
}

function aggregate(values: number[], how: TierAggregation): number | null {
  return how === "mean" ? mean(values) : median(values);
}

/**
 * Groups a set's cards by rarity once, so the per-tier pass is O(cards) rather
 * than O(cards * tiers).
 */
export function groupByRarity(
  cards: CardPriceData[],
): Map<string, CardPriceData[]> {
  const out = new Map<string, CardPriceData[]>();
  for (const c of cards) {
    const bucket = out.get(c.rarity);
    if (bucket) bucket.push(c);
    else out.set(c.rarity, [c]);
  }
  return out;
}

/**
 * The value of a single card of tier `rarity`, aggregated across every card of
 * that rarity in the set.
 *
 * Unpriced cards are excluded from the aggregate rather than counted as zero,
 * but they are still reported in totalCardCount so callers can see the
 * coverage gap. A tier where 2 of 20 cards are priced produces a number, but
 * it is a number built from 10% of the tier — the caller decides whether that
 * is fit to publish.
 *
 * Assumption: every card within a tier is equally likely. Real sets violate
 * this (some SIRs are demonstrably harder to hit), but no public data
 * quantifies per-card weighting, so uniform-within-tier is the honest default.
 */
export function tierValue(
  rarity: string,
  byRarity: Map<string, CardPriceData[]>,
  opts: EvOptions,
): TierValue {
  const cards = byRarity.get(rarity) ?? [];
  const values: number[] = [];

  for (const c of cards) {
    const v = effectiveCardValue(c, opts);
    if (v !== null) values.push(v.valueCents);
  }

  return {
    avgValueCents: aggregate(values, opts.tierAggregation) ?? 0,
    pricedCardCount: values.length,
    totalCardCount: cards.length,
  };
}
