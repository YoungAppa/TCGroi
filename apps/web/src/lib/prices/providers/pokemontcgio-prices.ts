import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import type { CatalogSet } from "@/lib/catalog/types";

import { toCents, type PriceSnapshotInput, type PriceableCard } from "../types";

/**
 * TCGplayer market prices via pokemontcg.io.
 *
 * One of several possible providers behind the single `tcgplayer_market`
 * adapter (see mirror.ts). We never touch TCGplayer directly: their API is
 * closed to new developers and their ToS forbids scraping.
 *
 * Verified live: sv8 returns `tcgplayer.prices` with a same-day `updatedAt`.
 * Free, no key. Limitation: Pokémon only.
 */
const BASE = "https://api.pokemontcg.io/v2";
const PAGE_SIZE = 250;

const priceBlock = z
  .object({
    low: z.number().nullish(),
    mid: z.number().nullish(),
    high: z.number().nullish(),
    market: z.number().nullish(),
    directLow: z.number().nullish(),
  })
  .nullish();

const cardSchema = z.object({
  id: z.string(),
  tcgplayer: z
    .object({
      url: z.string().nullish(),
      updatedAt: z.string().nullish(),
      prices: z.record(z.string(), priceBlock).nullish(),
    })
    .nullish(),
});

const cardsResponse = z.object({
  data: z.array(cardSchema),
  page: z.number(),
  pageSize: z.number(),
  totalCount: z.number(),
});

/**
 * Which printing's price represents "the card".
 *
 * pokemontcg.io models printings as price variants on one card rather than as
 * separate cards, so we pick one. Order matters:
 *  - `holofoil` first: for an SIR/UR/hyper it is the only variant, and for a
 *    rare holo it is the actual card (its reverse is a different printing).
 *  - `normal` next: the base printing of commons/uncommons/rares.
 *  - reverse/1st-edition variants last, as a fallback for cards that have
 *    nothing else.
 *
 * NOTE: this means the reverse-holo price is not currently captured as its own
 * value. No pull-rate file we ship declares a reverse-holo guaranteedSlot yet,
 * so nothing depends on it; valuing that slot properly needs reverse holos
 * ingested as their own `treatment` rows, the way One Piece parallels are.
 */
const VARIANT_PRIORITY = [
  "holofoil",
  "normal",
  "reverseHolofoil",
  "unlimitedHolofoil",
  "1stEditionHolofoil",
  "1stEditionNormal",
] as const;

function pickMarketPrice(
  prices: Record<string, { market?: number | null; mid?: number | null } | null | undefined>,
): number | null {
  for (const variant of VARIANT_PRIORITY) {
    const block = prices[variant];
    if (!block) continue;
    // `market` is the actual sold-price signal. `mid` is a listing midpoint —
    // a weaker fallback, used only when market is absent (thin trading).
    if (typeof block.market === "number") return block.market;
    if (typeof block.mid === "number") return block.mid;
  }
  // Some cards carry a variant key we don't know; take any market price rather
  // than reporting the card unpriced.
  for (const block of Object.values(prices)) {
    if (block && typeof block.market === "number") return block.market;
  }
  return null;
}

export const pokemonTcgIoPriceProvider = {
  id: "pokemontcg_io",
  displayName: "pokemontcg.io (TCGplayer mirror)",
  supportsGame: (gameSlug: string) => gameSlug === "pokemon",

  enabled(): boolean {
    return true; // No key required.
  },

  async fetchCardPrices(
    set: CatalogSet,
    cards: PriceableCard[],
  ): Promise<PriceSnapshotInput[]> {
    // Map external id -> our card id so results can be matched back without
    // relying on name or number, which are not stable join keys.
    const byExternalId = new Map<string, PriceableCard>();
    for (const c of cards) {
      const ext = c.externalIds["pokemontcg_io"];
      if (ext) byExternalId.set(ext, c);
    }
    if (byExternalId.size === 0) return [];

    const out: PriceSnapshotInput[] = [];
    // One page fetches prices for 250 cards, so a full set costs 2 requests
    // rather than one per card. That is what keeps us inside a free tier.
    for (let page = 1; ; page++) {
      const headers: Record<string, string> = {};
      const key = process.env.POKEMONTCG_IO_KEY;
      if (key) headers["X-Api-Key"] = key;
      const q = encodeURIComponent(`set.id:${set.code}`);
      const res = await fetchJson(
        `${BASE}/cards?q=${q}&page=${page}&pageSize=${PAGE_SIZE}&select=id,tcgplayer`,
        cardsResponse,
        { provider: "pokemontcg_io", headers, treat404AsTransient: true, retries: 4 },
      );

      const capturedAt = new Date();
      for (const c of res.data) {
        if (!byExternalId.has(c.id)) continue;
        const prices = c.tcgplayer?.prices;
        if (!prices) continue;

        const dollars = pickMarketPrice(prices);
        // A card with no market price is genuinely unpriced. Emitting 0 here
        // would land in a tier average as a real zero and deflate EV.
        if (dollars === null) continue;

        out.push({
          externalCardId: c.id,
          sourceId: "tcgplayer_market",
          priceCents: toCents(dollars),
          kind: "raw",
          capturedAt,
        });
      }

      if (res.page * res.pageSize >= res.totalCount || res.data.length === 0) break;
    }

    return out;
  },

  async fetchSealedPrices(): Promise<PriceSnapshotInput[]> {
    // pokemontcg.io indexes singles only — it has no sealed products. Sealed
    // prices come from PriceCharting, and the EV engine's fallback chain
    // already handles this source having nothing.
    return [];
  },
};
