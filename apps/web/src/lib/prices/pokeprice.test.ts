import { describe, expect, it } from "vitest";

import { fetchGradedForCard } from "./pokeprice";

/**
 * Regression armor for the graded-price matching + parsing. The failure modes
 * that matter: a wrong-number match putting a $1,500 slab on the wrong card,
 * and a sparse/garbage price sneaking through. The module verifies the returned
 * collector number and reports raw fields; the price-sanity floor lives in the
 * job, but everything the module promises is pinned here.
 */

interface FakeBody {
  data?: Array<{
    cardNumber?: string;
    prices?: { market?: number };
    ebay?: { salesByGrade?: Record<string, unknown> };
  }>;
}

function mockFetch(
  body: FakeBody,
  opts: { ok?: boolean; credits?: number } = {},
): typeof fetch {
  return (async () =>
    ({
      ok: opts.ok ?? true,
      headers: {
        get: (h: string) =>
          h.toLowerCase() === "x-api-calls-consumed" ? String(opts.credits ?? 2) : null,
      },
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;
}

const card = { name: "Charizard ex", number: "199", setName: "151" };

describe("fetchGradedForCard", () => {
  it("returns the smart PSA 10 / PSA 9 prices when the number matches", async () => {
    const r = await fetchGradedForCard(
      "tok",
      card,
      mockFetch({
        data: [
          {
            cardNumber: "199/165",
            prices: { market: 402.54 },
            ebay: {
              salesByGrade: {
                psa10: { smartMarketPrice: { price: 1472.5 } },
                psa9: { smartMarketPrice: { price: 410 } },
              },
            },
          },
        ],
      }),
    );
    expect(r.matched).toBe(true);
    expect(r.psa10Cents).toBe(147250);
    expect(r.psa9Cents).toBe(41000);
    expect(r.rawMarketCents).toBe(40254);
    expect(r.creditsUsed).toBe(2);
  });

  it("falls back to medianPrice when there is no smart price", async () => {
    const r = await fetchGradedForCard(
      "tok",
      card,
      mockFetch({
        data: [{ cardNumber: "199/165", ebay: { salesByGrade: { psa10: { medianPrice: 1500 } } } }],
      }),
    );
    expect(r.psa10Cents).toBe(150000);
  });

  it("refuses to trust a row whose collector number disagrees", async () => {
    // The search returned a DIFFERENT Charizard (#006, the Double Rare) — a
    // wrong match must yield no price, not a $1,500 slab on the wrong card.
    const r = await fetchGradedForCard(
      "tok",
      card,
      mockFetch({
        data: [{ cardNumber: "006/165", ebay: { salesByGrade: { psa10: { smartMarketPrice: { price: 1472.5 } } } } }],
      }),
    );
    expect(r.matched).toBe(false);
    expect(r.psa10Cents).toBeNull();
    expect(r.psa9Cents).toBeNull();
  });

  it("normalises collector numbers (slash suffix, leading zeros)", async () => {
    const r = await fetchGradedForCard(
      "tok",
      { name: "Pikachu", number: "5", setName: "Base" },
      mockFetch({ data: [{ cardNumber: "005/102", ebay: { salesByGrade: { psa10: { medianPrice: 50 } } } }] }),
    );
    expect(r.matched).toBe(true);
    expect(r.psa10Cents).toBe(5000);
  });

  it("returns unmatched on an empty result set", async () => {
    const r = await fetchGradedForCard("tok", card, mockFetch({ data: [] }));
    expect(r.matched).toBe(false);
    expect(r.psa10Cents).toBeNull();
  });

  it("treats a missing grade bucket as no price, not zero", async () => {
    const r = await fetchGradedForCard(
      "tok",
      card,
      mockFetch({ data: [{ cardNumber: "199/165", ebay: { salesByGrade: {} } }] }),
    );
    expect(r.matched).toBe(true);
    expect(r.psa10Cents).toBeNull();
  });

  it("ignores a zero/negative price rather than storing it", async () => {
    const r = await fetchGradedForCard(
      "tok",
      card,
      mockFetch({ data: [{ cardNumber: "199/165", ebay: { salesByGrade: { psa10: { smartMarketPrice: { price: 0 } } } } }] }),
    );
    expect(r.psa10Cents).toBeNull();
  });

  it("returns nothing on a non-OK response but still reports credits", async () => {
    const r = await fetchGradedForCard("tok", card, mockFetch({}, { ok: false, credits: 1 }));
    expect(r.matched).toBe(false);
    expect(r.psa10Cents).toBeNull();
    expect(r.creditsUsed).toBe(1);
  });
});
