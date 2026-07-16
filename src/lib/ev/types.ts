/**
 * Types for the EV engine.
 *
 * Money: integer cents at every boundary (in and out of this module). Inside
 * the engine an expectation is genuinely fractional — 0.055 * $12.00 is not a
 * whole number of cents — so intermediate values are plain numbers carrying
 * cents, and rounding happens only at the display edge. Rounding early and
 * summing would drift by a cent per tier.
 *
 * Probability: floats in [0, 1], expressed per pack.
 */

export type Cents = number;

/** How to combine several sources' prices for the same entity. */
export type BlendStrategy = "median" | "mean" | "min" | "max";

/** How to combine several cards' values into one tier value. */
export type TierAggregation = "mean" | "median";

/** priceCents keyed by price-source id. A missing source key means no data. */
export type PriceBySource = Record<string, Cents>;

export interface CardPriceData {
  cardId: string;
  name: string;
  /** Collector number as printed, for the chase table. */
  number: string;
  /** Must match a rarity slug in the set's pull-rate table to contribute. */
  rarity: string;
  raw: PriceBySource;
  psa9?: PriceBySource;
  psa10?: PriceBySource;
}

export interface PullRateSlot {
  rarity: string;
  /** Expected number of cards of this rarity per pack, as a probability. */
  perPackProbability: number;
}

/**
 * A slot every pack contains by construction (e.g. Pokémon's reverse-holo
 * slot). Contributes deterministically rather than probabilistically.
 */
export interface GuaranteedSlot {
  label: string;
  rarity: string;
  countPerPack: number;
}

/**
 * A per-box guarantee (One Piece: "SR or better in every box").
 *
 * `mode` matters and is easy to get wrong:
 *  - "additive": the guaranteed card is on top of the random pulls. Correct
 *    only when the community's measured per-pack rates EXCLUDE it.
 *  - "floor": the box contains at least `count`; random pulls count toward it.
 *    Correct when measured rates already include the guaranteed card, which is
 *    the usual case for observed pack-opening data. Contributes only the
 *    shortfall, so it never double-counts.
 * Defaulting to "additive" would silently inflate EV for exactly the sets that
 * have guarantees, so the data must state its mode explicitly.
 */
export interface BoxGuarantee {
  label: string;
  rarity: string;
  count: number;
  mode: "additive" | "floor";
}

export interface PullRateTable {
  setId: string;
  version: number;
  sampleSizePacks: number;
  sourceUrl: string;
  sourceNote: string;
  confidence: "high" | "medium" | "low" | "placeholder";
  slots: PullRateSlot[];
  guaranteedSlots: GuaranteedSlot[];
}

export interface SealedProductInput {
  productId: string;
  name: string;
  slug: string;
  type: "booster_pack" | "booster_box" | "etb" | "bundle" | "display" | "case";
  packsContained: number;
  msrpCents: Cents | null;
  /** Sealed price per source; may be empty when no source has data. */
  sealed: PriceBySource;
  /** Fixed extras, e.g. an ETB promo. Valued at their own raw price. */
  guaranteedCardIds: string[];
  boxGuarantees: BoxGuarantee[];
}

/** Graded-mode assumptions. All UI-adjustable; these are the defaults. */
export interface GradingAssumptions {
  gemRate: number;
  grade9Rate: number;
  gradingFeeCents: Cents;
  /** Below this raw value, grading is not modelled — the card sells raw. */
  gradingMinValueCents: Cents;
}

export const DEFAULT_GRADING: GradingAssumptions = {
  gemRate: 0.45,
  grade9Rate: 0.35,
  gradingFeeCents: 1900,
  gradingMinValueCents: 2000,
};

export interface EvOptions {
  /** Price-source ids the user has toggled on. Order irrelevant. */
  selectedSources: string[];
  blend: BlendStrategy;
  tierAggregation: TierAggregation;
  /** Cards priced below this contribute bulkValueCents instead. */
  bulkThresholdCents: Cents;
  /** What a sub-threshold card is actually worth to you. */
  bulkValueCents: Cents;
  graded: boolean;
  grading: GradingAssumptions;
}

export const DEFAULT_EV_OPTIONS: Omit<EvOptions, "selectedSources"> = {
  blend: "median",
  tierAggregation: "mean",
  bulkThresholdCents: 50,
  // Realistic bulk resale: roughly a cent a card. Not zero — you can sell bulk
  // by the thousand — but nowhere near a listed $0.30.
  bulkValueCents: 1,
  graded: false,
  grading: DEFAULT_GRADING,
};

/** Which source a sealed price came from, after the fallback chain. */
export type SealedPriceOrigin =
  | { kind: "selected"; sourceIds: string[] }
  | { kind: "fallback"; sourceId: string }
  | { kind: "msrp" }
  | { kind: "none" };

export interface TierBreakdown {
  rarity: string;
  perPackProbability: number;
  /** Aggregated value of one card of this tier, after bulk/graded handling. */
  avgValueCents: number;
  /** perPackProbability * avgValueCents — this tier's share of EV(pack). */
  evContributionCents: number;
  /** Cards of this rarity that had a usable price. */
  pricedCardCount: number;
  /** Cards of this rarity in the set, priced or not. */
  totalCardCount: number;
}

export interface ChaseCard {
  cardId: string;
  name: string;
  number: string;
  rarity: string;
  valueCents: number;
  /** Probability this specific card appears in a given pack. */
  perPackProbability: number;
  /** 1-in-N packs phrasing. Infinity when probability is 0. */
  oneInPacks: number;
  /** Probability of pulling at least one across the whole product. */
  probPerProduct: number;
}

export interface EvResult {
  productId: string;
  evPackCents: number;
  evProductCents: number;
  /** null when no sealed price and no MSRP exist — ROI is unknowable. */
  roi: number | null;
  sealedPriceCents: Cents | null;
  sealedPriceOrigin: SealedPriceOrigin;
  tiers: TierBreakdown[];
  /** Deterministic per-pack slots, folded into evPackCents. */
  guaranteedSlotValueCents: number;
  /** Box-level guarantees + fixed extras, folded into evProductCents. */
  productExtrasValueCents: number;
  chase: ChaseCard[];
  /** Expected count of "hit" cards per product. */
  expectedHits: number;
  /** P(at least one card of the given rarity) per product, keyed by rarity. */
  probAtLeastOne: Record<string, number>;
  /** Set when the result is not trustworthy enough to rank publicly. */
  warnings: string[];
}
