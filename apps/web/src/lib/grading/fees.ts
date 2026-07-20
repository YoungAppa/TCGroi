/**
 * PSA grading economics — the honest, data-available slice of "should I grade
 * it?". We deliberately do NOT invent graded (PSA 10/9) prices or per-card
 * grade odds: PriceCharting's guide carries only ungraded prices, and per-card
 * PSA population data needs a PSA data source we don't have. What we CAN state
 * with real numbers is the grading FEE and the break-even the graded card must
 * clear — which is most of the decision.
 *
 * Fees are PSA's US published per-card rates, cheapest tier that accepts a
 * given declared value, approximate and excluding shipping. They change; this
 * schedule is dated so a stale number is obvious rather than silent.
 */
export const PSA_FEES_AS_OF = "2025";

interface FeeTier {
  /** Inclusive upper bound on declared value, in cents. */
  maxValueCents: number;
  feeCents: number;
  service: string;
}

/** Ascending by value. The first tier a declared value fits is the cheapest. */
export const PSA_FEE_TIERS: readonly FeeTier[] = [
  { maxValueCents: 49_900, feeCents: 2_499, service: "Value" },
  { maxValueCents: 99_900, feeCents: 3_999, service: "Value Plus" },
  { maxValueCents: 149_900, feeCents: 7_499, service: "Regular" },
  { maxValueCents: 249_900, feeCents: 14_999, service: "Express" },
  { maxValueCents: 499_900, feeCents: 29_999, service: "Super Express" },
  { maxValueCents: 999_900, feeCents: 64_999, service: "WalkThrough" },
  { maxValueCents: Number.POSITIVE_INFINITY, feeCents: 149_999, service: "Premium" },
];

export interface GradingCost {
  feeCents: number;
  service: string;
  /** What a PSA 10 must sell for to beat just selling the raw card. */
  breakEvenCents: number;
}

/**
 * Grading cost for a card, using its raw value to pick the fee tier (you
 * declare roughly what the graded card is worth; raw is the honest floor we
 * have). Break-even is raw + fee: below that, grading loses money even on a
 * perfect 10, before accounting for the risk of a lower grade.
 */
export function gradingCost(rawCents: number): GradingCost {
  const tier =
    PSA_FEE_TIERS.find((t) => rawCents <= t.maxValueCents) ??
    PSA_FEE_TIERS[PSA_FEE_TIERS.length - 1]!;
  return {
    feeCents: tier.feeCents,
    service: tier.service,
    breakEvenCents: rawCents + tier.feeCents,
  };
}
