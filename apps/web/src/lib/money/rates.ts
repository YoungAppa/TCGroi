import { CURRENCY_CODES, type FxRates } from "./currencies";

/**
 * Daily FX rates, fetched server-side.
 *
 * Frankfurter serves European Central Bank reference rates: free, no key, no
 * attribution requirement, and updated once each working day — which is the
 * right cadence for a display conversion. Fetching on the server keeps the
 * page's CSP clean and means the browser never makes a third-party request.
 *
 * Failure is not an error state: an empty rate table makes every price render
 * in USD, which is what the numbers actually are. A currency selector that
 * silently shows unconverted figures under the wrong symbol would be far
 * worse, so formatMoney falls back to the dollar sign too.
 */
const ENDPOINT = "https://api.frankfurter.app/latest";

export async function fetchFxRates(): Promise<FxRates> {
  const symbols = CURRENCY_CODES.filter((c) => c !== "USD").join(",");
  try {
    const res = await fetch(`${ENDPOINT}?from=USD&to=${symbols}`, {
      // Rates move once a working day; revalidate every 12 hours.
      next: { revalidate: 43_200 },
    });
    if (!res.ok) return {};
    const body: unknown = await res.json();
    const rates = (body as { rates?: Record<string, unknown> }).rates;
    if (!rates || typeof rates !== "object") return {};

    const out: FxRates = {};
    for (const [code, value] of Object.entries(rates)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        out[code] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}
