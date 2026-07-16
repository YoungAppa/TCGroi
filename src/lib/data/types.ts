import type { CardPriceData, PriceBySource, PullRateSlot } from "@/lib/ev/types";
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
  msrpCents: number | null;
  /**
   * Per-source sealed prices. May be empty — the EV engine's fallback chain
   * (pricecharting -> tcgplayer_market -> MSRP) handles that and labels what
   * it used.
   */
  sealed: PriceBySource;
  /** True while sealed prices are hand-entered demo values, not live data. */
  sealedIsPlaceholder: boolean;
  guaranteedCardIds: string[];
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
