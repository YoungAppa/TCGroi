"use client";

/* eslint-disable @next/next/no-img-element -- external card art domains are
   not configured for next/image; plain img is deliberate here. */

import { useI18n } from "@/lib/i18n/context";
import { useMoney } from "@/lib/money/context";

/** One card in the fanned stack. */
export interface HeroCard {
  cardId: string;
  name: string;
  imageUrl: string;
  valueCents: number;
  /** Packs you'd expect to open per copy, from this card's tier odds. */
  oneInPacks: number | null;
}

/**
 * The rankings hero: the site's thesis in one screen.
 *
 * The pitch is the tension, not the numbers — the art is genuinely beautiful
 * and the maths is genuinely brutal, and a reader who only ever sees a table
 * of red percentages never feels the first half. So the hero leads with the
 * REAL top chase cards for the most-chased set we rank, fanned like a fresh
 * pull, and puts the odds against them right there.
 *
 * Everything here is data, never decoration: the cards, their prices, and the
 * "1 in N packs" all come from the same computation that drives the rankings
 * below. If we can't source the odds for the lead card, the tag is dropped
 * rather than invented.
 */
export function RankingsHero({
  cards,
  productCount,
  losingCount,
  cardCount,
}: {
  cards: HeroCard[];
  productCount: number;
  losingCount: number;
  cardCount: number;
}) {
  const { t } = useI18n();
  const { money } = useMoney();
  const lead = cards[0];

  // Rotations/offsets for the fan. Index 0 sits on top and centre-right; the
  // others fall behind it, dimmed, so the eye lands on the lead card.
  const FAN = [
    { cls: "left-[28%] top-0 z-30 rotate-[7deg]", dim: "" },
    { cls: "left-[4%] top-[9%] z-20 -rotate-[7deg]", dim: "brightness-[.85]" },
    { cls: "left-[52%] top-[15%] z-10 rotate-[16deg]", dim: "brightness-[.7]" },
  ];

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-surface/40">
      {/* Ambient foil light. Pointer-events-none so it never eats a click. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 55% at 68% 40%, rgba(120,80,255,.22), transparent 65%)," +
            "radial-gradient(45% 45% at 85% 60%, rgba(255,95,168,.14), transparent 70%)," +
            "radial-gradient(40% 40% at 55% 20%, rgba(89,243,255,.12), transparent 70%)",
        }}
      />

      <div className="relative grid items-center gap-8 p-6 sm:p-8 lg:grid-cols-[1.15fr_.85fr] lg:gap-10">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[.22em] text-muted sm:text-[11px]">
            {cardCount.toLocaleString()} {t("hero.kicker.cards")} · {productCount}{" "}
            {t("hero.kicker.products")} · <span className="holo-text">{t("hero.kicker.odds")}</span>
          </div>

          <h1 className="mt-4 font-display text-3xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-4xl lg:text-5xl">
            {t("hero.headline.a")} <span className="holo-text">{t("hero.headline.b")}</span>
            <br />
            {t("hero.headline.c")}
          </h1>

          <p className="mt-4 max-w-xl text-sm text-muted sm:text-base">
            {lead && lead.oneInPacks !== null ? (
              <>
                {t("hero.body.lead")}{" "}
                <span className="font-semibold text-roi-neg">
                  {t("hero.body.oneIn")} {formatPacks(lead.oneInPacks)} {t("hero.body.packs")}
                </span>
                . {t("hero.body.rest")}
              </>
            ) : (
              t("hero.body.rest")
            )}
          </p>

          <p className="mt-4 text-sm text-muted">
            <span className="font-display text-lg font-bold text-foreground">
              {losingCount} {t("hero.stat.of")} {productCount}
            </span>{" "}
            {t("hero.stat.lose")}
          </p>
        </div>

        {/* The fan. Hidden below sm: three overlapping cards at 375px is a
            smear, and the headline carries the page on its own there. */}
        {cards.length > 0 && (
          <div className="relative hidden h-[300px] sm:block lg:h-[340px]">
            {cards.slice(0, 3).map((c, i) => (
              <img
                key={c.cardId}
                src={c.imageUrl}
                alt={i === 0 ? c.name : ""}
                className={`absolute w-[46%] rounded-xl shadow-[0_24px_60px_rgba(0,0,0,.65)] ring-1 ring-white/[.07] ${FAN[i]!.cls} ${FAN[i]!.dim}`}
              />
            ))}
            {lead && (
              <div className="absolute bottom-1 left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-surface-raised px-4 py-2 text-[11px] font-semibold shadow-[0_10px_26px_rgba(0,0,0,.5)]">
                <span className="text-foreground">{lead.name}</span>
                <span className="text-muted"> · </span>
                <span className="tabular text-foreground">{money(lead.valueCents)}</span>
                {lead.oneInPacks !== null && (
                  <>
                    <span className="text-muted"> · </span>
                    <span className="holo-text">
                      {t("hero.body.oneIn")} {formatPacks(lead.oneInPacks)}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * "1 in N packs" rounded to a figure a reader can hold in their head.
 *
 * Deliberately coarse: the underlying rate is a community estimate with real
 * error, so printing "1 in 1,973" would claim a precision the evidence does
 * not support. Rounding to two significant figures keeps the claim honest.
 */
function formatPacks(n: number): string {
  if (n < 10) return String(Math.round(n));
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return `~${(Math.round(n / mag) * mag).toLocaleString()}`;
}
