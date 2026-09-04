"use client";

/* eslint-disable @next/next/no-img-element -- external card/set art domains
   are not configured for next/image yet; plain img is deliberate here. */

import Link from "next/link";
import { useMoney } from "@/lib/money/context";
import { useMemo, useState } from "react";

import { rarityDescription, rarityLabel } from "@/lib/catalog/rarities";
import { computeProduct, computeUnboxOdds } from "@/lib/data/compute";
import type { ProductPayload } from "@/lib/data/types";
import { blendPrices, median, packsForProbability } from "@packroi/ev";
import {formatOneIn, formatPerPackChance, formatProbability} from "@packroi/ev/format";
import { effectiveSources } from "@packroi/ev/url-state";
import { computeDisagreements } from "@/lib/pullrates/disagreement";
import { pullRateFileSchema } from "@/lib/pullrates/schema";

import { ConfidenceBadge, RoiCell } from "./badges";
import { GradingGuide } from "./GradingGuide";
import { SourceFilter } from "./SourceFilter";
import { useFilterState } from "./useFilterState";

/** Tier colours for the stacked EV bar. Indexed by slot order, not rarity. */
const BAR_COLORS = [
  "bg-amber-400",
  "bg-sky-400",
  "bg-emerald-400",
  "bg-violet-400",
  "bg-rose-400",
  "bg-teal-400",
  "bg-orange-400",
  "bg-indigo-400",
];

export function ProductDetail({
  payload,
  availableSources,
}: {
  payload: ProductPayload;
  availableSources: { id: string; displayName: string }[];
}) {
  const { money } = useMoney();
  const { state, setState, withFilter } = useFilterState();
  const availableIds = useMemo(() => availableSources.map((s) => s.id), [availableSources]);
  // The graded toggle is offered only when at least one EV-pool card actually
  // carries both PSA legs — otherwise the mode would be a no-op here.
  const gradedAvailable = useMemo(
    () => payload.cards.some((c) => c.psa9 && c.psa10),
    [payload.cards],
  );

  const { ev, roiRetail, roiMarket } = useMemo(
    () => computeProduct(payload, state, availableIds),
    [payload, state, availableIds],
  );
  const unboxOdds = useMemo(
    () => computeUnboxOdds(payload, state, availableIds, ev.productExtrasValueCents),
    [payload, state, availableIds, ev.productExtrasValueCents],
  );

  // "Bulk / regular cards" completeness row: the balance up to 100% after the
  // pull-rate hit tiers. Shown only where the hits genuinely don't cover the
  // pack (standard Pokémon leaves ~60-75% bulk). One Piece packs sum to ~97%
  // hit-odds — a different slot structure — so the complement there would
  // misread as "~3% bulk"; hidden until that structure gets its own treatment.
  const bulkOdds = Math.max(0, 1 - ev.tiers.reduce((s, t) => s + t.perPackProbability, 0));
  const showBulk = bulkOdds >= 0.15;

  const selectedSources = effectiveSources(state, availableIds);

  const disagreements = useMemo(() => {
    const parsed = pullRateFileSchema.safeParse({
      game: payload.gameSlug,
      setCode: payload.setCode,
      version: payload.pullRates.version,
      sampleSizePacks: payload.pullRates.sampleSizePacks,
      sourceUrl: payload.pullRates.sourceUrl,
      sourceNote: payload.pullRates.sourceNote,
      confidence: payload.pullRates.confidence,
      slots: payload.pullRates.slots,
      alternateEstimates: payload.pullRates.alternateEstimates,
      guaranteedSlots: payload.pullRates.guaranteedSlots,
    });
    return parsed.success ? computeDisagreements(parsed.data) : [];
  }, [payload]);

  const totalEv = ev.tiers.reduce((s, t) => s + t.evContributionCents, 0);

  // Card lookup across the WHOLE payload: a blended product's chase cards live
  // in its componentPacks' sets, not in the home set's card list — looking
  // only at payload.cards left every UPC chase card imageless.
  const cardById = useMemo(() => {
    const m = new Map<string, (typeof payload.cards)[number]>();
    for (const c of payload.cards) m.set(c.cardId, c);
    for (const cp of payload.componentPacks ?? []) for (const c of cp.cards) m.set(c.cardId, c);
    return m;
  }, [payload]);

  // Promo sidecar: guaranteed extras with their live prices.
  const promoRows = payload.promos.map((promo) => {
    const card = payload.cards.find((c) => c.cardId === promo.cardId);
    const price = card ? blendPrices(card.raw, selectedSources, state.blend) : null;
    return { ...promo, priceCents: price };
  });

  return (
    <div className="space-y-6">
      <SourceFilter
        available={availableSources}
        state={state}
        onChange={setState}
        gradedAvailable={gradedAvailable}
      />

      {/* Graded mode is deliberately withheld where the pull rate is a guess —
          graded tier values run ~16x raw, so they amplify rate error by the
          same factor (an XY-era box once read +81% purely from a guessed
          0.25/pack meeting four-figure PSA 10s). But a toggle that lights up
          and changes nothing reads as broken, so when the gate fires, SAY SO. */}
      {state.graded &&
        (payload.pullRates.confidence === "low" ||
          payload.pullRates.confidence === "placeholder") && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-muted">
            <span className="font-medium text-amber-400">
              Graded mode is not applied to this set.
            </span>{" "}
            Its pull rate is a {payload.pullRates.confidence}-confidence estimate, and graded
            valuation multiplies card values by an order of magnitude — applied to a guessed
            rate, that manufactures a verdict. The numbers below are raw-card EV; the
            &ldquo;Is it worth grading?&rdquo; table further down still shows per-card PSA 10
            prices and odds.
          </div>
        )}

      {/* ---- the split: EV once, the selected denominator(s) ---- */}
      <div
        className={`grid gap-3 ${
          state.showRetail && state.showMarket
            ? "lg:grid-cols-[1fr_1fr_1fr]"
            : "lg:grid-cols-[1fr_1fr]"
        }`}
      >
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Expected value</div>
          <div className="tabular mt-1 text-2xl font-semibold">
            {money(ev.evProductCents)}
          </div>
          <div className="mt-1 text-xs text-muted">
            {money(ev.evPackCents)} per pack × {payload.packsContained}
            {ev.productExtrasValueCents > 0 &&
              ` + ${money(ev.productExtrasValueCents)} guaranteed extras`}
          </div>
        </div>

        {state.showRetail && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="text-xs uppercase tracking-wide text-muted">Retail (MSRP)</div>
            <div className="tabular mt-1 flex items-baseline gap-3">
              <span className="text-2xl font-semibold">
                {payload.msrpCents !== null ? money(payload.msrpCents) : "—"}
              </span>
              <span className="text-xl">
                <RoiCell roi={roiRetail} />
              </span>
            </div>
            <div className="mt-1 text-xs text-muted">
              if you can find it at retail price
            </div>
          </div>
        )}

        {/* Current market is the honest verdict — tie it to the home hero with
            the same foil sheen + accent border so the two pages read as one. */}
        {state.showMarket && (
          <div className="relative overflow-hidden rounded-xl border border-accent/30 bg-surface p-4">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_150%_at_100%_0%,rgba(234,179,8,0.10),transparent_55%)]"
            />
            <div className="relative">
              <div className="text-xs uppercase tracking-wide text-muted">Current market</div>
              <div className="tabular mt-1 flex items-baseline gap-3">
                <span className="text-2xl font-semibold">
                  {payload.market.priceCents !== null
                    ? money(payload.market.priceCents)
                    : "—"}
                </span>
                <span className="text-xl">
                  <RoiCell roi={roiMarket} />
                </span>
              </div>
              <div className="mt-1 text-xs text-muted">
                {payload.market.priceCents === null
                  ? "no tracked market price yet"
                  : payload.market.isManual
                    ? `hand-tracked ${payload.market.asOf ?? ""} — ${payload.market.source ?? ""}`
                    : "live market price"}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ---- guaranteed promos sidecar ---- */}
      {promoRows.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-lg font-semibold">Guaranteed promo cards</h2>
          <p className="text-xs text-muted">
            Included in every copy of this product and counted in its EV as fixed
            value, at today&apos;s market price for the promo itself.
          </p>
          <div className="mt-3 flex flex-wrap gap-4">
            {promoRows.map((p) => (
              <div key={p.cardId} className="flex items-center gap-3">
                {p.imageUrl && (
                  <img
                    src={p.imageUrl}
                    alt={p.name}
                    loading="lazy"
                    className="h-40 w-auto rounded-lg object-contain"
                  />
                )}
                <div>
                  <div className="text-sm font-medium">
                    {p.name} <span className="text-muted">#{p.number}</span>
                  </div>
                  <div className="tabular text-lg">
                    {p.priceCents !== null ? money(p.priceCents) : "unpriced"}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {payload.contentsNote && (
            <p className="mt-3 text-xs text-amber-400/90">! {payload.contentsNote}</p>
          )}
        </section>
      )}

      {/* ---- EV breakdown ---- */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Where the value comes from</h2>

        {totalEv > 0 && (
          <div className="flex h-5 w-full overflow-hidden rounded bg-surface-raised">
            {ev.tiers.map((t, i) => {
              const pct = (t.evContributionCents / totalEv) * 100;
              if (pct < 0.5) return null;
              return (
                <div
                  key={t.rarity}
                  title={`${rarityLabel(t.rarity)}: ${money(t.evContributionCents)}/pack (${pct.toFixed(0)}%)`}
                  className={`${BAR_COLORS[i % BAR_COLORS.length]} h-full`}
                  style={{ width: `${pct}%` }}
                />
              );
            })}
          </div>
        )}

        <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm">
          <thead>
            <tr className="border-b border-border whitespace-nowrap text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-3">Tier</th>
              <th className="py-1.5 pr-3">Odds / pack</th>
              <th className="py-1.5 pr-3">Avg card value</th>
              <th className="py-1.5 pr-3">EV / pack</th>
              <th className="hidden py-1.5 pr-3 sm:table-cell">Priced</th>
              <th className="py-1.5">P(≥1) / product</th>
            </tr>
          </thead>
          <tbody>
            {ev.tiers.map((t, i) => (
              <tr key={t.rarity} className="border-b border-border/40 last:border-0">
                <td className="py-1.5 pr-3">
                  <span
                    className={`mr-2 inline-block h-2 w-2 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                  />
                  {rarityDescription(t.rarity) ? (
                    <span
                      className="cursor-help decoration-muted/50 decoration-dotted underline-offset-2 hover:underline"
                      title={rarityDescription(t.rarity)}
                    >
                      {rarityLabel(t.rarity)}
                    </span>
                  ) : (
                    rarityLabel(t.rarity)
                  )}
                </td>
                <td className="tabular py-1.5 pr-3">
                  {formatProbability(t.perPackProbability)}
                </td>
                <td className="tabular py-1.5 pr-3">{money(t.avgValueCents)}</td>
                <td className="tabular py-1.5 pr-3">{money(t.evContributionCents)}</td>
                <td className="tabular hidden py-1.5 pr-3 text-muted sm:table-cell">
                  {t.pricedCardCount}/{t.totalCardCount}
                </td>
                <td className="tabular py-1.5">
                  {formatProbability(ev.probAtLeastOne[t.rarity] ?? 0)}
                </td>
              </tr>
            ))}
            {showBulk && (
              <tr className="border-b border-border/40 text-muted last:border-0">
                <td className="py-1.5 pr-3">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-white/15" />
                  Bulk / regular cards
                </td>
                <td className="tabular py-1.5 pr-3">{formatProbability(bulkOdds)}</td>
                <td className="tabular py-1.5 pr-3">≈ $0.01</td>
                <td className="tabular py-1.5 pr-3">—</td>
                <td className="tabular hidden py-1.5 pr-3 sm:table-cell">—</td>
                <td className="tabular py-1.5">—</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>

        <p className="text-xs text-muted">
          Expected hits per product: {ev.expectedHits.toFixed(2)} (counting every
          tier the pull-rate table enumerates).
          {showBulk && (
            <>
              {" "}The{" "}
              <span className="text-foreground">Bulk / regular cards</span> row is
              the rest of a pack — commons, uncommons and plain rares worth about a
              cent — shown so the odds add up to the whole pack.
            </>
          )}
          {!showBulk && payload.gameSlug === "one-piece" && (
            <>
              {" "}A One Piece pack is 12 cards: on average about{" "}
              {(ev.expectedHits / payload.packsContained).toFixed(1)} is one of the
              cards above, and the other ~
              {Math.max(0, Math.round(12 - ev.expectedHits / payload.packsContained))}{" "}
              are commons, uncommons and rares worth about a cent. (These odds
              describe that one notable card, so they don&apos;t sum to 100%.)
            </>
          )}
        </p>
      </section>

      {/* ---- odds of profit ---- */}
      {unboxOdds && (unboxOdds.pMarket !== null || unboxOdds.pRetail !== null) && (
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <h2 className="text-lg font-semibold">What are the odds you profit?</h2>
          <p className="mt-1 text-xs text-muted">
            EV is the average; this is the distribution. {unboxOdds.trials.toLocaleString()}{" "}
            simulated openings of this exact product, using the same sources, odds and
            prices as everything above.
          </p>
          <div className="mt-4 flex flex-wrap items-stretch gap-6">
            {unboxOdds.pMarket !== null && (
              <div>
                <div className={`font-display text-3xl font-extrabold ${oddsColor(unboxOdds.pMarket)}`}>
                  {formatOdds(unboxOdds.pMarket, unboxOdds.trials)}
                </div>
                <div className="mt-1 text-xs uppercase tracking-wide text-muted">
                  beat today&apos;s market price
                </div>
              </div>
            )}
            {unboxOdds.pRetail !== null && (
              <div>
                <div className={`font-display text-3xl font-extrabold ${oddsColor(unboxOdds.pRetail)}`}>
                  {formatOdds(unboxOdds.pRetail, unboxOdds.trials)}
                </div>
                <div className="mt-1 text-xs uppercase tracking-wide text-muted">
                  beat retail (MSRP)
                </div>
              </div>
            )}
            <div className="border-l border-border pl-6">
              <div className="tabular text-lg font-semibold">{money(unboxOdds.medianCents)}</div>
              <div className="mt-1 text-xs uppercase tracking-wide text-muted">median opening</div>
            </div>
            <div>
              <div className="tabular text-lg font-semibold">{money(unboxOdds.p90Cents)}</div>
              <div className="mt-1 text-xs uppercase tracking-wide text-muted">
                luckiest 1 in 10 opens above
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs text-muted">
            Same assumptions as the EV: odds are uniform within each tier (real sets
            short-print their biggest chases, so true odds are usually a touch{" "}
            <em>worse</em>{" "}
            than this), cards sell at today&apos;s market price, and
            selling costs nothing. Read it as a ceiling, not a promise.
          </p>
        </section>
      )}

      {/* ---- chase gallery ---- */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Chase cards</h2>
          {ev.chase.length > 0 && (
            <span className="text-xs text-muted">
              {ev.chase.length} priced · biggest hits first
            </span>
          )}
        </div>
        {(() => {
          // One gallery: modelled chases (with odds) and special-treatment
          // printings (no published rate, so no odds and no EV contribution)
          // interleaved by value. The former separate section made the
          // treatments look like an afterthought; a single list with an
          // honest "not in EV" chip reads better and hides nothing.
          const mval = (raw: Record<string, number>) => {
            const v = Object.values(raw).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
            return v.length ? v[Math.floor((v.length - 1) / 2)]! : 0;
          };
          const merged = [
            ...ev.chase.map((c) => ({ kind: "chase" as const, c, value: c.valueCents })),
            ...(payload.displayCards ?? [])
              .map((d) => ({ kind: "display" as const, d, value: mval(d.raw) }))
              .filter((x) => x.value > 0 || (x.d.imageUrl && (payload.displayCards?.length ?? 0) <= 40)),
          ].sort((a, b) => b.value - a.value).slice(0, 80);
          if (merged.length === 0) return <p className="text-sm text-muted">No priced chase cards.</p>;
          return (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {merged.map((entry) => {
              if (entry.kind === "display") {
                const d = entry.d;
                return (
                  <Link
                    key={`disp-${d.cardId}`}
                    href={`/${payload.gameSlug}/${payload.setCode}/card/${encodeURIComponent(d.number)}`}
                    className="group flex flex-col overflow-hidden rounded-xl bg-surface ring-1 ring-white/5 transition hover:shadow-lg hover:shadow-black/30 hover:ring-accent/50"
                  >
                    <div className="relative aspect-[5/7] w-full overflow-hidden bg-surface-raised">
                      {d.imageUrl ? (
                        <img src={d.imageUrl} alt={d.name} loading="lazy" className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.04]" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-muted">no image</div>
                      )}
                      {entry.value > 0 && (
                        <span className="tabular absolute right-1.5 top-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-sm font-semibold text-emerald-300 shadow-sm backdrop-blur-sm">
                          {money(entry.value)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1 p-2.5">
                      <div className="truncate text-sm font-medium" title={`${d.name} #${d.number}`}>
                        {d.name} <span className="text-muted">#{d.number}</span>
                      </div>
                      <div className="text-xs text-muted">{rarityLabel(d.rarity)}</div>
                      <div className="mt-auto pt-1.5">
                        <span
                          className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted"
                          title="No source publishes a pull rate for this printing, so it carries no odds and adds nothing to EV — the value shown is what the card sells for."
                        >
                          no published rate · not in EV
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              }
              const c = entry.c;
              const img = cardById.get(c.cardId)?.imageUrl;
              // A blended product's chase cards belong to its COMPONENT sets,
              // so each link must carry the card's own set code.
              const ownSet =
                payload.componentPacks?.find((cp) =>
                  cp.cards.some((cd) => cd.cardId === c.cardId),
                )?.setCode ?? payload.setCode;
              return (
                <Link
                  key={c.cardId}
                  href={`/${payload.gameSlug}/${ownSet}/card/${encodeURIComponent(c.number)}`}
                  className="group flex flex-col overflow-hidden rounded-xl bg-surface ring-1 ring-white/5 transition hover:shadow-lg hover:shadow-black/30 hover:ring-accent/50"
                >
                  <div className="relative aspect-[5/7] w-full overflow-hidden bg-surface-raised">
                    {img ? (
                      <img
                        src={img}
                        alt={c.name}
                        loading="lazy"
                        className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted">
                        no image
                      </div>
                    )}
                    <span className="tabular absolute right-1.5 top-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-sm font-semibold text-emerald-300 shadow-sm backdrop-blur-sm">
                      {money(c.valueCents)}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-2.5">
                    <div
                      className="truncate text-sm font-medium"
                      title={`${c.name} #${c.number}`}
                    >
                      {c.name} <span className="text-muted">#{c.number}</span>
                    </div>
                    <div className="text-xs text-muted">{rarityLabel(c.rarity)}</div>
                    <div className="mt-auto flex items-center justify-between gap-1 pt-1.5 text-xs">
                      <span className="tabular text-muted">{formatOneIn(c.oneInPacks)}</span>
                      <span
                        className="tabular rounded bg-surface-raised px-1.5 py-0.5 font-medium"
                        title="Chance of pulling this exact card from a single pack"
                      >
                        {formatPerPackChance(c.perPackProbability)}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
          );
        })()}
        <p className="text-xs text-muted">
          Each tile: card value (top-right), then the odds of pulling{" "}
          <em>that exact card</em> from a single pack — shown as &ldquo;1 in N
          packs&rdquo; and as a percentage (the same number, two ways). Per-card
          odds assume every card in a tier is equally likely — no public data
          quantifies short prints. See{" "}
          <Link href={withFilter("/methodology")} className="underline">
            methodology
          </Link>
          .
        </p>
      </section>


      {/* ---- grading break-even ---- */}
      <GradingGuide
        chase={ev.chase}
        promos={promoRows
          .filter((p) => p.priceCents !== null)
          .map((p) => {
            const card = payload.cards.find((c) => c.cardId === p.cardId);
            return {
              cardId: p.cardId,
              name: p.name,
              number: p.number,
              valueCents: p.priceCents!,
              // Graded price is its own market, like the chase table's.
              psa10Cents: median(Object.values(card?.psa10 ?? {})),
              gemRate:
                card?.population && card.population.total >= 50
                  ? card.population.gemCount / card.population.total
                  : null,
              populationTotal: card?.population?.total ?? null,
            };
          })}
      />

      {/* ---- packs-needed calculator ---- */}
      <PacksCalculator ev={ev} roiMarket={roiMarket} />

      {/* ---- data provenance ---- */}
      <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Pull-rate data</h2>
          <ConfidenceBadge
            confidence={payload.pullRates.confidence}
            sampleSizePacks={payload.pullRates.sampleSizePacks}
          />
          <a
            href={payload.pullRates.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent underline"
          >
            source ↗
          </a>
        </div>
        <p className="text-xs leading-relaxed text-muted">{payload.pullRates.sourceNote}</p>

        {disagreements.length > 0 && (
          <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3">
            <h3 className="text-sm font-semibold text-amber-400">Sources disagree</h3>
            <ul className="mt-1 space-y-1 text-xs text-muted">
              {disagreements.map((d) => (
                <li key={d.rarity}>
                  <span className="text-foreground">{rarityLabel(d.rarity)}:</span> we use{" "}
                  {formatOneIn(1 / d.primaryProbability)}
                  {d.alternates.map((a, i) => (
                    <span key={i}>
                      {" "}
                      · <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                        {formatOneIn(1 / a.probability)}
                      </a>{" "}
                      ({a.sampleSizePacks ? `${a.sampleSizePacks} packs` : "n undisclosed"},{" "}
                      {(a.relativeDifference * 100).toFixed(0)}% apart)
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-muted">
              We show the spread rather than pretending the community agrees.
            </p>
          </div>
        )}

        {ev.warnings.length > 0 && (
          <ul className="space-y-0.5 text-xs text-amber-400/90">
            {ev.warnings.map((w, i) => (
              <li key={i}>! {w}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PacksCalculator({
  ev,
  roiMarket,
}: {
  ev: ReturnType<typeof computeProduct>["ev"];
  roiMarket: number | null;
}) {
  const { money } = useMoney();
  const [cardId, setCardId] = useState(ev.chase[0]?.cardId ?? "");
  const card = ev.chase.find((c) => c.cardId === cardId) ?? ev.chase[0];
  if (!card) return null;

  const p50 = packsForProbability(card.perPackProbability, 0.5);
  const p90 = packsForProbability(card.perPackProbability, 0.9);

  return (
    <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
      <h2 className="text-lg font-semibold">How many packs for…</h2>
      <select
        value={card.cardId}
        onChange={(e) => setCardId(e.target.value)}
        className="w-full max-w-sm rounded-md bg-surface-raised px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
      >
        {ev.chase.map((c) => (
          <option key={c.cardId} value={c.cardId}>
            {c.name} #{c.number} ({money(c.valueCents)})
          </option>
        ))}
      </select>
      <div className="flex gap-6 text-sm">
        <div>
          <span className="tabular text-xl font-semibold">
            {Number.isFinite(p50) ? p50.toLocaleString("en-US") : "∞"}
          </span>{" "}
          <span className="text-muted">packs for a 50% chance</span>
        </div>
        <div>
          <span className="tabular text-xl font-semibold">
            {Number.isFinite(p90) ? p90.toLocaleString("en-US") : "∞"}
          </span>{" "}
          <span className="text-muted">packs for a 90% chance</span>
        </div>
      </div>
      <p className="text-xs text-muted">
        No number of packs guarantees it{roiMarket !== null && roiMarket < 0
          ? ` — that is what a ${(roiMarket * 100).toFixed(1)}% market ROI pays for`
          : ""}.
      </p>
    </section>
  );
}

/** "31.4%", clamped honestly at the simulator's resolution. */
function formatOdds(p: number, trials: number): string {
  if (p <= 0) return `< 1 in ${trials.toLocaleString()}`;
  if (p < 0.001) return "< 0.1%";
  if (p > 0.995 && p < 1) return "> 99.5%";
  return `${(p * 100).toFixed(1)}%`;
}

/** Same green->red ramp the ROI pills use, keyed to how often you'd win. */
function oddsColor(p: number): string {
  if (p >= 0.5) return "text-roi-pos";
  if (p >= 0.25) return "text-amber-400";
  if (p >= 0.05) return "text-orange-400";
  return "text-roi-neg";
}
