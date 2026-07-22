import { z } from "zod";

import { getEnv } from "@/lib/env";

import { fetchJson } from "../http";
import {
  SCRYDEX_BASE_VARIANTS,
  SCRYDEX_TREATMENT_VARIANTS,
  scrydexBaseRarity,
} from "../scrydex-variants";
import { CatalogError, type CatalogAdapter, type CatalogCard, type CatalogSet } from "../types";

/**
 * One Piece catalog via Scrydex (api.scrydex.com) — the LICENSED successor to
 * pokemontcg.io, which also covers One Piece.
 *
 * Why this replaced optcgapi as the OP catalog source: optcgapi's card naming
 * conflates printings (it labels the $4,000 Shanks manga "Shanks (Parallel)
 * (Manga)" and our normaliser filed it as a $96 alt-art), and its prices are
 * scraped so we can't use them. Scrydex enumerates each printing as its own
 * VARIANT with a licensed price, so taking Scrydex as the catalog means each
 * card and its price come from one self-consistent source — no cross-provider
 * name-matching, which is where the mispricing crept in.
 *
 * One card row is emitted per booster-pack tier: the base printing (normal, or
 * foil for foil-native SR/SEC/TR), plus the mapped treatment variants (alt_art,
 * manga, wanted_poster, sp, treasure). Promo/stamp/special-release variants are
 * skipped — see scrydex-variants.ts.
 */
const BASE = "https://api.scrydex.com";
const PAGE_SIZE = 100;

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
  "OP-10": "Royal Blood",
  "OP-11": "A Fist of Divine Speed",
  "OP-12": "Legacy of the Master",
  "OP-13": "Carrying On His Will",
  "OP-14": "The Azure Sea's Seven",
  "OP-15": "Adventure on Kami's Island",
  "OP-16": "The Time of Battle",
  // EB (Extra Booster) and PRB (Premium Booster) lines are deliberately absent:
  // different pack structures with no community pull-rate study, so they can't
  // rank honestly yet. Add when rates exist.
};

const imageSchema = z
  .object({ type: z.string().nullish(), large: z.string().nullish(), medium: z.string().nullish() })
  .passthrough();

const variantSchema = z
  .object({ name: z.string().nullish(), images: z.array(imageSchema).nullish() })
  .passthrough();

const cardSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    number: z.string().nullish(),
    rarity_code: z.string().nullish(),
    images: z.array(imageSchema).nullish(),
    variants: z.array(variantSchema).nullish(),
  })
  .passthrough();

const cardsResponse = z
  .object({
    data: z.array(cardSchema).nullish(),
    page: z.number().nullish(),
    page_size: z.number().nullish(),
    total_count: z.number().nullish(),
  })
  .passthrough();

const expansionSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    code: z.string().nullish(),
    release_date: z.string().nullish(),
    logo: z.string().nullish(),
    total: z.number().nullish(),
    language_code: z.string().nullish(),
  })
  .passthrough();

function credentials(): { key: string; teamId: string } | null {
  const env = getEnv();
  const key = env.TCGPLAYER_MIRROR_API_KEY;
  const teamId = env.SCRYDEX_TEAM_ID;
  return key && teamId ? { key, teamId } : null;
}

/** "OP-04" (our code) → "OP04" (Scrydex expansion id). */
function expansionId(setCode: string): string {
  return setCode.replace(/-/g, "");
}

function firstImage(images: z.infer<typeof imageSchema>[] | null | undefined): string | null {
  const img = images?.[0];
  return img?.large ?? img?.medium ?? null;
}

export class ScrydexCatalogAdapter implements CatalogAdapter {
  readonly gameSlug = "one-piece" as const;
  readonly providerId = "scrydex";
  readonly displayName = "Scrydex";

  enabled(): boolean {
    return credentials() !== null;
  }

  async fetchSets(): Promise<CatalogSet[]> {
    const creds = credentials();
    if (!creds) return [];
    const headers = { "X-Api-Key": creds.key, "X-Team-ID": creds.teamId };

    // Only the numbered main booster sets we carry pull rates for; Scrydex also
    // lists starter decks, EB/PRB lines and promos we don't rank.
    const wanted = new Set(Object.keys(SET_NAMES).map(expansionId));
    const byCode = new Map<string, z.infer<typeof expansionSchema>>();
    for (let page = 1; ; page++) {
      const res = await fetchJson(
        `${BASE}/onepiece/v1/expansions?page=${page}&page_size=${PAGE_SIZE}`,
        z.object({
          data: z.array(expansionSchema).nullish(),
          total_count: z.number().nullish(),
          page_size: z.number().nullish(),
        }),
        { provider: this.providerId, headers },
      );
      const rows = res.data ?? [];
      for (const e of rows) {
        if ((e.language_code ?? "EN") === "EN" && wanted.has(e.id)) byCode.set(e.id, e);
      }
      const total = res.total_count;
      const size = res.page_size ?? PAGE_SIZE;
      if (rows.length === 0 || total == null || page * size >= total) break;
    }

    return Object.keys(SET_NAMES).map((code) => {
      const e = byCode.get(expansionId(code));
      return {
        code,
        name: SET_NAMES[code] ?? code,
        releaseDate: e?.release_date ? e.release_date.replace(/\//g, "-") : null,
        language: "EN" as const,
        expectedCardCount: e?.total ?? null,
        logoUrl: e?.logo ?? null,
        externalIds: { scrydex: expansionId(code) },
      };
    });
  }

  async fetchCards(set: CatalogSet): Promise<CatalogCard[]> {
    const creds = credentials();
    if (!creds) throw new CatalogError("Scrydex credentials missing", this.providerId);
    const headers = { "X-Api-Key": creds.key, "X-Team-ID": creds.teamId };
    const exp = set.externalIds["scrydex"] ?? expansionId(set.code);

    const out: CatalogCard[] = [];
    const seen = new Set<string>();
    for (let page = 1; ; page++) {
      const res = await fetchJson(
        `${BASE}/onepiece/v1/expansions/${encodeURIComponent(exp)}/cards?page=${page}&page_size=${PAGE_SIZE}`,
        cardsResponse,
        { provider: this.providerId, headers },
      );

      const rows = res.data ?? [];
      for (const card of rows) {
        const variantsByName = new Map<string, z.infer<typeof variantSchema>>();
        for (const v of card.variants ?? []) if (v.name) variantsByName.set(v.name, v);

        // Base printing: normal, else foil (foil-native SR/SEC/TR).
        const baseRarity = scrydexBaseRarity(card.rarity_code);
        const baseVariant = SCRYDEX_BASE_VARIANTS.find((n) => variantsByName.has(n));
        if (baseRarity && baseVariant) {
          out.push(
            makeCard(card, "base", baseRarity, firstImage(variantsByName.get(baseVariant)?.images) ?? firstImage(card.images), seen),
          );
        }

        // Mapped treatment tiers, each its own card row.
        for (const [variantName, { treatment, rarity }] of Object.entries(SCRYDEX_TREATMENT_VARIANTS)) {
          const v = variantsByName.get(variantName);
          if (!v) continue;
          out.push(makeCard(card, treatment, rarity, firstImage(v.images) ?? firstImage(card.images), seen));
        }
      }

      const total = res.total_count;
      const size = res.page_size ?? PAGE_SIZE;
      if (rows.length === 0 || total == null || page * size >= total) break;
    }

    if (out.length === 0) {
      throw new CatalogError(`no cards returned for ${set.code} (${exp})`, this.providerId);
    }
    return out;
  }
}

/** Build a CatalogCard; guards against (number, treatment) collisions. */
function makeCard(
  card: z.infer<typeof cardSchema>,
  treatment: string,
  rarity: string,
  imageUrl: string | null,
  seen: Set<string>,
): CatalogCard {
  const key = `${card.id}::${treatment}`;
  if (seen.has(key)) {
    throw new CatalogError(
      `two variants mapped to (${card.id}, ${treatment}) — a variant map entry is duplicated`,
      "scrydex",
    );
  }
  seen.add(key);
  return {
    name: card.name ?? card.id,
    number: card.id, // Scrydex card id IS the collector number (OP01-120)
    rarity,
    treatment,
    imageUrl,
    externalIds: { scrydex: `${card.id}:${treatment}` },
  };
}
