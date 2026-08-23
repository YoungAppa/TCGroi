/**
 * Display currencies.
 *
 * Every price in the database is USD cents — that is the unit the sources
 * quote and the unit the EV engine computes in. Currency is a DISPLAY concern
 * only: nothing is ever stored converted, so a stale or missing FX rate can
 * never corrupt a stored price or an ROI. ROI is a ratio and is identical in
 * every currency, which is why it is never converted.
 */

export const CURRENCIES = {
  USD: { symbol: "$", label: "US Dollar", locale: "en-US" },
  EUR: { symbol: "€", label: "Euro", locale: "de-DE" },
  GBP: { symbol: "£", label: "British Pound", locale: "en-GB" },
  JPY: { symbol: "¥", label: "Japanese Yen", locale: "ja-JP" },
  CAD: { symbol: "CA$", label: "Canadian Dollar", locale: "en-CA" },
  AUD: { symbol: "A$", label: "Australian Dollar", locale: "en-AU" },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrencyCode(v: string | null | undefined): v is CurrencyCode {
  return v !== null && v !== undefined && v in CURRENCIES;
}

/** USD per 1 unit of each currency, keyed by code. USD is always exactly 1. */
export type FxRates = Record<string, number>;

/**
 * Format USD cents in `code`, given `rates` (units of `code` per 1 USD).
 *
 * Yen has no minor unit, so it is shown whole — "¥3,600", not "¥3,600.00".
 * A missing rate falls back to USD rather than inventing a conversion.
 */
export function formatMoney(
  usdCents: number,
  code: CurrencyCode,
  rates: FxRates,
): string {
  const rate = code === "USD" ? 1 : rates[code];
  if (!rate || !Number.isFinite(rate)) {
    return `$${(Math.round(usdCents) / 100).toFixed(2)}`;
  }
  const meta = CURRENCIES[code];
  const value = (usdCents / 100) * rate;
  const fractionDigits = code === "JPY" ? 0 : 2;
  return `${meta.symbol}${value.toLocaleString(meta.locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}
