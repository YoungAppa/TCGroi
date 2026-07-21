/**
 * Static registry of every price source the app knows about.
 *
 * This is deliberately separate from the adapter implementations: the DB needs
 * price_sources rows to exist before any snapshot can reference them, and the
 * UI needs display names for sources that may currently be disabled. Whether a
 * source is *usable* is decided at runtime by its adapter's enabled().
 */

export const PRICE_SOURCE_IDS = [
  "tcgplayer_market",
  "pricecharting_ebay",
  "ebay_direct",
  "cardmarket",
  "pokeprice_graded",
] as const;

export type PriceSourceId = (typeof PRICE_SOURCE_IDS)[number];

export interface PriceSourceMeta {
  id: PriceSourceId;
  displayName: string;
  /**
   * Shown wherever this source's numbers appear.
   *
   * TODO(attribution): each provider's terms dictate exact wording, and the
   * mirror provider behind tcgplayer_market is not chosen yet. Verify these
   * strings against the live ToS before public launch — they are placeholders
   * with the right shape, not vetted legal text.
   */
  attribution: string;
}

export const PRICE_SOURCES: Record<PriceSourceId, PriceSourceMeta> = {
  tcgplayer_market: {
    id: "tcgplayer_market",
    displayName: "TCGplayer Market",
    attribution:
      "Market price data via a third-party TCGplayer mirror. Not endorsed by or affiliated with TCGplayer.",
  },
  pricecharting_ebay: {
    id: "pricecharting_ebay",
    displayName: "eBay (sold)",
    attribution:
      "Price data from PriceCharting, derived from eBay sold listings. This product uses PriceCharting data but is not endorsed by PriceCharting.",
  },
  ebay_direct: {
    id: "ebay_direct",
    displayName: "eBay (direct)",
    attribution: "Price data from the eBay APIs. Not endorsed by eBay.",
  },
  cardmarket: {
    id: "cardmarket",
    displayName: "Cardmarket (EU)",
    attribution: "Price data from Cardmarket. Not endorsed by Cardmarket.",
  },
  pokeprice_graded: {
    id: "pokeprice_graded",
    displayName: "PSA graded (eBay)",
    attribution:
      "Graded (PSA 10/9) sale prices from PokemonPriceTracker, derived from eBay sold listings. Not endorsed by PokemonPriceTracker, PSA, or eBay.",
  },
};

export const ALL_PRICE_SOURCES: PriceSourceMeta[] =
  PRICE_SOURCE_IDS.map((id) => PRICE_SOURCES[id]);
