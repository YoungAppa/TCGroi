"use client";

import { useI18n } from "@/lib/i18n/context";
import { LOCALES, LOCALE_CODES } from "@/lib/i18n/strings";
import { useMoney } from "@/lib/money/context";
import { CURRENCIES, CURRENCY_CODES } from "@/lib/money/currencies";

/**
 * Site language and display currency, in the header so they apply everywhere.
 *
 * Both are presentation-only. Currency converts USD figures at the day's ECB
 * rate; ROI percentages are ratios and never change. Language translates the
 * site's own words and never the card data — see the i18n strings module.
 */
export function SitePreferences() {
  const { locale, setLocale, t } = useI18n();
  const { currency, setCurrency, ratesUnavailable } = useMoney();

  const selectClass =
    "rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground " +
    "transition-colors hover:border-accent/50 focus:border-accent focus:outline-none";

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="site-language">
        {t("col.language")}
      </label>
      <select
        id="site-language"
        aria-label={t("col.language")}
        className={selectClass}
        value={locale}
        onChange={(e) => setLocale(e.target.value as typeof locale)}
      >
        {LOCALE_CODES.map((code) => (
          <option key={code} value={code}>
            {LOCALES[code].native}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="site-currency">
        {t("col.currency")}
      </label>
      <select
        id="site-currency"
        aria-label={t("col.currency")}
        title={ratesUnavailable ? t("note.pricesUsd") : undefined}
        className={selectClass}
        value={currency}
        onChange={(e) => setCurrency(e.target.value as typeof currency)}
      >
        {CURRENCY_CODES.map((code) => (
          <option key={code} value={code}>
            {CURRENCIES[code].symbol} {code}
          </option>
        ))}
      </select>
    </div>
  );
}
