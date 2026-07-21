/**
 * PokemonPriceTracker — graded (PSA 10 / PSA 9) sale prices, from eBay sold
 * listings. Its reason to exist here is the one thing the PriceCharting tier we
 * use cannot give: what a slab actually sells for.
 *
 * Pokémon only, and credit-metered (the free tier is 100 credits/day, ~2 per
 * card with graded data), so this is NOT wired into the main price refresh —
 * a dedicated budget-aware job (scripts/refresh-graded.ts) calls it for the
 * cards actually worth grading and caches the result.
 *
 * Matching: our cards carry only a pokemontcg.io id, which does not map cleanly
 * to this provider's ids, so we search by "name number setName" and VERIFY the
 * returned collector number before trusting the row — a wrong match would put a
 * $1,500 PSA 10 on the wrong card.
 */
const BASE = "https://www.pokemonpricetracker.com/api/v2";

export const POKEPRICE_SOURCE_ID = "pokeprice_graded";

export interface GradedResult {
  /** Best PSA 10 sale price in cents, or null if none/unmatched. */
  psa10Cents: number | null;
  /** Best PSA 9 sale price in cents, or null. */
  psa9Cents: number | null;
  /** True when the returned collector number matched what we asked for. */
  matched: boolean;
  /** Credits the API reported spending on this call. */
  creditsUsed: number;
  /** Raw market (ungraded) price the provider returned, for a sanity check. */
  rawMarketCents: number | null;
}

interface GradeBucket {
  smartMarketPrice?: { price?: number; confidence?: string };
  medianPrice?: number;
  count?: number;
}

/** Leading collector number, normalised for comparison ("199/165" -> "199"). */
function normNumber(n: string): string {
  return (n || "").split("/")[0]!.trim().toLowerCase().replace(/^0+(?=\d)/, "");
}

/** Best single price for a grade bucket: the provider's weighted "smart" price,
 * falling back to the median of recent sales. Dollars -> cents. */
function bucketCents(b: GradeBucket | undefined): number | null {
  const dollars = b?.smartMarketPrice?.price ?? b?.medianPrice;
  if (typeof dollars !== "number" || !Number.isFinite(dollars) || dollars <= 0) return null;
  return Math.round(dollars * 100);
}

/**
 * Look up one card's graded prices. Returns matched:false (and null prices)
 * when the search finds nothing or the collector number disagrees — the caller
 * skips those rather than store a guess.
 */
export async function fetchGradedForCard(
  token: string,
  card: { name: string; number: string; setName: string },
  fetchImpl: typeof fetch = fetch,
): Promise<GradedResult> {
  const query = `${card.name} ${card.number} ${card.setName}`.trim();
  const url = `${BASE}/cards?search=${encodeURIComponent(query)}&limit=1&includeEbay=true`;

  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const creditsUsed = Number(res.headers.get("x-api-calls-consumed") ?? 0);
  if (!res.ok) {
    return { psa10Cents: null, psa9Cents: null, matched: false, creditsUsed, rawMarketCents: null };
  }

  const body = (await res.json()) as {
    data?: Array<{
      cardNumber?: string;
      prices?: { market?: number };
      ebay?: { salesByGrade?: Record<string, GradeBucket> };
    }>;
  };
  const hit = body.data?.[0];
  if (!hit) {
    return { psa10Cents: null, psa9Cents: null, matched: false, creditsUsed, rawMarketCents: null };
  }

  const matched = normNumber(hit.cardNumber ?? "") === normNumber(card.number);
  const grades = hit.ebay?.salesByGrade ?? {};
  const rawMarket = hit.prices?.market;
  return {
    psa10Cents: matched ? bucketCents(grades.psa10) : null,
    psa9Cents: matched ? bucketCents(grades.psa9) : null,
    matched,
    creditsUsed,
    rawMarketCents:
      typeof rawMarket === "number" && rawMarket > 0 ? Math.round(rawMarket * 100) : null,
  };
}
