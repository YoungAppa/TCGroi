/**
 * Catalog adapters supply facts about cards — names, numbers, rarities,
 * images. They never supply prices; that is the PriceSourceAdapter's job, and
 * keeping the two apart is what lets us take a provider's catalog while
 * declining its pricing (see the optcgapi note in providers/optcgapi.ts).
 */

export interface CatalogSet {
  /** Publisher set code, e.g. "sv8" or "OP-09". */
  code: string;
  name: string;
  /** ISO date, or null when the provider doesn't say. */
  releaseDate: string | null;
  language: "EN" | "JP";
  /** Cards the provider claims exist, for a post-ingest sanity check. */
  expectedCardCount: number | null;
  externalIds: Record<string, string>;
}

export interface CatalogCard {
  name: string;
  number: string;
  /** Already normalised to the game's vocabulary. */
  rarity: string;
  /** Printing treatment; part of card identity. See schema.cards.treatment. */
  treatment: string;
  imageUrl: string | null;
  externalIds: Record<string, string>;
}

export interface CatalogAdapter {
  /** Which game this adapter populates. */
  gameSlug: "pokemon" | "one-piece" | "mtg";
  /** Provider id, recorded in externalIds so we can trace a row's origin. */
  providerId: string;
  displayName: string;
  /** False when the provider needs config we don't have. */
  enabled(): boolean;
  fetchSets(): Promise<CatalogSet[]>;
  fetchCards(set: CatalogSet): Promise<CatalogCard[]>;
}

/** Raised when a provider's response doesn't match its documented shape. */
export class CatalogError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    options?: { cause?: unknown },
  ) {
    // Pass through to Error's own `cause` rather than shadowing it, so
    // standard error reporting picks the chain up.
    super(`[${provider}] ${message}`, options);
    this.name = "CatalogError";
  }
}
