import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import type { CatalogSet } from "@/lib/catalog/types";
import { getEnv } from "@/lib/env";

import {
  PriceSourceError,
  toCents,
  type PriceSnapshotInput,
  type PriceableCard,
} from "../types";

/**
 * TCG market prices via Scrydex (api.scrydex.com) — user-selected provider.
 *
 * Why it matters beyond being "another mirror": Scrydex is the commercial
 * successor of pokemontcg.io (their site now redirects "Now part of Scrydex"),
 * and it covers One Piece through a licensed API — which would give One Piece
 * raw prices a clean provenance for the first time (optcgapi's scraped prices
 * are barred by our no-scraping rule). It also advertises graded prices and
 * sealed products; those become their own follow-ups once the raw path is
 * verified.
 *
 * Auth: X-Api-Key (TCGPLAYER_MIRROR_API_KEY) + X-Team-ID (SCRYDEX_TEAM_ID).
 * Credits: 1 per request regardless of page size, so a full daily refresh is
 * ~tens of credits against a 5,000/month Starter plan.
 *
 * ── UNVERIFIED ─────────────────────────────────────────────────────────────
 * Written from Scrydex's public docs; no real response has been seen because
 * no key exists yet. Two things MUST be confirmed with scripts/probe-scrydex.ts
 * before this provider is trusted:
 *   1. The price-object shape (parsePrices below handles the two shapes the
 *      docs imply and THROWS on anything else — it never guess-parses).
 *   2. Card-id compatibility: we match our cards via externalIds.pokemontcg_io
 *      (e.g. "sv8-238"). Scrydex's heritage makes id parity likely, not certain.
 * ───────────────────────────────────────────────────────────────────────────
 */
const BASE = "https://api.scrydex.com";
const PAGE_SIZE = 100;

/** Deliberately tolerant per-field, strict in aggregate — see parsePrices. */
const priceEntry = z
  .object({
    type: z.string().nullish(), // "raw" | "graded" observed in docs prose
    market: z.number().nullish(),
    low: z.number().nullish(),
    mid: z.number().nullish(),
    condition: z.string().nullish(),
    company: z.string().nullish(), // grading company for graded entries
    grade: z.union([z.string(), z.number()]).nullish(),
  })
  .passthrough();

const variantSchema = z
  .object({
    name: z.string().nullish(),
    prices: z.array(priceEntry).nullish(),
  })
  .passthrough();

const cardSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    number: z.string().nullish(),
    prices: z.array(priceEntry).nullish(),
    variants: z.array(variantSchema).nullish(),
  })
  .passthrough();

const cardsResponse = z
  .object({
    data: z.array(cardSchema).nullish(),
    cards: z.array(cardSchema).nullish(), // alternate envelope, just in case
    page: z.number().nullish(),
    pageSize: z.number().nullish(),
    totalCount: z.number().nullish(),
    total: z.number().nullish(),
  })
  .passthrough();

function credentials(): { key: string; teamId: string } | null {
  const env = getEnv();
  const key = env.TCGPLAYER_MIRROR_API_KEY;
  const teamId = env.SCRYDEX_TEAM_ID;
  return key && teamId ? { key, teamId } : null;
}

/** Scrydex path segment per game. One Piece's slug needs live confirmation. */
const GAME_PATH: Record<string, string> = {
  pokemon: "pokemon",
  "one-piece": "onepiece",
};

/**
 * Extracts a single raw market price (dollars) from whichever documented
 * shape the card uses. Throws PriceSourceError on a shape it doesn't
 * recognise: an unverified provider must fail loudly, never guess-parse a
 * number into the money path.
 */
function extractRawMarket(card: z.infer<typeof cardSchema>): number | null {
  const pools: z.infer<typeof priceEntry>[][] = [];
  if (card.prices?.length) pools.push(card.prices);
  if (card.variants?.length) {
    for (const v of card.variants) if (v.prices?.length) pools.push(v.prices);
  }

  if (pools.length === 0) return null; // genuinely unpriced card

  for (const pool of pools) {
    const raws = pool.filter((p) => (p.type ?? "raw").toLowerCase() === "raw");
    for (const p of raws) {
      if (typeof p.market === "number") return p.market;
      if (typeof p.mid === "number") return p.mid;
      if (typeof p.low === "number") return p.low;
    }
  }

  // Price entries exist but none matched the shapes we understand: that is a
  // mapping bug to surface, not a card to skip.
  throw new PriceSourceError(
    `unrecognised price shape on card ${card.id} — run scripts/probe-scrydex.ts and fix extractRawMarket`,
    "tcgplayer_market",
  );
}

export const scrydexPriceProvider = {
  id: "scrydex",
  displayName: "Scrydex",
  supportsGame: (gameSlug: string) => gameSlug in GAME_PATH,

  enabled(): boolean {
    return credentials() !== null;
  },

  async fetchCardPrices(
    set: CatalogSet,
    cards: PriceableCard[],
  ): Promise<PriceSnapshotInput[]> {
    const creds = credentials();
    if (!creds) {
      throw new PriceSourceError(
        "scrydex selected but TCGPLAYER_MIRROR_API_KEY / SCRYDEX_TEAM_ID missing — callers must check enabled()",
        "tcgplayer_market",
      );
    }

    const game = gameOf(set);
    const path = GAME_PATH[game];
    if (!path) return [];

    // Match back via the pokemontcg_io external id (Scrydex heritage) with a
    // number-based fallback the probe script validates.
    const byExternalId = new Map<string, PriceableCard>();
    const byNumber = new Map<string, PriceableCard>();
    for (const c of cards) {
      const ext = c.externalIds["pokemontcg_io"] ?? c.externalIds["scrydex"];
      if (ext) byExternalId.set(ext, c);
      byNumber.set(c.number, c);
    }

    const headers = { "X-Api-Key": creds.key, "X-Team-ID": creds.teamId };
    const expansionId = set.externalIds["pokemontcg_io"] ?? set.externalIds["scrydex"] ?? set.code;

    const out: PriceSnapshotInput[] = [];
    for (let page = 1; ; page++) {
      const res = await fetchJson(
        `${BASE}/${path}/v1/expansions/${encodeURIComponent(expansionId)}/cards?include=prices&page=${page}&pageSize=${PAGE_SIZE}`,
        cardsResponse,
        { provider: "scrydex", headers },
      );

      const rows = res.data ?? res.cards ?? [];
      const capturedAt = new Date();

      for (const card of rows) {
        const match =
          byExternalId.get(card.id) ??
          (card.number ? byNumber.get(card.number) : undefined);
        if (!match) continue;

        const dollars = extractRawMarket(card);
        if (dollars === null) continue;

        out.push({
          externalCardId: match.externalIds["pokemontcg_io"] ?? match.externalIds["optcgapi"] ?? card.id,
          sourceId: "tcgplayer_market",
          priceCents: toCents(dollars),
          kind: "raw",
          capturedAt,
        });
      }

      const total = res.totalCount ?? res.total;
      const size = res.pageSize ?? PAGE_SIZE;
      if (rows.length === 0 || (total !== null && total !== undefined && page * size >= total)) {
        break;
      }
    }

    return out;
  },

  async fetchSealedPrices(): Promise<PriceSnapshotInput[]> {
    // Scrydex documents sealed-product endpoints for both games — a real
    // upgrade path (it would retire the hand-tracked market prices). Wire it
    // AFTER the raw path is verified live; a second unverified surface on an
    // unverified provider compounds guesswork.
    return [];
  },
};

function gameOf(set: CatalogSet): string {
  if (set.externalIds["pokemontcg_io"]) return "pokemon";
  if (set.externalIds["optcgapi"]) return "one-piece";
  return "unknown";
}
