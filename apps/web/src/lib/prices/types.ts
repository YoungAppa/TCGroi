import type { CatalogSet } from "@/lib/catalog/types";

/**
 * One interface, many implementations — the skinsearch-style source filter is
 * just the set of adapters whose enabled() is true.
 *
 * Adapters are called ONLY from cron jobs. They return plain data; persisting
 * it is the job's business. That split keeps them testable without a database
 * and keeps external I/O out of every request path.
 */

export type PriceKind = "raw" | "psa9" | "psa10" | "sealed";

/** A price for one entity from one source at one moment. Integer cents. */
export interface PriceSnapshotInput {
  /** Matches the card's externalIds entry for the relevant catalog provider. */
  externalCardId?: string;
  /** For sealed products. Exactly one of the two id fields is set. */
  externalProductId?: string;
  sourceId: string;
  priceCents: number;
  kind: PriceKind;
  capturedAt: Date;
}

/** Identifies a card to a price adapter without dragging in a DB row. */
export interface PriceableCard {
  /** Our card id, echoed back so the caller can match rows up. */
  cardId: string;
  name: string;
  number: string;
  rarity: string;
  /**
   * base / alt_art / manga / wanted_poster / sp / … — the printing variant.
   * A source like PriceCharting lists each treatment as its own row at wildly
   * different prices (a base One Piece card at $2, its Manga at $1,600), so a
   * matcher must key on treatment, not just the collector number.
   */
  treatment: string;
  externalIds: Record<string, string>;
  /**
   * Our current raw (ungraded) price in cents, when we have one.
   *
   * Used to disambiguate a source that lists several PRINTINGS of one card
   * under separate variants — Base Set Charizard is 1st-Edition Shadowless,
   * Shadowless, Unlimited, metal and jumbo, whose PSA 10 values span $584 to
   * $414,330 while our catalog has a single Charizard row. The raw price says
   * which printing that row actually represents, so graded value can be taken
   * from the same one instead of guessed.
   */
  rawCents?: number | null;
}

export interface PriceSourceAdapter {
  id: string;
  displayName: string;
  /** Reads env config. False => the UI hides this source entirely. */
  enabled(): boolean;
  supports: { cardsRaw: boolean; cardsGraded: boolean; sealed: boolean };

  fetchCardPrices(set: CatalogSet, cards: PriceableCard[]): Promise<PriceSnapshotInput[]>;
  fetchSealedPrices(set: CatalogSet): Promise<PriceSnapshotInput[]>;
  /**
   * psa9/psa10. Only implemented where the source has graded data. Receives
   * the set too: a per-expansion source (Scrydex) pages by set rather than
   * fetching card-by-card, which is the difference between a few credits and
   * one per card.
   */
  fetchGradedPrices?(
    cards: PriceableCard[],
    set: CatalogSet,
  ): Promise<PriceSnapshotInput[]>;
}

export class PriceSourceError extends Error {
  constructor(
    message: string,
    readonly sourceId: string,
    options?: { cause?: unknown },
  ) {
    super(`[${sourceId}] ${message}`, options);
    this.name = "PriceSourceError";
  }
}

/** Dollars (float, as most APIs return) -> integer cents. */
export function toCents(dollars: number): number {
  // Round rather than truncate: 38.61 * 100 is 3860.9999... in binary float,
  // and truncating would quietly lose a cent on a large fraction of prices.
  return Math.round(dollars * 100);
}
