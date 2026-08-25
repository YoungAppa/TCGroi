import { groupByRarity } from "./tiers";
import { effectiveCardValue } from "./value";
import type { CardPriceData, EvOptions, PullRateTable } from "./types";

/**
 * "What are the odds you make a profit?" — the distribution behind the EV.
 *
 * EV says what the average unbox is worth; it says nothing about how often you
 * beat the price you paid, because pack outcomes are wildly skewed: most packs
 * are bulk, and the mean is carried by rare big hits. This module simulates
 * whole-product openings and reports where the threshold falls in the actual
 * outcome distribution.
 *
 * Honesty notes, mirrored in the UI:
 *  - Same assumptions as EV: uniform odds within a tier (real sets short-print
 *    chases, which makes profit odds look BETTER here than they are — the same
 *    direction of error as the flat tier average), market prices, no selling
 *    fees. Bulk cards count at the bulk floor via tier values, same as EV.
 *  - Deterministic: a seeded PRNG, so the same inputs always render the same
 *    percentages. No Math.random.
 *  - Guaranteed per-pack slots and fixed extras are added as constants — they
 *    are guarantees, not gambles.
 */

export interface ProfitGroup {
  table: PullRateTable;
  cards: CardPriceData[];
  /**
   * Packs of this group in the product. May be fractional for assorted
   * mixed-set products modelled as a uniform draw (e.g. 16 packs over 12 sets
   * = 1.333 packs per set): the fraction becomes a Bernoulli extra pack, which
   * is exactly what "assorted" means for a single box.
   */
  packs: number;
}

export interface UnboxDistribution {
  /** Sorted ascending, one simulated whole-product unbox value per trial. */
  totalsCents: Float64Array;
  trials: number;
}

/** Mulberry32 — tiny, seedable, plenty for tail probabilities at 20k trials. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simulate `trials` full-product openings. Returns null when no tier in any
 * group has a priced card — there is nothing to simulate.
 */
export function simulateUnboxes(
  groups: ProfitGroup[],
  fixedExtrasCents: number,
  opts: EvOptions,
  trials = 20000,
  seed = 0x5eed,
): UnboxDistribution | null {
  // Precompute per-group, per-slot: probability + the tier's priced effective
  // values (the pool a hit is drawn from) + guaranteed constant per pack.
  const prepared = groups.map((g) => {
    const byRarity = groupByRarity(g.cards);
    const slots = g.table.slots.map((slot) => {
      const pool: number[] = [];
      for (const card of byRarity.get(slot.rarity) ?? []) {
        const v = effectiveCardValue(card, opts);
        if (v !== null) pool.push(v.valueCents);
      }
      return { p: slot.perPackProbability, pool };
    });
    let guaranteedCents = 0;
    for (const gs of g.table.guaranteedSlots) {
      const pool: number[] = [];
      for (const card of byRarity.get(gs.rarity) ?? []) {
        const v = effectiveCardValue(card, opts);
        if (v !== null) pool.push(v.valueCents);
      }
      if (pool.length > 0) {
        guaranteedCents +=
          (gs.countPerPack * pool.reduce((s, x) => s + x, 0)) / pool.length;
      }
    }
    return { slots, guaranteedCents, packs: g.packs };
  });

  if (!prepared.some((g) => g.slots.some((s) => s.pool.length > 0))) return null;

  const rand = prng(seed);
  const totals = new Float64Array(trials);

  for (let t = 0; t < trials; t++) {
    let total = fixedExtrasCents;
    for (const g of prepared) {
      const whole = Math.floor(g.packs);
      const frac = g.packs - whole;
      const packCount = whole + (frac > 0 && rand() < frac ? 1 : 0);
      total += packCount * g.guaranteedCents;
      for (let k = 0; k < packCount; k++) {
        for (const slot of g.slots) {
          if (slot.pool.length === 0) continue;
          if (rand() < slot.p) {
            total += slot.pool[Math.floor(rand() * slot.pool.length)]!;
          }
        }
      }
    }
    totals[t] = total;
  }

  totals.sort();
  return { totalsCents: totals, trials };
}

/** Share of simulated unboxes strictly above the threshold. */
export function probAbove(dist: UnboxDistribution, thresholdCents: number): number {
  const a = dist.totalsCents;
  // Binary search for the first index > threshold.
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid]! > thresholdCents) hi = mid;
    else lo = mid + 1;
  }
  return (a.length - lo) / a.length;
}

/** Percentile (0–1) of the simulated unbox distribution, in cents. */
export function percentile(dist: UnboxDistribution, q: number): number {
  const a = dist.totalsCents;
  const idx = Math.min(a.length - 1, Math.max(0, Math.floor(q * a.length)));
  return a[idx]!;
}
