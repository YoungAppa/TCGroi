import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/lib/env";
import type { CatalogSet } from "@/lib/catalog/types";

import type { PriceableCard } from "../types";
import { scrydexPriceProvider } from "./scrydex-prices";

/**
 * Fixtures mirror REAL Scrydex responses captured live on 2026-07-22 (see the
 * VERIFIED block in scrydex-prices.ts): snake_case envelope, variants[] with
 * per-condition price entries. If Scrydex changes shape, these tests document
 * what the adapter was built against.
 */

function opSet(code = "OP-04"): CatalogSet {
  return {
    code,
    name: "Kingdoms of Intrigue",
    releaseDate: null,
    language: "EN",
    expectedCardCount: null,
    externalIds: { optcgapi: code },
  };
}

function pokemonSet(code = "sv8"): CatalogSet {
  return {
    code,
    name: "Surging Sparks",
    releaseDate: null,
    language: "EN",
    expectedCardCount: null,
    externalIds: { pokemontcg_io: code },
  };
}

function opCard(number: string, treatment: string): PriceableCard {
  return {
    cardId: `id-${number}-${treatment}`,
    name: number,
    number,
    rarity: "x",
    treatment,
    externalIds: { optcgapi: `${number}:${treatment}` },
  };
}

function rawEntry(condition: string, market: number | null, low: number | null = null) {
  return {
    condition,
    grade: null,
    company: null,
    type: "raw",
    market,
    low,
    mid: null,
    currency: "USD",
  };
}

function respond(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function envelope(data: unknown[], total = data.length) {
  return { data, page: 1, page_size: 100, count: data.length, total_count: total };
}

beforeEach(() => {
  // getEnv() validates the whole env shape, so the required base vars must
  // exist even though this provider never touches them.
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.ADMIN_SECRET = "test-secret";
  process.env.TCGPLAYER_MIRROR_API_KEY = "test-key";
  process.env.SCRYDEX_TEAM_ID = "test-team";
  resetEnvCache();
});

afterEach(() => {
  delete process.env.TCGPLAYER_MIRROR_API_KEY;
  delete process.env.SCRYDEX_TEAM_ID;
  resetEnvCache();
  vi.unstubAllGlobals();
});

describe("scrydexPriceProvider — One Piece variant→treatment matching", () => {
  it("prices each treatment row from its own variant, skipping unmapped printings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          envelope([
            {
              id: "OP04-083",
              name: "Sabo",
              number: "83",
              variants: [
                { name: "normal", prices: [rawEntry("NM", 1.5)] },
                { name: "mangaAltArt", prices: [rawEntry("NM", 693.5)] },
                // A printing our catalog does not model — must be skipped, not
                // guessed onto some row.
                { name: "championshipStamp", prices: [rawEntry("NM", 93.39)] },
              ],
            },
          ]),
        ),
      ),
    );

    const out = await scrydexPriceProvider.fetchCardPrices(opSet(), [
      opCard("OP04-083", "base"),
      opCard("OP04-083", "manga"),
    ]);

    expect(out).toHaveLength(2);
    const byId = new Map(out.map((s) => [s.externalCardId, s]));
    expect(byId.get("OP04-083:base")?.priceCents).toBe(150);
    expect(byId.get("OP04-083:manga")?.priceCents).toBe(69350);
    for (const s of out) {
      expect(s.sourceId).toBe("tcgplayer_market");
      expect(s.kind).toBe("raw");
    }
  });

  it("prices an SR/SEC base row from 'foil' when no 'normal' variant exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          envelope([
            {
              // Real shape: OP04-083 Sabo SR — foil IS the base printing.
              id: "OP04-083",
              variants: [
                { name: "foil", prices: [rawEntry("NM", 0.79)] },
                { name: "altArt", prices: [rawEntry("NM", 18.61)] },
              ],
            },
          ]),
        ),
      ),
    );

    const sr = { ...opCard("OP04-083", "base"), rarity: "super_rare" };
    const alt = { ...opCard("OP04-083", "alt_art"), rarity: "alt_art" };
    const out = await scrydexPriceProvider.fetchCardPrices(opSet(), [sr, alt]);

    const byId = new Map(out.map((s) => [s.externalCardId, s]));
    expect(byId.get("OP04-083:base")?.priceCents).toBe(79);
    expect(byId.get("OP04-083:alt_art")?.priceCents).toBe(1861);
  });

  it("never lets a common's separate foil printing stand in for its base row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          envelope([
            {
              // A common whose "normal" is unpriced but which has a foil
              // printing: the base row must stay unpriced, not take the foil.
              id: "OP04-002",
              variants: [{ name: "foil", prices: [rawEntry("NM", 0.22)] }],
            },
          ]),
        ),
      ),
    );

    const common = { ...opCard("OP04-002", "base"), rarity: "common" };
    const out = await scrydexPriceProvider.fetchCardPrices(opSet(), [common]);
    expect(out).toHaveLength(0);
  });

  it("prefers textured manga over nonTextured for the single manga row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          envelope([
            {
              id: "OP04-083",
              variants: [
                { name: "nonTexturedMangaAltArt", prices: [rawEntry("NM", 100)] },
                { name: "mangaAltArt", prices: [rawEntry("NM", 693.5)] },
              ],
            },
          ]),
        ),
      ),
    );

    const out = await scrydexPriceProvider.fetchCardPrices(opSet(), [
      opCard("OP04-083", "manga"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.priceCents).toBe(69350);
  });

  it("prefers the NM condition and falls back to low when market is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          envelope([
            {
              id: "OP04-001",
              variants: [
                {
                  name: "normal",
                  prices: [rawEntry("MP", 220), rawEntry("NM", null, 290.59), rawEntry("LP", 273.13)],
                },
              ],
            },
          ]),
        ),
      ),
    );

    const out = await scrydexPriceProvider.fetchCardPrices(opSet(), [
      opCard("OP04-001", "base"),
    ]);
    // NM has no market but has a low — NM low beats LP market.
    expect(out[0]!.priceCents).toBe(29059);
  });

  it("derives the expansion id from the set code without hyphens", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => respond(envelope([])));
    vi.stubGlobal("fetch", fetchMock);

    await scrydexPriceProvider.fetchCardPrices(opSet("OP-04"), [opCard("OP04-001", "base")]);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/onepiece/v1/expansions/OP04/cards");
  });
});

describe("scrydexPriceProvider — Pokémon id parity", () => {
  it("matches by pokemontcg_io id and prices the first variant with a raw NM", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          envelope([
            {
              id: "sv8-238",
              variants: [{ name: "holofoil", prices: [rawEntry("NM", 347.56)] }],
            },
          ]),
        ),
      ),
    );

    const card: PriceableCard = {
      cardId: "abc",
      name: "Pikachu ex",
      number: "238",
      rarity: "special_illustration_rare",
      treatment: "base",
      externalIds: { pokemontcg_io: "sv8-238" },
    };

    const out = await scrydexPriceProvider.fetchCardPrices(pokemonSet(), [card]);
    expect(out).toHaveLength(1);
    expect(out[0]!.externalCardId).toBe("sv8-238");
    expect(out[0]!.priceCents).toBe(34756);
  });
});

describe("scrydexPriceProvider — pagination", () => {
  it("follows total_count across pages", async () => {
    const page1 = envelope(
      Array.from({ length: 100 }, (_, i) => ({ id: `OP04-${i}`, variants: [] })),
      119,
    );
    const page2 = {
      ...envelope(
        Array.from({ length: 19 }, (_, i) => ({ id: `OP04-${100 + i}`, variants: [] })),
        119,
      ),
      page: 2,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(page1))
      .mockResolvedValueOnce(respond(page2));
    vi.stubGlobal("fetch", fetchMock);

    await scrydexPriceProvider.fetchCardPrices(opSet(), [opCard("OP04-001", "base")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("page=2");
  });

  it("returns nothing without credentials instead of calling out", async () => {
    delete process.env.TCGPLAYER_MIRROR_API_KEY;
    resetEnvCache();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const out = await scrydexPriceProvider.fetchCardPrices(opSet(), [opCard("OP04-001", "base")]);
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
