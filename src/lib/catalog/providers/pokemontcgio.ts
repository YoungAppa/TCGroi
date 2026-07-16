import { z } from "zod";

import { fetchJson } from "../http";
import { normalizePokemonRarity } from "../normalize";
import { CatalogError, type CatalogAdapter, type CatalogCard, type CatalogSet } from "../types";

/**
 * Pokémon catalog via pokemontcg.io.
 *
 * Chosen over TCGdex after a live comparison: TCGdex only exposes `rarity` on
 * its individual-card endpoint (both the REST set listing and the GraphQL
 * nested resolver return briefs with rarity null), which would cost ~252
 * requests per set. pokemontcg.io returns full cards including rarity at
 * 250/page — 2 requests for a 252-card set.
 *
 * Works without an API key. A free POKEMONTCG_IO_KEY raises the rate limit and
 * is read if present, but is never required.
 */
const BASE = "https://api.pokemontcg.io/v2";

const setSchema = z.object({
  id: z.string(),
  name: z.string(),
  releaseDate: z.string().nullish(),
  total: z.number().nullish(),
  printedTotal: z.number().nullish(),
});

const setsResponse = z.object({ data: z.array(setSchema) });

const cardSchema = z.object({
  id: z.string(),
  name: z.string(),
  number: z.string(),
  rarity: z.string().nullish(),
  images: z.object({ small: z.string().nullish(), large: z.string().nullish() }).nullish(),
});

const cardsResponse = z.object({
  data: z.array(cardSchema),
  page: z.number(),
  pageSize: z.number(),
  count: z.number(),
  totalCount: z.number(),
});

const PAGE_SIZE = 250;

export class PokemonTcgIoAdapter implements CatalogAdapter {
  readonly gameSlug = "pokemon" as const;
  readonly providerId = "pokemontcg_io";
  readonly displayName = "pokemontcg.io";

  /** No key required — this adapter is always available. */
  enabled(): boolean {
    return true;
  }

  private headers(): Record<string, string> {
    const key = process.env.POKEMONTCG_IO_KEY;
    return key ? { "X-Api-Key": key } : {};
  }

  async fetchSets(): Promise<CatalogSet[]> {
    const res = await fetchJson(
      `${BASE}/sets?orderBy=-releaseDate&pageSize=${PAGE_SIZE}`,
      setsResponse,
      { provider: this.providerId, headers: this.headers(), treat404AsTransient: true, retries: 4 },
    );

    return res.data.map((s) => ({
      code: s.id,
      name: s.name,
      // The API formats dates as YYYY/MM/DD; Postgres wants YYYY-MM-DD.
      releaseDate: s.releaseDate ? s.releaseDate.replace(/\//g, "-") : null,
      language: "EN" as const,
      expectedCardCount: s.total ?? null,
      externalIds: { pokemontcg_io: s.id },
    }));
  }

  async fetchCards(set: CatalogSet): Promise<CatalogCard[]> {
    const out: CatalogCard[] = [];
    const unmapped = new Set<string>();

    for (let page = 1; ; page++) {
      const q = encodeURIComponent(`set.id:${set.code}`);
      const res = await fetchJson(
        `${BASE}/cards?q=${q}&page=${page}&pageSize=${PAGE_SIZE}`,
        cardsResponse,
        { provider: this.providerId, headers: this.headers(), treat404AsTransient: true, retries: 4 },
      );

      for (const c of res.data) {
        const rarity = normalizePokemonRarity(c.rarity);
        if (!rarity) {
          // Collect rather than throw: one unmapped rarity shouldn't abort an
          // otherwise good ingest, but it must not pass silently either.
          unmapped.add(c.rarity ?? "(null)");
          continue;
        }

        out.push({
          name: c.name,
          number: c.number,
          rarity,
          // pokemontcg.io models reverse-holo as a *price variant* of one card
          // rather than a separate card, so every row here is a base printing.
          treatment: "base",
          imageUrl: c.images?.large ?? c.images?.small ?? null,
          externalIds: { pokemontcg_io: c.id },
        });
      }

      if (res.page * res.pageSize >= res.totalCount || res.data.length === 0) break;
    }

    if (unmapped.size > 0) {
      throw new CatalogError(
        `unmapped rarities in set ${set.code}: ${[...unmapped].join(", ")}. Add them to POKEMON_RARITY_MAP — cards with an unknown rarity are dropped from EV.`,
        this.providerId,
      );
    }

    return out;
  }
}
