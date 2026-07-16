import type { CardPriceData, PriceBySource, PullRateSlot } from "@packroi/ev/types";
import type { AlternateEstimate, Confidence } from "@/lib/pullrates/schema";

/**
 * The payload a product page ships to the client.
 *
 * This is the contract that makes instant source-toggling work: it carries
 * per-source prices for every card, and the client reruns the pure EV engine
 * locally when the user changes sources/blend/mode. No refetch, no server
 * round-trip, no external API anywhere near a page view.
 *
 * Today it is served from a build-time fixture (no DB yet); the DB data layer
 * will serve the identical shape, so pages don't change when it lands.
 */

export interface ProductPayload {
  gameSlug: "pokemon" | "one-piece";
  gameName: string;
  setCode: string;
  setName: string;
  releaseDate: string | null;

  productId: string;
  productName: string;
  productSlug: string;
  productType: "booster_pack" | "booster_box" | "etb" | "bundle" | "display" | "case";
  packsContained: number;
  /** Set logo, used as the product's visual identity. */
  imageUrl: string | null;

  /**
   * The two denominators, kept separate on purpose (the csroi-style split):
   *
   *  - retail: MSRP. What the product costs if you can find it at retail.
   *  - market: what it actually costs today. Live sealed source prices when a
   *    sealed-capable source is configured; otherwise the hand-tracked figure
   *    with its provenance. isManual tells the UI which it got.
   *
   * ROI is computed against each, because "−35% at MSRP" and "−65% at what
   * scalpers charge" are both true and answer different questions.
   */
  msrpCents: number | null;
  market: {
    priceCents: number | null;
    /** True when this is the hand-tracked figure, not a live source price. */
    isManual: boolean;
    asOf: string | null;
    source: string | null;
  };
  /** Per-source sealed prices (live). Feeds market when non-empty. */
  sealed: PriceBySource;

  guaranteedCardIds: string[];
  /** Guaranteed extras resolved for display: the promo sidecar. */
  promos: { cardId: string; name: string; number: string; imageUrl: string | null }[];
  /** Unmodelled contents (metal cards, playmats) the buyer should know about. */
  contentsNote: string | null;
  boxGuarantees: {
    label: string;
    rarity: string;
    count: number;
    mode: "additive" | "floor";
  }[];

  pullRates: {
    version: number;
    sampleSizePacks: number | null;
    sourceUrl: string;
    sourceNote: string;
    confidence: Confidence;
    slots: PullRateSlot[];
    guaranteedSlots: { label: string; rarity: string; countPerPack: number }[];
    alternateEstimates: AlternateEstimate[];
  };

  /** Every card in the set with per-source prices. The big part. */
  cards: CardPriceData[];
}

/** Everything the home rankings page needs, one entry per product. */
export interface RankingsPayload {
  generatedAt: string;
  /** Source ids that were enabled when this payload was built. */
  availableSources: { id: string; displayName: string }[];
  products: ProductPayload[];
}
