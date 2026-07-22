import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import type { CatalogSet } from "@/lib/catalog/types";
import { getEnv } from "@/lib/env";

import {
  toCents,
  type PriceSnapshotInput,
  type PriceableCard,
} from "../types";

/**
 * TCG market prices via Scrydex (api.scrydex.com).
 *
 * Why it matters beyond being "another mirror": Scrydex is the commercial
 * successor of pokemontcg.io, and it covers One Piece through a licensed API —
 * which gives One Piece raw prices a clean provenance for the first time
 * (optcgapi's scraped prices are barred by our no-scraping rule).
 *
 * Auth: X-Api-Key (TCGPLAYER_MIRROR_API_KEY) + X-Team-ID (SCRYDEX_TEAM_ID).
 * Credits: 1 per request; a full One Piece refresh is ~2 pages x 9 sets, so
 * ~20 credits/day against the 5,000/month Starter plan.
 *
 * ── VERIFIED LIVE 2026-07-22 (probe-scrydex + follow-ups) ──────────────────
 *   - Envelope: { data: [...], page, page_size, count, total_count } (snake).
 *   - Pokémon card ids match pokemontcg_io ids exactly ("sv8-238" is a hit).
 *   - One Piece card ids ARE collector numbers ("OP04-001"); expansion ids are
 *     our set codes without the hyphen ("OP04").
 *   - Prices hang off data[].variants[].prices[]: entries carry
 *     { type: "raw", condition: "NM"|"LP"|"MP"|"HP"|"DM"|"U", market, low, .. }.
 *   - One Piece treatments are VARIANTS of one card (normal / altArt /
 *     mangaAltArt / wantedPoster / treasureRare / specialAltArt / ...), while
 *     our catalog stores each treatment as its own card row keyed
 *     (number, treatment) with external id "OP04-083:manga". The variant map
 *     below bridges the two; unmapped variants (championship stamps, best-of
 *     reprints, ...) are deliberately skipped, never guessed.
 *   - Graded prices + pop_reports exist in the API but are Growth-plan-gated
 *     ($99) — on Starter every price entry is type "raw". Wire graded/pop when
 *     the plan supports it.
 * ───────────────────────────────────────────────────────────────────────────
 */
const BASE = "https://api.scrydex.com";
const PAGE_SIZE = 100;

const priceEntry = z
  .object({
    type: z.string().nullish(), // "raw" | "graded"
    market: z.number().nullish(),
    low: z.number().nullish(),
    mid: z.number().nullish(),
    condition: z.string().nullish(), // NM / LP / MP / HP / DM / U (sealed)
    company: z.string().nullish(),
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
    variants: z.array(variantSchema).nullish(),
  })
  .passthrough();

const cardsResponse = z
  .object({
    data: z.array(cardSchema).nullish(),
    page: z.number().nullish(),
    page_size: z.number().nullish(),
    count: z.number().nullish(),
    total_count: z.number().nullish(),
  })
  .passthrough();

const sealedItemSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    type: z.string().nullish(), // "Booster Box" | "Booster Pack" | "Other" | null
    prices: z.array(priceEntry).nullish(),
    variants: z.array(variantSchema).nullish(),
  })
  .passthrough();

const sealedResponse = z
  .object({
    data: z.array(sealedItemSchema).nullish(),
    page: z.number().nullish(),
    page_size: z.number().nullish(),
    total_count: z.number().nullish(),
  })
  .passthrough();

function credentials(): { key: string; teamId: string } | null {
  const env = getEnv();
  const key = env.TCGPLAYER_MIRROR_API_KEY;
  const teamId = env.SCRYDEX_TEAM_ID;
  return key && teamId ? { key, teamId } : null;
}

/** Scrydex path segment per game. Both confirmed live. */
const GAME_PATH: Record<string, string> = {
  pokemon: "pokemon",
  "one-piece": "onepiece",
};

/**
 * Scrydex variant name -> our treatment vocabulary, in PRIORITY order: when
 * two variants map to the same treatment (textured vs non-textured manga), the
 * earlier entry wins. Names observed live across OP04/OP09. Anything absent
 * here (winnerStamp, bestSelectionVol3AltArt, ...) is a printing our catalog
 * does not model — skipped, because guessing a variant onto the wrong row is
 * how a $2 base card gets a $1,600 manga price.
 */
const VARIANT_TREATMENTS: readonly { variant: string; treatment: string }[] = [
  { variant: "normal", treatment: "base" },
  { variant: "altArt", treatment: "alt_art" },
  { variant: "mangaAltArt", treatment: "manga" },
  { variant: "nonTexturedMangaAltArt", treatment: "manga" },
  { variant: "wantedPoster", treatment: "wanted_poster" },
  { variant: "treasureRare", treatment: "treasure" },
  { variant: "specialAltArt", treatment: "sp" },
  { variant: "parallel", treatment: "parallel" },
  { variant: "boxTopper", treatment: "box_topper" },
];

/**
 * Foil-native tiers: SR/SEC cards ARE foils, so Scrydex gives them no
 * "normal" variant — their base printing lives under "foil" (verified live:
 * OP04-083 SR has foil/altArt/manga...; OP04-118 SEC has foil/altArt).
 * Leaders and below DO get a "normal" variant, and for those "foil" is a
 * separate, pricier printing that must never stand in for the base row.
 */
const FOIL_NATIVE_RARITIES = new Set(["super_rare", "secret_rare"]);

/** NM first — our "raw card" price means near-mint, like every other source. */
const CONDITION_ORDER = ["NM", "LP", "MP", "HP", "DM", "U"] as const;

/** Scrydex sealed `type` -> our sealed_products.type. Only the two OP products
 *  we model; other Scrydex sealed types (starter decks, cases) are ignored. */
const SEALED_TYPE_MAP: Record<string, string> = {
  "booster box": "booster_box",
  "booster pack": "booster_pack",
};

/**
 * A Scrydex expansion lists many sealed SKUs per type — the plain box plus a
 * Case, a Sleeved pack, a Dash Pack, wave/edition variants. Our catalog has one
 * "booster_box" and one "booster_pack" per set, so any name carrying an extra
 * qualifier is a different product and must not price our row. Rejecting is the
 * safe error: a missing sealed price falls back to PriceCharting, a wrong one
 * (a $48 sleeved pack as the $13 pack) corrupts market ROI.
 */
const SEALED_DECOY =
  /sleeved|\bcase\b|display|double|dash|gift|starter|half|premium|volume|collection|anniversary|memorial|wave|edition|bundle|tin/i;

/** One sealed (unopened) price in dollars from an item's price entries. */
function sealedRawDollars(item: z.infer<typeof sealedItemSchema>): number | null {
  const pools: z.infer<typeof priceEntry>[][] = [];
  if (item.prices?.length) pools.push(item.prices);
  for (const v of item.variants ?? []) if (v.prices?.length) pools.push(v.prices);
  for (const pool of pools) {
    for (const p of pool) {
      if ((p.type ?? "raw").toLowerCase() !== "raw") continue;
      const val = p.market ?? p.low ?? p.mid;
      if (typeof val === "number" && val > 0) return val;
    }
  }
  return null;
}

/**
 * One raw price (dollars) from a variant's price list: best available
 * condition, market value preferred over the low ask. Null when the variant
 * carries no usable raw entry — an unpriced printing, not an error.
 */
function rawDollars(prices: z.infer<typeof priceEntry>[] | null | undefined): number | null {
  if (!prices?.length) return null;
  const raws = prices.filter((p) => (p.type ?? "raw").toLowerCase() === "raw");
  for (const cond of CONDITION_ORDER) {
    const entry = raws.find((p) => p.condition === cond);
    if (!entry) continue;
    const v = entry.market ?? entry.low ?? entry.mid;
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
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
    if (!creds) return []; // adapter checks enabled(); belt and braces here

    const game = gameOf(set);
    const path = GAME_PATH[game];
    if (!path) return [];

    // Pokémon: our ids ARE Scrydex ids (verified). One Piece: Scrydex card id
    // is the collector number and each treatment is a variant, so the match
    // key is number + treatment — exactly our card identity.
    const pokemonByExternalId = new Map<string, PriceableCard>();
    const opByNumberTreatment = new Map<string, PriceableCard>();
    for (const c of cards) {
      const ext = c.externalIds["pokemontcg_io"];
      if (ext) pokemonByExternalId.set(ext, c);
      opByNumberTreatment.set(`${c.number}|${c.treatment}`, c);
    }

    const headers = { "X-Api-Key": creds.key, "X-Team-ID": creds.teamId };
    const expansionId =
      game === "pokemon"
        ? (set.externalIds["pokemontcg_io"] ?? set.code)
        : set.code.replace(/-/g, ""); // "OP-04" -> "OP04", verified live

    const out: PriceSnapshotInput[] = [];
    for (let page = 1; ; page++) {
      const res = await fetchJson(
        `${BASE}/${path}/v1/expansions/${encodeURIComponent(expansionId)}/cards?include=prices&page=${page}&page_size=${PAGE_SIZE}`,
        cardsResponse,
        { provider: "scrydex", headers },
      );

      const rows = res.data ?? [];
      const capturedAt = new Date();

      for (const card of rows) {
        if (game === "pokemon") {
          const match = pokemonByExternalId.get(card.id);
          if (!match) continue;
          // Any variant with a usable raw price — Pokémon rows are one row per
          // printing already, first hit in variant order is the card itself.
          for (const v of card.variants ?? []) {
            const dollars = rawDollars(v.prices);
            if (dollars !== null) {
              out.push({
                externalCardId: match.externalIds["pokemontcg_io"] ?? card.id,
                sourceId: "tcgplayer_market",
                priceCents: toCents(dollars),
                kind: "raw",
                capturedAt,
              });
              break;
            }
          }
          continue;
        }

        // One Piece: walk the treatment map in priority order so e.g. textured
        // manga beats non-textured for the single "manga" row.
        const variantsByName = new Map<string, z.infer<typeof variantSchema>>();
        for (const v of card.variants ?? []) if (v.name) variantsByName.set(v.name, v);

        const priced = new Set<string>();
        for (const { variant, treatment } of VARIANT_TREATMENTS) {
          if (priced.has(treatment)) continue;
          const v = variantsByName.get(variant);
          if (!v) continue;
          const match = opByNumberTreatment.get(`${card.id}|${treatment}`);
          if (!match) continue;
          const dollars = rawDollars(v.prices);
          if (dollars === null) continue;
          priced.add(treatment);
          out.push({
            externalCardId: match.externalIds["optcgapi"] ?? `${card.id}:${treatment}`,
            sourceId: "tcgplayer_market",
            priceCents: toCents(dollars),
            kind: "raw",
            capturedAt,
          });
        }

        // Foil-native fallback: an SR/SEC base row prices from "foil" when no
        // "normal" variant exists — that IS its base printing. Gated on the
        // row's rarity so a common's separate (pricier) foil printing can
        // never stand in for its base row.
        if (!priced.has("base") && !variantsByName.has("normal")) {
          const match = opByNumberTreatment.get(`${card.id}|base`);
          const foil = variantsByName.get("foil");
          if (match && foil && FOIL_NATIVE_RARITIES.has(match.rarity)) {
            const dollars = rawDollars(foil.prices);
            if (dollars !== null) {
              out.push({
                externalCardId: match.externalIds["optcgapi"] ?? `${card.id}:base`,
                sourceId: "tcgplayer_market",
                priceCents: toCents(dollars),
                kind: "raw",
                capturedAt,
              });
            }
          }
        }
      }

      const total = res.total_count;
      const size = res.page_size ?? PAGE_SIZE;
      if (rows.length === 0 || total == null || page * size >= total) break;
    }

    return out;
  },

  async fetchSealedPrices(set: CatalogSet): Promise<PriceSnapshotInput[]> {
    const creds = credentials();
    if (!creds) return [];

    const game = gameOf(set);
    const path = GAME_PATH[game];
    if (!path) return [];

    const expansionId =
      game === "pokemon"
        ? (set.externalIds["pokemontcg_io"] ?? set.code)
        : set.code.replace(/-/g, "");
    const headers = { "X-Api-Key": creds.key, "X-Team-ID": creds.teamId };

    // Best (plainest-named) qualifying SKU per our product type. Shortest name
    // wins: "Kingdoms of Intrigue Booster Box" beats any longer edition string.
    const best = new Map<string, { name: string; cents: number }>();
    for (let page = 1; ; page++) {
      const res = await fetchJson(
        `${BASE}/${path}/v1/expansions/${encodeURIComponent(expansionId)}/sealed?include=prices&page=${page}&page_size=${PAGE_SIZE}`,
        sealedResponse,
        { provider: "scrydex", headers },
      );

      const rows = res.data ?? [];
      for (const item of rows) {
        const ourType = item.type ? SEALED_TYPE_MAP[item.type.toLowerCase()] : undefined;
        if (!ourType) continue;
        if (item.name && SEALED_DECOY.test(item.name)) continue;
        const dollars = sealedRawDollars(item);
        if (dollars === null) continue;

        const prev = best.get(ourType);
        const name = item.name ?? "";
        if (!prev || name.length < prev.name.length) {
          best.set(ourType, { name, cents: toCents(dollars) });
        }
      }

      const total = res.total_count;
      const size = res.page_size ?? PAGE_SIZE;
      if (rows.length === 0 || total == null || page * size >= total) break;
    }

    const capturedAt = new Date();
    return [...best].map(([ourType, v]) => ({
      externalProductId: ourType,
      sourceId: "tcgplayer_market",
      priceCents: v.cents,
      kind: "sealed" as const,
      capturedAt,
    }));
  },
};

function gameOf(set: CatalogSet): string {
  if (set.externalIds["pokemontcg_io"]) return "pokemon";
  if (set.externalIds["optcgapi"]) return "one-piece";
  return "unknown";
}
