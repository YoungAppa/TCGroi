import type { CatalogSet } from "@/lib/catalog/types";

import { GRADED_SOURCE_ID, scrydexPriceProvider } from "../providers/scrydex-prices";
import type {
  PriceableCard,
  PriceSnapshotInput,
  PriceSourceAdapter,
} from "../types";

/**
 * PSA 10 / PSA 9 prices from Scrydex — a graded-only source.
 *
 * Why it is its own adapter rather than a flag on TcgplayerMarketAdapter: that
 * adapter routes raw prices per game through a *swappable* mirror (Pokémon
 * defaults to the free pokemontcg.io, which has no graded data at all), so
 * graded availability must not depend on which raw mirror happens to be
 * selected. Splitting it also keeps provenance honest — graded rows land under
 * `scrydex_graded`, next to `pokeprice_graded`, instead of being folded into
 * the raw "TCGplayer Market" pill.
 *
 * Cost: graded rides the same per-expansion paged request as raw
 * (`include=prices` returns both), so a set costs a handful of credits no
 * matter how many cards it has. Requires the Growth plan — on Starter every
 * entry comes back type "raw" and this adapter simply yields nothing.
 *
 * Coverage (verified 2026-08-23): Pokémon is deep, including vintage. One Piece
 * returns no graded entries yet; the extractor yields nothing for it and will
 * light up on its own if/when Scrydex populates it.
 */
export class ScrydexGradedAdapter implements PriceSourceAdapter {
  readonly id = GRADED_SOURCE_ID;
  readonly displayName = "PSA graded (Scrydex)";
  readonly supports = { cardsRaw: false, cardsGraded: true, sealed: false };

  enabled(): boolean {
    return scrydexPriceProvider.enabled();
  }

  /** Raw/sealed are not this source's job — the raw mirror owns those. */
  async fetchCardPrices(): Promise<PriceSnapshotInput[]> {
    return [];
  }

  async fetchSealedPrices(): Promise<PriceSnapshotInput[]> {
    return [];
  }

  async fetchGradedPrices(
    cards: PriceableCard[],
    set: CatalogSet,
  ): Promise<PriceSnapshotInput[]> {
    if (!scrydexPriceProvider.enabled()) return [];
    return scrydexPriceProvider.fetchGradedPrices(set, cards);
  }
}
