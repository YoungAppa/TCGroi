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
 *
 * As of 2026-06-02 PSA PAUSED all of its cheaper "Value" tiers (Value Bulk
 * $24.99 / Value $32.99 / Value Plus $49.99 / Value Max $64.99) under an
 * ~14M-card backlog, so the cheapest service anyone can actually submit to
 * today is Regular at $79.99. We model that real floor rather than a paused
 * price you cannot buy. If PSA reopens the Value tiers, add them back below and
 * bump PSA_FEES_AS_OF — the break-even floor for cheap cards would drop.
 */
export const PSA_FEES_AS_OF = "Jul 2026";

interface FeeTier {
  /** Inclusive upper bound on declared value, in cents. */
  maxValueCents: number;
  feeCents: number;
  service: string;
}

/**
 * Ascending by declared value; the first tier a declared value fits is the
 * cheapest. Value tiers are omitted while PSA has them paused (see file note).
 */
export const PSA_FEE_TIERS: readonly FeeTier[] = [
  { maxValueCents: 150_000, feeCents: 7_999, service: "Regular" },
  { maxValueCents: 250_000, feeCents: 14_900, service: "Express" },
  { maxValueCents: 500_000, feeCents: 34_900, service: "Super Express" },
  { maxValueCents: 1_000_000, feeCents: 59_900, service: "Walk-Through" },
  { maxValueCents: 2_500_000, feeCents: 99_900, service: "Premium 1" },
  { maxValueCents: Number.POSITIVE_INFINITY, feeCents: 149_900, service: "Premium" },
];

export interface GradingCost {
  feeCents: number;
  service: string;
  /** What a PSA 10 must sell for to beat just selling the raw card. */
  breakEvenCents: number;
}

/**
 * Grading cost for a card. PSA sets the service tier by the DECLARED value —
 * what the graded card is worth — so pass `declaredValueCents` (the PSA 10
 * price) when known; without it we fall back to the raw value, which can
 * under-declare the fee for a card whose graded price crosses a tier line.
 * Break-even is raw + fee: below that, grading loses money even on a perfect
 * 10, before accounting for the risk of a lower grade.
 */
export function gradingCost(rawCents: number, declaredValueCents?: number): GradingCost {
  const declared = declaredValueCents ?? rawCents;
  const tier =
    PSA_FEE_TIERS.find((t) => declared <= t.maxValueCents) ??
    PSA_FEE_TIERS[PSA_FEE_TIERS.length - 1]!;
  return {
    feeCents: tier.feeCents,
    service: tier.service,
    breakEvenCents: rawCents + tier.feeCents,
  };
}
