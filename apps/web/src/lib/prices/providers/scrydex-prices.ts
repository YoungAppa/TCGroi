import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import { SCRYDEX_DISPLAY_VARIANTS, SCRYDEX_TREATMENT_VARIANTS } from "@/lib/catalog/scrydex-variants";
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
 *     mangaAltArt / wantedPoster / treasureRare / specialAltArt / ...). Scrydex
 *     is ALSO the One Piece catalog source (providers/scrydex.ts), so each of
 *     our card rows was created from one of these variants via the SAME shared
 *     map (scrydex-variants.ts). Matching is therefore self-consistent: a row
 *     labelled "manga" always reads the mangaAltArt price — no name-guessing,
 *     which is what once let a $4,000 Shanks manga read as $96.
 *   - Graded prices are Growth-plan-gated ($99). VERIFIED LIVE ON GROWTH
 *     2026-08-23: Pokémon carries deep graded coverage (swsh7-215 returns 45
 *     graded entries, base1-4 returns 314) as entries of type "graded" with
 *     { company, grade, is_perfect, is_signed, is_error, market, currency }.
 *     One Piece graded is NOT populated yet (0 entries on every probe) — the
 *     extractor below simply yields nothing for OP until Scrydex fills it in.
 * ───────────────────────────────────────────────────────────────────────────
 */
const BASE = "https://api.scrydex.com";
const PAGE_SIZE = 100;

/**
 * Graded rows carry their own source id, separate from the raw mirror's
 * "tcgplayer_market": PSA sale prices are a different market from raw NM asks,
 * and the UI/attribution treats graded sources as their own pill.
 */
export const GRADED_SOURCE_ID = "scrydex_graded";

const priceEntry = z
  .object({
    type: z.string().nullish(), // "raw" | "graded"
    market: z.number().nullish(),
    low: z.number().nullish(),
    mid: z.number().nullish(),
    high: z.number().nullish(),
    condition: z.string().nullish(), // NM / LP / MP / HP / DM / U (sealed)
    currency: z.string().nullish(), // USD / JPY — never mix them
    company: z.string().nullish(), // PSA / BGS / CGC / TAG / ACE / ...
    grade: z.union([z.string(), z.number()]).nullish(),
    is_perfect: z.boolean().nullish(), // black-label / perfect 10
    is_signed: z.boolean().nullish(),
    is_error: z.boolean().nullish(),
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

const sealedImageSchema = z
  .object({ large: z.string().nullish(), medium: z.string().nullish(), small: z.string().nullish() })
  .passthrough();

const sealedItemSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    type: z.string().nullish(), // "Booster Box" | "Booster Pack" | "Other" | null
    images: z.array(sealedImageSchema).nullish(),
    prices: z.array(priceEntry).nullish(),
    variants: z.array(variantSchema).nullish(),
  })
  .passthrough();

/** Best available product photo for a sealed item, or null. */
function sealedImageUrl(item: z.infer<typeof sealedItemSchema>): string | null {
  const img = item.images?.[0];
  return img?.large ?? img?.medium ?? img?.small ?? null;
}

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
 * Scrydex prices only the BASE One Piece card, deliberately.
 *
 * Both optcgapi (our catalog) and Scrydex enumerate a card's special printings,
 * but with inconsistent names: Scrydex's "altArt" is the $18 regular alt on
 * OP04-083 Sabo yet the $936 premium on OP05-074 Kid, and "mangaAltArt" inverts
 * with it. The cross-source divergence audit caught alt/manga prices landing on
 * the wrong treatment for the highest-value chase cards — a $936 price on a $7
 * row is exactly the error that would corrupt the chase table and EV. Since we
 * cannot tell a good name-match from a bad one for those printings, we don't
 * ship them: PriceCharting prices the alt/manga/wanted/treasure/sp treatments
 * via explicitly-labelled consoles with a validated matcher, so those rows keep
 * a correct source. Only "base" — the plain card — has an unambiguous Scrydex
 * variant ("normal", or "foil" for foil-native rarities), so only "base" is
 * priced here.
 */

/** NM first — our "raw card" price means near-mint, like every other source. */
const CONDITION_ORDER = ["NM", "LP", "MP", "HP", "DM", "U"] as const;

/**
 * Scrydex sealed `type` -> our sealed_products.type, with per-type name rules.
 *
 * A Scrydex expansion lists many SKUs per type — the plain box plus a Case, a
 * Sleeved pack, wave/edition variants, Pokémon Center exclusives. Our catalog
 * has ONE product per (set, type), so a name carrying an extra qualifier is a
 * different product and must not match. Rejecting is the safe error: a missing
 * sealed price/image falls back (PriceCharting / set logo), a wrong one (a $48
 * sleeved pack as the $13 pack) corrupts market ROI. Rules are per-type because
 * one global decoy list can't work — "Bundle" is a decoy on a Booster Pack but
 * IS the Booster Bundle product; "Ultra-Premium" is a decoy nowhere but on the
 * Collection type it's the one name we want.
 */
const SEALED_TYPES: Record<
  string,
  { our: string; nameMust?: RegExp; nameMustNot: RegExp }
> = {
  "booster box": { our: "booster_box", nameMustNot: /\bcase\b|sleeved|wave|edition/i },
  "booster pack": {
    our: "booster_pack",
    nameMustNot: /sleeved|\bcase\b|bundle|set of|blister|art|dash|double/i,
  },
  "elite trainer box": { our: "etb", nameMustNot: /\bcase\b|exclusive/i },
  "booster bundle": { our: "bundle", nameMustNot: /\bcase\b|display/i },
  // Our "case" product type is the Ultra-Premium Collection; the Collection
  // type also carries poster/ex/binder collections, which must not match.
  collection: { our: "case", nameMust: /ultra.?premium/i, nameMustNot: /\bcase\b/i },
};

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

/**
 * One graded price (dollars) for an exact (company, grade) from a variant's
 * price list, or null.
 *
 * Deliberately strict about WHICH slab counts, because these feed the graded-EV
 * mode where an over-read directly inflates "worth grading":
 *   - currency must be USD. Scrydex also returns JPY entries; treating one as
 *     dollars would be a ~150x error, so a non-USD entry is skipped, never
 *     converted.
 *   - signed / error slabs are excluded — a signed PSA 10 trades in a different
 *     market than the vanilla card, in either direction.
 *   - is_perfect (black label) is excluded for the same reason: it is a rarer,
 *     pricier sub-grade, so folding it in would overstate an ordinary PSA 10.
 * market first, then mid, then low — the same preference order as raw.
 */
function gradedDollars(
  prices: z.infer<typeof priceEntry>[] | null | undefined,
  company: string,
  grade: string,
): number | null {
  if (!prices?.length) return null;
  for (const p of prices) {
    if ((p.type ?? "").toLowerCase() !== "graded") continue;
    if ((p.company ?? "").toUpperCase() !== company) continue;
    if (String(p.grade ?? "").trim() !== grade) continue;
    if (p.is_signed || p.is_error || p.is_perfect) continue;
    if (p.currency && p.currency.toUpperCase() !== "USD") continue;
    const v = p.market ?? p.mid ?? p.low;
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
}

/** The graded kinds we model, in the order they are emitted. */
const GRADED_KINDS = [
  { kind: "psa10" as const, company: "PSA", grade: "10" },
  { kind: "psa9" as const, company: "PSA", grade: "9" },
];

/** Does this variant carry any usable graded entry at all? */
function hasGraded(prices: z.infer<typeof priceEntry>[] | null | undefined): boolean {
  return GRADED_KINDS.some(({ company, grade }) => gradedDollars(prices, company, grade) !== null);
}

/**
 * The widest ratio between our raw price and a variant's raw price that still
 * counts as "the same printing". Competing printings of a card sit far further
 * apart than this (Base Charizard's variants are 3.5x+ apart), while the same
 * printing differs only by price drift between snapshots.
 */
const PRINTING_MATCH_MAX_RATIO = 3;

/**
 * The most a PSA 10 may exceed the SAME card's PSA 9 before we treat it as
 * unverifiable rather than a price.
 *
 * Graded entries for low-population cards are asking prices, not sales, and a
 * single fantasy listing shows up as a PSA 10 wildly detached from its PSA 9 —
 * e.g. a Platinum Giratina LV.X at PSA 10 $29,890 against PSA 9 $1,017 (29x)
 * on a $112 raw card, or the suspiciously round $15,000 seen on several
 * Black & White cards. Left in, those flow straight into graded EV and invent
 * a "worth grading" verdict out of one listing.
 *
 * 12x is the 90th percentile of the observed PSA10:PSA9 distribution across
 * 5,403 paired cards (median 4.0x, p75 6.7x), and sits well clear of every
 * verified chase — Base Charizard 3.5x, Blastoise 7.2x, Moonbreon 2.0x. Above
 * it we drop the PSA 10 only; graded valuation needs both grades, so the card
 * quietly falls back to its raw value. Understating grading upside is the safe
 * error, inventing it is not.
 */
const MAX_PSA10_OVER_PSA9 = 12;

/**
 * Which ONE of a Pokémon card's variants our single catalog row represents.
 *
 * Scrydex lists each PRINTING as a variant — 1st Edition, Shadowless,
 * Unlimited, reverse holo — each with its own graded prices, and those differ
 * enormously ($584 to $414,330 for Base Charizard). Our catalog has one row per
 * card, so emitting every variant would leave whichever wrote last attached to
 * the row: a 1st-Edition PSA 10 on an Unlimited card is a ~29x overstatement,
 * straight into graded EV.
 *
 * The raw price settles it: our stored raw came from the printing the row
 * really is, so the variant whose own raw price is nearest to it is that
 * printing. When nothing is near, or the card is ambiguous and we hold no raw
 * price, this returns null and the card is skipped — refusing to guess is the
 * safe error, since a missing graded price only hides the grading upside while
 * a wrong one inflates it.
 */
function pickPokemonVariant(
  variants: z.infer<typeof variantSchema>[],
  ourRawCents: number | null | undefined,
): z.infer<typeof variantSchema> | null {
  const candidates = variants.filter((v) => hasGraded(v.prices));
  if (candidates.length === 0) return null;
  // Only one printing carries graded prices — no ambiguity to resolve.
  if (candidates.length === 1) return candidates[0]!;
  if (!ourRawCents || ourRawCents <= 0) return null;

  const ourDollars = ourRawCents / 100;
  let best: z.infer<typeof variantSchema> | null = null;
  let bestRatio = Infinity;
  for (const v of candidates) {
    const raw = rawDollars(v.prices);
    if (raw === null || raw <= 0) continue;
    const ratio = raw > ourDollars ? raw / ourDollars : ourDollars / raw;
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = v;
    }
  }
  return bestRatio <= PRINTING_MATCH_MAX_RATIO ? best : null;
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

        // One Piece: price each printing the catalog carries, matched by the
        // SAME variant map the Scrydex catalog adapter used to create the rows.
        // Because both sides read one taxonomy, a card labelled "manga" always
        // gets the mangaAltArt price — no cross-source name-guessing, so the
        // earlier base-only guard is no longer needed.
        const variantsByName = new Map<string, z.infer<typeof variantSchema>>();
        for (const v of card.variants ?? []) if (v.name) variantsByName.set(v.name, v);

        const emit = (treatment: string, dollars: number | null) => {
          if (dollars === null) return;
          const match = opByNumberTreatment.get(`${card.id}|${treatment}`);
          if (!match) return;
          out.push({
            externalCardId: match.externalIds["scrydex"] ?? `${card.id}:${treatment}`,
            sourceId: "tcgplayer_market",
            priceCents: toCents(dollars),
            kind: "raw",
            capturedAt,
          });
        };

        // Base printing: normal, else foil (foil-native SR/SEC/TR).
        emit(
          "base",
          rawDollars(variantsByName.get("normal")?.prices) ??
            rawDollars(variantsByName.get("foil")?.prices),
        );
        // Mapped treatment tiers.
        for (const [variantName, { treatment }] of Object.entries(SCRYDEX_TREATMENT_VARIANTS)) {
          emit(treatment, rawDollars(variantsByName.get(variantName)?.prices));
        }
        // Display-only high-tier printings (premium/full-art/gold/textured).
        for (const [variantName, { treatment }] of Object.entries(SCRYDEX_DISPLAY_VARIANTS)) {
          emit(treatment, rawDollars(variantsByName.get(variantName)?.prices));
        }
      }

      const total = res.total_count;
      const size = res.page_size ?? PAGE_SIZE;
      if (rows.length === 0 || total == null || page * size >= total) break;
    }

    return out;
  },

  /**
   * PSA 10 / PSA 9 prices for a set's cards, from the SAME per-expansion paged
   * endpoint the raw fetch uses (`include=prices` returns raw and graded
   * entries together). One request per page of a set — never per card — so a
   * full graded pass over a set costs the same handful of credits as raw.
   *
   * Emits under its own source id (`scrydex_graded`), not tcgplayer_market:
   * graded sale prices are a different market from raw NM asks and the UI
   * attributes them separately, alongside PokemonPriceTracker.
   */
  async fetchGradedPrices(
    set: CatalogSet,
    cards: PriceableCard[],
  ): Promise<PriceSnapshotInput[]> {
    const creds = credentials();
    if (!creds) return [];

    const game = gameOf(set);
    const path = GAME_PATH[game];
    if (!path) return [];

    // Scrydex carries English printings. A JP/ZH set (TCGdex-sourced, so no
    // pokemontcg_io id) would otherwise fall back to its bare set code, which
    // can collide with an English expansion id — pointing a Japanese set at
    // English graded prices. Its cards carry no pokemontcg_io id so nothing
    // would match today, but the guard makes that safety explicit rather than
    // incidental.
    if (set.language !== "EN") return [];
    if (game === "pokemon" && !set.externalIds["pokemontcg_io"]) return [];

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
        : set.code.replace(/-/g, "");

    const out: PriceSnapshotInput[] = [];
    let implausible = 0;
    for (let page = 1; ; page++) {
      const res = await fetchJson(
        `${BASE}/${path}/v1/expansions/${encodeURIComponent(expansionId)}/cards?include=prices&page=${page}&page_size=${PAGE_SIZE}`,
        cardsResponse,
        { provider: "scrydex", headers },
      );

      const rows = res.data ?? [];
      const capturedAt = new Date();

      for (const card of rows) {
        // Resolve this Scrydex card to our row(s), mirroring the raw matcher:
        // Pokémon ids are ours 1:1; One Piece keys on number + treatment.
        const targets: { match: PriceableCard; prices: z.infer<typeof priceEntry>[] }[] = [];

        if (game === "pokemon") {
          const match = pokemonByExternalId.get(card.id);
          if (match) {
            // EXACTLY ONE variant per card — see pickPokemonVariant. Pushing
            // every variant would race several printings' graded prices onto
            // the same row.
            const v = pickPokemonVariant(card.variants ?? [], match.rawCents);
            if (v?.prices?.length) targets.push({ match, prices: v.prices });
          }
        } else {
          const variantsByName = new Map<string, z.infer<typeof variantSchema>>();
          for (const v of card.variants ?? []) if (v.name) variantsByName.set(v.name, v);

          const consider = (treatment: string, variantName: string | undefined) => {
            if (!variantName) return;
            const match = opByNumberTreatment.get(`${card.id}|${treatment}`);
            const prices = variantsByName.get(variantName)?.prices;
            if (match && prices?.length) targets.push({ match, prices });
          };
          consider("base", variantsByName.has("normal") ? "normal" : "foil");
          for (const [variantName, { treatment }] of Object.entries(SCRYDEX_TREATMENT_VARIANTS)) {
            consider(treatment, variantName);
          }
          for (const [variantName, { treatment }] of Object.entries(SCRYDEX_DISPLAY_VARIANTS)) {
            consider(treatment, variantName);
          }
        }

        for (const { match, prices } of targets) {
          const psa10 = gradedDollars(prices, "PSA", "10");
          const psa9 = gradedDollars(prices, "PSA", "9");

          // A PSA 10 detached from its own PSA 9 is a fantasy listing, not a
          // price — drop it and let the card fall back to raw.
          const psa10Trusted =
            psa10 !== null &&
            (psa9 === null || psa10 <= psa9 * MAX_PSA10_OVER_PSA9);
          if (psa10 !== null && !psa10Trusted) implausible++;

          const emit = (kind: "psa10" | "psa9", dollars: number | null) => {
            if (dollars === null) return;
            // Same rule the PokemonPriceTracker job uses: a slab worth less
            // than the raw card is bad data, not a bargain.
            const cents = toCents(dollars);
            if (match.rawCents) {
              const floor = kind === "psa9" ? Math.round(match.rawCents * 0.5) : match.rawCents;
              if (cents < floor) return;
            }
            out.push({
              externalCardId:
                match.externalIds["pokemontcg_io"] ??
                match.externalIds["scrydex"] ??
                card.id,
              sourceId: GRADED_SOURCE_ID,
              priceCents: cents,
              kind,
              capturedAt,
            });
          };

          emit("psa10", psa10Trusted ? psa10 : null);
          emit("psa9", psa9);
        }
      }

      const total = res.total_count;
      const size = res.page_size ?? PAGE_SIZE;
      if (rows.length === 0 || total == null || page * size >= total) break;
    }

    if (implausible > 0) {
      // Visible, not silent: a dropped price is data we chose not to trust.
      console.warn(
        `[scrydex] ${set.code}: dropped ${implausible} PSA 10 price(s) exceeding ${MAX_PSA10_OVER_PSA9}x their PSA 9.`,
      );
    }
    return out;
  },

  async fetchSealedPrices(set: CatalogSet): Promise<PriceSnapshotInput[]> {
    const creds = credentials();
    if (!creds) return [];

    const game = gameOf(set);
    const path = GAME_PATH[game];
    if (!path) return [];

    const capturedAt = new Date();
    return [...(await bestSealedByType(set, creds))]
      .filter(([, v]) => v.cents !== null)
      .map(([ourType, v]) => ({
        externalProductId: ourType,
        sourceId: "tcgplayer_market",
        priceCents: v.cents!,
        kind: "sealed" as const,
        capturedAt,
      }));
  },
};

/**
 * The plainest-named qualifying sealed SKU per our product type — its price AND
 * image. Shortest name wins ("Kingdoms of Intrigue Booster Box" beats any
 * longer edition string); decoys (Case, Sleeved, Dash Pack, wave/edition) are
 * rejected. Shared by fetchSealedPrices (prices) and fetchScrydexSealedImages
 * (catalog photos) so both point at the same box.
 */
async function bestSealedByType(
  set: CatalogSet,
  creds: { key: string; teamId: string },
): Promise<Map<string, { name: string; cents: number | null; imageUrl: string | null }>> {
  const game = gameOf(set);
  const path = GAME_PATH[game];
  const best = new Map<string, { name: string; cents: number | null; imageUrl: string | null }>();
  if (!path) return best;

  const expansionId =
    game === "pokemon" ? (set.externalIds["pokemontcg_io"] ?? set.code) : set.code.replace(/-/g, "");
  const headers = { "X-Api-Key": creds.key, "X-Team-ID": creds.teamId };

  for (let page = 1; ; page++) {
    const res = await fetchJson(
      `${BASE}/${path}/v1/expansions/${encodeURIComponent(expansionId)}/sealed?include=prices&page=${page}&page_size=${PAGE_SIZE}`,
      sealedResponse,
      { provider: "scrydex", headers },
    );
    const rows = res.data ?? [];
    for (const item of rows) {
      const rule = item.type ? SEALED_TYPES[item.type.toLowerCase()] : undefined;
      if (!rule) continue;
      const name = item.name ?? "";
      if (rule.nameMustNot.test(name)) continue;
      if (rule.nameMust && !rule.nameMust.test(name)) continue;
      const prev = best.get(rule.our);
      if (!prev || name.length < prev.name.length) {
        const dollars = sealedRawDollars(item);
        best.set(rule.our, {
          name,
          cents: dollars === null ? null : toCents(dollars),
          imageUrl: sealedImageUrl(item),
        });
      }
    }
    const total = res.total_count;
    const size = res.page_size ?? PAGE_SIZE;
    if (rows.length === 0 || total == null || page * size >= total) break;
  }
  return best;
}

/**
 * Product photos for a set's sealed products, keyed by our product type
 * (booster_box / booster_pack). Catalog data — called from refresh-catalog to
 * fill sealed_products.image_url. Returns an empty map without credentials.
 */
export async function fetchScrydexSealedImages(set: CatalogSet): Promise<Map<string, string>> {
  const creds = credentials();
  if (!creds) return new Map();
  const out = new Map<string, string>();
  for (const [ourType, v] of await bestSealedByType(set, creds)) {
    if (v.imageUrl) out.set(ourType, v.imageUrl);
  }
  return out;
}

function gameOf(set: CatalogSet): string {
  if (set.externalIds["pokemontcg_io"]) return "pokemon";
  if (set.externalIds["optcgapi"]) return "one-piece";
  return "unknown";
}
