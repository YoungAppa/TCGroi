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
   * Provider terms, checked 2026-07-21 (NOT legal advice — confirm before a
   * public, monetised launch):
   *   - pokemontcg.io (behind tcgplayer_market): attribution REQUIRED, and it
   *     must include a credit + link back to the API. The link is rendered in
   *     the footer/methodology, not in this bare string.
   *   - PriceCharting: their ToS restricts redistributing pricing data to third
   *     parties without express written consent — displaying it on a public
   *     site likely needs their sign-off or a redistribution licence. THIS IS A
   *     LAUNCH BLOCKER to resolve with PriceCharting directly.
   *   - PokemonPriceTracker: commercial use needs the Business tier (the $9.99
   *     tier is dev-only).
   * See the launch note surfaced to the user for the open items.
   */
  attribution: string;
}

export const PRICE_SOURCES: Record<PriceSourceId, PriceSourceMeta> = {
  tcgplayer_market: {
    id: "tcgplayer_market",
    displayName: "TCGplayer Market",
    attribution:
      "Market prices from TCGplayer, via the pokemontcg.io API (Pokémon) and the Scrydex API (One Piece). Not endorsed by or affiliated with TCGplayer, pokemontcg.io, or Scrydex.",
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
