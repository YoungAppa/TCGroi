import type { PriceSourceAdapter, PriceSnapshotInput } from "../types";

/**
 * Future sources. They exist as real adapters so the registry, the source
 * filter, and the DB's price_sources rows are complete from day one — adding
 * the implementation later changes no call sites.
 *
 * Both report enabled() === false, so the UI never shows them.
 *
 * "Collectr" was considered and dropped: no public API, and its data is
 * eBay-derived, which PriceCharting already covers. It is deliberately not
 * stubbed here.
 */

export class EbayDirectAdapter implements PriceSourceAdapter {
  readonly id = "ebay_direct";
  readonly displayName = "eBay (direct)";
  readonly supports = { cardsRaw: true, cardsGraded: false, sealed: true };

  /**
   * Future: eBay Browse / Marketplace Insights APIs. Insights (sold data) is
   * gated behind an application process, so this stays a stub until that
   * access exists. PriceCharting already gives us eBay-derived sold prices.
   */
  enabled(): boolean {
    return false;
  }

  async fetchCardPrices(): Promise<PriceSnapshotInput[]> {
    return [];
  }

  async fetchSealedPrices(): Promise<PriceSnapshotInput[]> {
    return [];
  }
}

export class CardmarketAdapter implements PriceSourceAdapter {
  readonly id = "cardmarket";
  readonly displayName = "Cardmarket (EU)";
  readonly supports = { cardsRaw: true, cardsGraded: false, sealed: true };

  /**
   * Future: EU prices. Note pokemontcg.io already embeds a `cardmarket` block,
   * but its data was observed ~8 months stale (updatedAt 2025-11 when checked
   * in 2026-07), so it is NOT a usable live source and is deliberately not
   * wired up. A real implementation needs Cardmarket's own API.
   */
  enabled(): boolean {
    return false;
  }

  async fetchCardPrices(): Promise<PriceSnapshotInput[]> {
    return [];
  }

  async fetchSealedPrices(): Promise<PriceSnapshotInput[]> {
    return [];
  }
}
