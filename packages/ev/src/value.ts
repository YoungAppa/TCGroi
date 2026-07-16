import { blendPrices } from "./blend";
import type { CardPriceData, EvOptions } from "./types";

export interface CardValue {
  valueCents: number;
  /** True when the bulk floor replaced the listed price. */
  isBulk: boolean;
  /** True when the graded expectation replaced the raw price. */
  isGraded: boolean;
}

/**
 * What one copy of this card is worth to the opener, under the current
 * options. Returns null when no selected source prices it — the caller must
 * treat that as unknown and exclude the card, never as zero.
 *
 * Order of operations matters:
 *   1. blend raw across selected sources
 *   2. bulk floor        (a 20c card is bulk even if its PSA 10 is $100 —
 *                         nobody grades a 20c card, and the floor models what
 *                         you can actually realise for it)
 *   3. graded expectation (only above gradingMinValueCents)
 */
export function effectiveCardValue(
  card: CardPriceData,
  opts: EvOptions,
): CardValue | null {
  const raw = blendPrices(card.raw, opts.selectedSources, opts.blend);
  if (raw === null) return null;

  // Threshold is exclusive: a card exactly at it is not bulk.
  if (raw < opts.bulkThresholdCents) {
    return { valueCents: opts.bulkValueCents, isBulk: true, isGraded: false };
  }

  if (opts.graded && raw >= opts.grading.gradingMinValueCents) {
    const psa10 = card.psa10
      ? blendPrices(card.psa10, opts.selectedSources, opts.blend)
      : null;
    const psa9 = card.psa9
      ? blendPrices(card.psa9, opts.selectedSources, opts.blend)
      : null;

    // Both legs are required: half the formula is not an estimate worth
    // showing. When graded data is absent the card just sells raw.
    if (psa10 !== null && psa9 !== null) {
      const { gemRate, grade9Rate, gradingFeeCents } = opts.grading;

      // NOTE(model): gemRate + grade9Rate is 0.80 by default, so the ~20% of
      // submissions grading 8 or lower contribute nothing here. Those cards
      // are not worthless in reality, so this understates graded EV. It is the
      // specified formula and it errs conservative, which is the right
      // direction for a site whose whole point is "opening is -EV" — but it is
      // an assumption, and the /methodology page says so.
      const graded = psa10 * gemRate + psa9 * grade9Rate - gradingFeeCents;

      // Grading can genuinely destroy value on a marginal card; the mode is
      // allowed to show that. It is NOT clamped up to raw — that would answer
      // a different question ("should you grade?") than the one the toggle
      // asks ("what if you graded?"). It is clamped at zero: you cannot lose
      // more than the card plus the fee, and negative card values would make
      // tier averages nonsense.
      return {
        valueCents: Math.max(0, graded),
        isBulk: false,
        isGraded: true,
      };
    }
  }

  return { valueCents: raw, isBulk: false, isGraded: false };
}
