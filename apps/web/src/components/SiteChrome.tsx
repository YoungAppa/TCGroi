"use client";

import Link from "next/link";

import { useI18n } from "@/lib/i18n/context";
import { useMoney } from "@/lib/money/context";

import { SitePreferences } from "./SitePreferences";

/**
 * The translated parts of the page frame.
 *
 * Split out of layout.tsx because translation needs client state, while the
 * layout itself stays a server component (it owns metadata and the font
 * setup). The brand mark is deliberately NOT translated — "WhatsThatROI" is a name.
 */
export function SiteNav() {
  const { t } = useI18n();

  const link = "-my-2 inline-flex items-center px-2 py-2 hover:text-foreground";

  return (
    <>
      <div className="order-2 flex items-center gap-1 text-sm text-muted sm:order-none sm:gap-2">
        <Link href="/" className={link}>
          {t("nav.rankings")}
        </Link>
        <Link href="/collection" className={link}>
          {t("nav.collection")}
        </Link>
        <Link href="/methodology" className={link}>
          {t("nav.methodology")}
        </Link>
      </div>
      {/* ml-auto only once there is room for it; on a phone the preferences sit
          on their own line instead of being pushed past the right edge. */}
      <div className="order-1 ml-auto sm:order-none">
        <SitePreferences />
      </div>
    </>
  );
}

/** The sitewide honesty note — the one line that must ride on every page. */
export function SiteBanner() {
  const { t } = useI18n();
  const { ratesUnavailable, currency } = useMoney();

  return (
    <div className="border-b border-border bg-surface-raised">
      <p className="mx-auto max-w-7xl px-4 py-2 text-xs text-muted">
        {t("disclaimer.banner")}
        {ratesUnavailable && currency !== "USD" && (
          <span className="ml-2 text-amber-400">{t("note.pricesUsd")}</span>
        )}
      </p>
    </div>
  );
}

/** The legal/attribution footer. Provider names are proper nouns, untranslated. */
export function SiteFooter() {
  const { t } = useI18n();

  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-7xl space-y-1 px-4 py-4 text-xs text-muted">
        <p>
          Card and price data via the{" "}
          <a
            href="https://pokemontcg.io"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            pokemontcg.io
          </a>{" "}
          API, Scrydex, PriceCharting, and PokemonPriceTracker. Not endorsed by
          or affiliated with any of them, nor with TCGplayer, eBay, PSA, The
          Pokémon Company, or Bandai. Exchange rates from the European Central
          Bank via Frankfurter.
        </p>
        <p>{t("note.cardNames")}</p>
        <p>
          {t("footer.notAdvice")}{" "}
          <Link href="/methodology" className="underline">
            {t("footer.methodology")}
          </Link>
          .
        </p>
      </div>
    </footer>
  );
}
