import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogSet } from "@/lib/catalog/types";
import { resetEnvCache } from "@/lib/env";

import type { PriceableCard } from "../types";
import { scrydexPriceProvider } from "./scrydex-prices";

function respond(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** One Scrydex card page containing a single card. */
function page(card: unknown) {
  return respond({ data: [card], page: 1, page_size: 100, total_count: 1 });
}

function pkSet(): CatalogSet {
  return {
    code: "base1",
    name: "Base",
    releaseDate: null,
    language: "EN",
    expectedCardCount: null,
    externalIds: { pokemontcg_io: "base1" },
  };
}

function card(externalId: string, rawCents: number | null): PriceableCard {
  return {
    cardId: "row-1",
    name: "Charizard",
    number: "4",
    rarity: "hyper_rare",
    treatment: "base",
    externalIds: { pokemontcg_io: externalId },
    rawCents,
  };
}

const raw = (market: number) => ({ type: "raw", condition: "NM", market, currency: "USD" });
const graded = (grade: string, market: number, extra: Record<string, unknown> = {}) => ({
  type: "graded",
  company: "PSA",
  grade,
  market,
  currency: "USD",
  is_perfect: false,
  is_signed: false,
  is_error: false,
  ...extra,
});

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://t:t@localhost:5432/t";
  process.env.ADMIN_SECRET = "test-secret";
  process.env.TCGPLAYER_MIRROR_API_KEY = "k";
  process.env.SCRYDEX_TEAM_ID = "team";
  resetEnvCache();
});
afterEach(() => {
  delete process.env.TCGPLAYER_MIRROR_API_KEY;
  delete process.env.SCRYDEX_TEAM_ID;
  resetEnvCache();
  vi.unstubAllGlobals();
});

describe("scrydexPriceProvider.fetchGradedPrices", () => {
  /**
   * Scrydex lists each PRINTING of a card as its own variant with its own
   * graded prices; our catalog has ONE row. Emitting every variant let a
   * $414,330 1st-Edition PSA 10 land on the Unlimited Charizard row.
   */
  it("picks the printing matching our raw price, not the priciest one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        page({
          id: "base1-4",
          name: "Charizard",
          variants: [
            { name: "firstEditionShadowlessHolofoil", prices: [raw(240), graded("10", 414330), graded("9", 90000)] },
            { name: "unlimitedHolofoil", prices: [raw(855.52), graded("10", 14289), graded("9", 4075)] },
          ],
        }),
      ),
    );

    // Our stored raw ($852.43) is the Unlimited printing.
    const out = await scrydexPriceProvider.fetchGradedPrices(pkSet(), [card("base1-4", 85243)]);

    expect(out).toHaveLength(2); // exactly one psa10 + one psa9, never one per variant
    const psa10 = out.find((r) => r.kind === "psa10")!;
    expect(psa10.priceCents).toBe(1428900);
    expect(psa10.sourceId).toBe("scrydex_graded");
    expect(out.find((r) => r.kind === "psa9")!.priceCents).toBe(407500);
  });

  it("refuses to guess a printing when several are graded and we hold no raw price", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        page({
          id: "base1-4",
          name: "Charizard",
          variants: [
            { name: "firstEditionShadowlessHolofoil", prices: [raw(240), graded("10", 414330), graded("9", 90000)] },
            { name: "unlimitedHolofoil", prices: [raw(855.52), graded("10", 14289), graded("9", 4075)] },
          ],
        }),
      ),
    );

    const out = await scrydexPriceProvider.fetchGradedPrices(pkSet(), [card("base1-4", null)]);
    expect(out).toEqual([]);
  });

  /**
   * Low-population cards carry asking prices, not sales: a PSA 10 detached
   * from its own PSA 9 (Giratina LV.X at $29,890 vs a $1,017 PSA 9) would
   * otherwise manufacture grading upside out of one listing.
   */
  it("drops a PSA 10 that dwarfs its own PSA 9, keeping the PSA 9", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        page({
          id: "base1-4",
          name: "Charizard",
          variants: [{ name: "holofoil", prices: [raw(112), graded("10", 29890), graded("9", 1017)] }],
        }),
      ),
    );

    const out = await scrydexPriceProvider.fetchGradedPrices(pkSet(), [card("base1-4", 11200)]);
    expect(out.map((r) => r.kind)).toEqual(["psa9"]);
  });

  it("keeps a PSA 10 within the plausible multiple of its PSA 9", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        page({
          id: "base1-4",
          name: "Charizard",
          variants: [{ name: "holofoil", prices: [raw(852), graded("10", 14289), graded("9", 4075)] }],
        }),
      ),
    );

    const out = await scrydexPriceProvider.fetchGradedPrices(pkSet(), [card("base1-4", 85200)]);
    expect(out.map((r) => r.kind).sort()).toEqual(["psa10", "psa9"]);
  });

  it("ignores signed, error and non-USD entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        page({
          id: "base1-4",
          name: "Charizard",
          variants: [
            {
              name: "holofoil",
              prices: [
                raw(852),
                graded("10", 99999, { is_signed: true }),
                graded("10", 88888, { is_error: true }),
                graded("10", 500000, { currency: "JPY" }),
                graded("10", 14289),
                graded("9", 4075),
              ],
            },
          ],
        }),
      ),
    );

    const out = await scrydexPriceProvider.fetchGradedPrices(pkSet(), [card("base1-4", 85200)]);
    expect(out.find((r) => r.kind === "psa10")!.priceCents).toBe(1428900);
  });

  it("returns nothing for a non-English set rather than matching an English expansion", async () => {
    const fetchMock = vi.fn(async () => page({ id: "x", variants: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const jp: CatalogSet = { ...pkSet(), code: "SV3", language: "JP", externalIds: {} };
    const out = await scrydexPriceProvider.fetchGradedPrices(jp, [card("SV3-1", 5000)]);

    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
