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
  externalIds: Record<string, string>;
}

export interface PriceSourceAdapter {
  id: string;
  displayName: string;
  /** Reads env config. False => the UI hides this source entirely. */
  enabled(): boolean;
  supports: { cardsRaw: boolean; cardsGraded: boolean; sealed: boolean };

  fetchCardPrices(set: CatalogSet, cards: PriceableCard[]): Promise<PriceSnapshotInput[]>;
  fetchSealedPrices(set: CatalogSet): Promise<PriceSnapshotInput[]>;
  /** psa9/psa10. Only implemented where the source has graded data. */
  fetchGradedPrices?(cards: PriceableCard[]): Promise<PriceSnapshotInput[]>;
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
