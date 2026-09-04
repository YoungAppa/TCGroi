"use client";

/* eslint-disable @next/next/no-img-element -- external card art domains are
   not configured for next/image; plain img matches the rest of the site. */

import Link from "next/link";
import { useMemo } from "react";

import { rarityLabel } from "@/lib/catalog/rarities";
import type { CardContext } from "@/lib/data";
import type { HistoryPoint } from "@/lib/data/cards";
import { PriceHistory } from "./PriceHistory";
import { median } from "@packroi/ev";
import { formatProbability } from "@packroi/ev/format";
import { useMoney } from "@/lib/money/context";

/**
 * The per-card page: the card, its prices, and — the reason the page exists —
 * every product whose packs can contain it, best odds first. A reader who
 * searches "Umbreon ex 161" leaves knowing exactly which boxes/packs/tins can
 * pull it and how likely each one is to.
 */
export function CardDetail({ ctx, history = [] }: { ctx: CardContext; history?: HistoryPoint[] }) {
  const { money } = useMoney();
  const { card } = ctx;

  const raw = useMemo(() => median(Object.values(card.raw)), [card]);
  const psa10 = useMemo(() => median(Object.values(card.psa10 ?? {})), [card]);
  const psa9 = useMemo(() => median(Object.values(card.psa9 ?? {})), [card]);
  const gemRate =
    card.population && card.population.total >= 50
      ? card.population.gemCount / card.population.total
      : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(260px,340px)_1fr]">
        {/* ---- the card, its price, and its history ---- */}
        <div className="space-y-4">
          <div className="flex items-start justify-center rounded-2xl border border-border bg-surface p-5">
            {card.imageUrl ? (
              <img
                src={card.imageUrl}
                alt={`${card.name} #${card.number}`}
                className="w-full max-w-[320px] rounded-xl shadow-[0_24px_60px_rgba(0,0,0,.55)]"
              />
            ) : (
              <div className="py-20 text-sm text-muted">No image available</div>
            )}
          </div>
          {raw !== null && (
            <div className="flex items-baseline justify-between rounded-xl border border-border bg-surface px-4 py-3">
              <span className="text-xs uppercase tracking-wide text-muted">Current price</span>
              <span className="tabular font-display text-2xl font-extrabold">{money(raw)}</span>
            </div>
          )}
          <PriceHistory data={history} />
        </div>

        <div className="space-y-4">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              {card.name} <span className="text-muted">#{card.number}</span>
            </h1>
            {ctx.nameEn && ctx.nameEn !== card.name && (
              <p className="mt-0.5 text-base font-medium text-muted">{ctx.nameEn}</p>
            )}
            <p className="mt-1 text-sm text-muted">
              {ctx.setName} · {rarityLabel(card.rarity)}
            </p>
          </div>

          {/* ---- prices ---- */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="text-xs uppercase tracking-wide text-muted">Raw (market)</div>
              <div className="tabular mt-1 text-xl font-semibold">
                {raw !== null ? money(raw) : "—"}
              </div>
            </div>
            {psa10 !== null && (
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="text-xs uppercase tracking-wide text-muted">PSA 10</div>
                <div className="tabular mt-1 text-xl font-semibold">{money(psa10)}</div>
                {gemRate !== null && (
                  <div className="mt-1 text-[11px] text-muted">
                    gems {formatProbability(gemRate)} of {card.population!.total.toLocaleString()}{" "}
                    graded
                  </div>
                )}
              </div>
            )}
            {psa9 !== null && (
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="text-xs uppercase tracking-wide text-muted">PSA 9</div>
                <div className="tabular mt-1 text-xl font-semibold">{money(psa9)}</div>
              </div>
            )}
          </div>

          {/* ---- where to pull it ---- */}
          {ctx.sources.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted sm:p-5">
              <h2 className="text-lg font-semibold text-foreground">Where to pull it</h2>
              <p className="mt-2">
                No {ctx.setName} sealed product is ranked yet — no source publishes
                usable pull rates for this set, and this site doesn&apos;t invent
                odds. The card&apos;s price above is live regardless.
              </p>
            </div>
          ) : (
          <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="text-lg font-semibold">Where to pull it</h2>
            <p className="mt-1 text-xs text-muted">
              Every ranked product whose packs can contain this exact card, best odds
              first. Odds assume uniform pull rates within the card&apos;s rarity tier —
              real sets short-print their biggest chases, so read them as a ceiling.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="whitespace-nowrap border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="py-1.5 pr-3">Product</th>
                    <th className="tabular py-1.5 pr-3 text-right">Market</th>
                    <th className="tabular py-1.5 pr-3 text-right">Per pack</th>
                    <th className="tabular py-1.5 text-right">P(≥1) / product</th>
                  </tr>
                </thead>
                <tbody>
                  {ctx.sources.map((s) => (
                    <tr
                      key={`${s.setCode}-${s.productSlug}`}
                      className="border-b border-border/40 last:border-0"
                    >
                      <td className="py-2 pr-3">
                        <Link
                          href={`/${ctx.gameSlug}/${s.setCode}/${s.productSlug}`}
                          className="flex items-center gap-2 hover:text-accent"
                        >
                          {s.imageUrl && (
                            <img
                              src={s.imageUrl}
                              alt=""
                              loading="lazy"
                              className="h-8 w-12 shrink-0 object-contain"
                            />
                          )}
                          <span>
                            <span className="font-medium">{s.setName}</span>{" "}
                            <span className="text-muted">{s.productName}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="tabular py-2 pr-3 text-right">
                        {s.marketCents !== null ? money(s.marketCents) : "—"}
                      </td>
                      <td className="tabular py-2 pr-3 text-right">
                        {s.oneInPacks !== null ? `1 in ${Math.round(s.oneInPacks).toLocaleString()}` : "—"}
                      </td>
                      <td className="tabular py-2 text-right">
                        {s.probPerProduct !== null ? formatProbability(s.probPerProduct) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ctx.sources.every((s) => s.probPerProduct === null) && (
              <p className="mt-2 text-xs text-muted">
                This card sits below the chase bar (or its tier isn&apos;t in the pull
                table), so per-product odds aren&apos;t computed — the products above
                still contain its set&apos;s packs.
              </p>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
