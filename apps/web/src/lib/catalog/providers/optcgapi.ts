import { z } from "zod";

import { fetchJson } from "../http";
import { normalizeOnePieceCard } from "../normalize";
import { CatalogError, type CatalogAdapter, type CatalogCard, type CatalogSet } from "../types";

/**
 * One Piece catalog via optcgapi.com.
 *
 * CATALOG ONLY — we deliberately ignore this provider's `market_price` and
 * `inventory_price` fields.
 *
 * Every record carries a `date_scraped` field, i.e. the pricing is scraped
 * rather than licensed, almost certainly from TCGplayer. Our non-negotiable is
 * "never scrape TCGplayer or any site whose ToS forbids it; API access only",
 * and consuming those prices would launder that violation through a third
 * party. Card names, numbers, rarities, and images are catalogue facts and are
 * a different matter, so we take those and leave the prices.
 *
 * One Piece prices therefore come from PriceCharting once PRICECHARTING_TOKEN
 * is configured; until then One Piece products show no EV, by design.
 *
 * "Collectr" was considered and dropped: no public API, and its data is
 * eBay-derived, which PriceCharting already covers.
 */
const BASE = "https://optcgapi.com/api";

const cardSchema = z.object({
  card_name: z.string(),
  card_set_id: z.string(),
  set_id: z.string(),
  rarity: z.string().nullish(),
  card_image: z.string().nullish(),
  // NOTE: market_price / inventory_price / date_scraped exist here and are
  // intentionally not read. See the note above.
});

const setCardsResponse = z.array(cardSchema);

/**
 * Sets known to exist. optcgapi has no working set-index endpoint
 * (/api/sets/ returns 404; only /api/sets/{code}/ works), so the list is
 * enumerated here and extended as sets release. refresh-catalog flags any
 * code that 404s.
 */
const ONE_PIECE_SET_CODES = [
  "OP-01",
  "OP-02",
  "OP-03",
  "OP-04",
  "OP-05",
  "OP-06",
  "OP-07",
  "OP-08",
  "OP-09",
] as const;

const SET_NAMES: Record<string, string> = {
  "OP-01": "Romance Dawn",
  "OP-02": "Paramount War",
  "OP-03": "Pillars of Strength",
  "OP-04": "Kingdoms of Intrigue",
  "OP-05": "Awakening of the New Era",
  "OP-06": "Wings of the Captain",
  "OP-07": "500 Years in the Future",
  "OP-08": "Two Legends",
  "OP-09": "Emperors in the New World",
};

export class OptcgApiAdapter implements CatalogAdapter {
  readonly gameSlug = "one-piece" as const;
  readonly providerId = "optcgapi";
  readonly displayName = "optcgapi.com";

  enabled(): boolean {
    return true;
  }

  async fetchSets(): Promise<CatalogSet[]> {
    return ONE_PIECE_SET_CODES.map((code) => ({
      code,
      name: SET_NAMES[code] ?? code,
      releaseDate: null,
      language: "EN" as const,
      expectedCardCount: null,
      externalIds: { optcgapi: code },
    }));
  }

  async fetchCards(set: CatalogSet): Promise<CatalogCard[]> {
    const rows = await fetchJson(`${BASE}/sets/${set.code}/`, setCardsResponse, {
      provider: this.providerId,
    });

    const out: CatalogCard[] = [];
    const seen = new Map<string, string>();
    const unmapped = new Set<string>();
    const collisions: string[] = [];

    for (const r of rows) {
      const n = normalizeOnePieceCard(r.card_name, r.rarity);
      if (!n) {
        unmapped.add(`${r.card_name} [${r.rarity ?? "null"}]`);
        continue;
      }

      // A set response can legitimately include cards printed in an earlier
      // set (One Piece inserts SP/promo cards from prior sets into later
      // packs) — e.g. OP-09's response contains OP05-119 and OP04-119. Those
      // belong in this set's EV because they come out of these packs, so they
      // are kept, keyed by their own printed number.
      const key = `${r.card_set_id}::${n.treatment}`;
      const previous = seen.get(key);
      if (previous !== undefined) {
        // Two physically distinct cards mapped to one identity, which means a
        // treatment suffix is missing from ONE_PIECE_TREATMENTS. Dropping the
        // loser silently is how "Wanted Poster" once ate three of OP-09's
        // most valuable cards. Fail instead.
        collisions.push(`${key}: "${previous}" vs "${r.card_name}"`);
        continue;
      }
      seen.set(key, r.card_name);

      out.push({
        name: n.name,
        number: r.card_set_id,
        rarity: n.rarity,
        treatment: n.treatment,
        imageUrl: r.card_image ?? null,
        externalIds: { optcgapi: `${r.card_set_id}:${n.treatment}` },
      });
    }

    if (collisions.length > 0) {
      throw new CatalogError(
        `identity collisions in ${set.code} — two distinct printings share (number, treatment), so a treatment suffix is unmapped: ${collisions.join("; ")}`,
        this.providerId,
      );
    }

    if (unmapped.size > 0) {
      throw new CatalogError(
        `unmapped rarities in ${set.code}: ${[...unmapped].join(", ")}. Extend ONE_PIECE_BASE_RARITY_MAP — unmapped cards drop out of EV.`,
        this.providerId,
      );
    }

    return out;
  }
}
