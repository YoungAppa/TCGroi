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

describe("scrydexPriceProvider — One Piece native variant matching", () => {
  it("prices base + each mapped treatment from its own variant, self-consistently", async () => {
    // Catalog and price share one variant map, so mangaAltArt always lands on
    // the 'manga' row — the $4,000 Shanks manga can no longer read as $96.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          envelope([
            {
              id: "OP01-120",
              name: "Shanks",
              variants: [
                { name: "foil", prices: [rawEntry("NM", 10.11)] }, // SEC base is foil
                { name: "altArt", prices: [rawEntry("NM", 110.88)] },
                { name: "mangaAltArt", prices: [rawEntry("NM", 3999.74)] },
                { name: "premiumAltArt", prices: [rawEntry("NM", 26.35)] }, // not a modelled tier
              ],
            },
          ]),
        ),
      ),
    );

    const out = await scrydexPriceProvider.fetchCardPrices(opSet(), [
      opCard("OP01-120", "base"),
      opCard("OP01-120", "alt_art"),
      opCard("OP01-120", "manga"),
    ]);

    const byId = new Map(out.map((s) => [s.externalCardId, s]));
    expect(byId.get("OP01-120:base")?.priceCents).toBe(1011); // foil = base for SEC
    expect(byId.get("OP01-120:alt_art")?.priceCents).toBe(11088);
    expect(byId.get("OP01-120:manga")?.priceCents).toBe(399974);
    // premiumAltArt has no catalog row → not priced.
    expect(out).toHaveLength(3);
    for (const s of out) {
      expect(s.sourceId).toBe("tcgplayer_market");
      expect(s.kind).toBe("raw");
    }
  });

  it("prices base from 'normal' when present, ignoring a separate foil parallel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          envelope([
            {
              id: "OP04-024",
              // A rare with both a normal (base) and a pricier foil — base must
              // take the normal, never the foil.
              variants: [
                { name: "normal", prices: [rawEntry("NM", 0.2)] },
                { name: "foil", prices: [rawEntry("NM", 5.0)] },
              ],
            },
          ]),
        ),
      ),
    );

    const out = await scrydexPriceProvider.fetchCardPrices(opSet(), [opCard("OP04-024", "base")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.priceCents).toBe(20); // the $0.20 normal, not the $5 foil
  });

  it("skips a variant whose catalog row we don't carry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          envelope([
            {
              id: "OP04-083",
              variants: [
                { name: "normal", prices: [rawEntry("NM", 1.5)] },
                { name: "mangaAltArt", prices: [rawEntry("NM", 693.5)] },
              ],
            },
          ]),
        ),
      ),
    );

    // Catalog carries only the base row — the manga price has nowhere to land.
    const out = await scrydexPriceProvider.fetchCardPrices(opSet(), [opCard("OP04-083", "base")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.externalCardId).toBe("OP04-083:base");
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
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => respond(envelope([])));
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

describe("scrydexPriceProvider — sealed products", () => {
  function sealedEnvelope(items: unknown[]) {
    return { data: items, page: 1, page_size: 100, total_count: items.length };
  }

  it("maps the plain booster box/pack, rejecting sleeved/case/dash decoys", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
      respond(
        sealedEnvelope([
          { id: "s1", type: "Booster Pack", name: "Kingdoms of Intrigue Booster Pack", variants: [{ name: "u", prices: [{ type: "raw", condition: "U", market: 13.69 }] }] },
          { id: "s2", type: "Booster Pack", name: "Kingdoms of Intrigue Sleeved Booster Pack", variants: [{ name: "u", prices: [{ type: "raw", condition: "U", market: 48.91 }] }] },
          { id: "s3", type: "Booster Box", name: "Kingdoms of Intrigue Booster Box", variants: [{ name: "u", prices: [{ type: "raw", condition: "U", market: 504.36 }] }] },
          { id: "s4", type: "Booster Box", name: "Kingdoms of Intrigue Booster Box Case", variants: [{ name: "u", prices: [{ type: "raw", condition: "U", market: 3000 }] }] },
          { id: "s5", type: null, name: "Kingdoms of Intrigue Dash Pack", variants: [{ name: "u", prices: [{ type: "raw", condition: "U", market: 4.77 }] }] },
        ]),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await scrydexPriceProvider.fetchSealedPrices(opSet());
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/onepiece/v1/expansions/OP04/sealed");
    const byType = new Map(out.map((s) => [s.externalProductId, s]));
    expect(byType.size).toBe(2);
    expect(byType.get("booster_pack")?.priceCents).toBe(1369); // not the $48.91 sleeved
    expect(byType.get("booster_box")?.priceCents).toBe(50436); // not the $3000 case
    for (const s of out) {
      expect(s.kind).toBe("sealed");
      expect(s.sourceId).toBe("tcgplayer_market");
    }
  });

  it("rejects wave/edition boxes rather than guess which one is ours", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          sealedEnvelope([
            { id: "b1", type: "Booster Box", name: "Romance Dawn Booster Box (Wave 1 - Blue Bottom)", prices: [{ type: "raw", condition: "U", market: 1650 }] },
            { id: "b2", type: "Booster Box", name: "Romance Dawn Booster Box (Wave 2 - White Bottom)", prices: [{ type: "raw", condition: "U", market: 1400 }] },
          ]),
        ),
      ),
    );
    const out = await scrydexPriceProvider.fetchSealedPrices(opSet("OP-01"));
    expect(out).toHaveLength(0);
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
