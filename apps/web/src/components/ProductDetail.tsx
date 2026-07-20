"use client";

/* eslint-disable @next/next/no-img-element -- external card/set art domains
   are not configured for next/image yet; plain img is deliberate here. */

import Link from "next/link";
import { useMemo, useState } from "react";

import { rarityLabel } from "@/lib/catalog/rarities";
import { computeProduct } from "@/lib/data/compute";
import type { ProductPayload } from "@/lib/data/types";
import { blendPrices, packsForProbability } from "@packroi/ev";
import {
  formatCents,
  formatOneIn,
  formatProbability,
} from "@packroi/ev/format";
import { effectiveSources } from "@packroi/ev/url-state";
import { computeDisagreements } from "@/lib/pullrates/disagreement";
import { pullRateFileSchema } from "@/lib/pullrates/schema";

import { ConfidenceBadge, RoiCell } from "./badges";
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
  const { state, setState, withFilter } = useFilterState();
  const availableIds = useMemo(() => availableSources.map((s) => s.id), [availableSources]);

  const { ev, roiRetail, roiMarket } = useMemo(
    () => computeProduct(payload, state, availableIds),
    [payload, state, availableIds],
  );

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
        gradedAvailable={false}
      />

      {/* ---- the split: EV once, two denominators ---- */}
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Expected value</div>
          <div className="tabular mt-1 text-2xl font-semibold">
            {formatCents(ev.evProductCents)}
          </div>
          <div className="mt-1 text-xs text-muted">
            {formatCents(ev.evPackCents)} per pack × {payload.packsContained}
            {ev.productExtrasValueCents > 0 &&
              ` + ${formatCents(ev.productExtrasValueCents)} guaranteed extras`}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Retail (MSRP)</div>
          <div className="tabular mt-1 flex items-baseline gap-3">
            <span className="text-2xl font-semibold">
              {payload.msrpCents !== null ? formatCents(payload.msrpCents) : "—"}
            </span>
            <span className="text-xl">
              <RoiCell roi={roiRetail} />
            </span>
          </div>
          <div className="mt-1 text-xs text-muted">
            if you can find it at retail price
          </div>
        </div>

        <div className="rounded-lg border border-amber-500/30 bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-muted">Current market</div>
          <div className="tabular mt-1 flex items-baseline gap-3">
            <span className="text-2xl font-semibold">
              {payload.market.priceCents !== null
                ? formatCents(payload.market.priceCents)
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

      {/* ---- guaranteed promos sidecar ---- */}
      {promoRows.length > 0 && (
        <section className="rounded-lg border border-border bg-surface p-4">
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
                    className="h-40 w-auto rounded-lg border border-border object-contain"
                  />
                )}
                <div>
                  <div className="text-sm font-medium">
                    {p.name} <span className="text-muted">#{p.number}</span>
                  </div>
                  <div className="tabular text-lg">
                    {p.priceCents !== null ? formatCents(p.priceCents) : "unpriced"}
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
          <div className="flex h-5 w-full overflow-hidden rounded border border-border">
            {ev.tiers.map((t, i) => {
              const pct = (t.evContributionCents / totalEv) * 100;
              if (pct < 0.5) return null;
              return (
                <div
                  key={t.rarity}
                  title={`${rarityLabel(t.rarity)}: ${formatCents(t.evContributionCents)}/pack (${pct.toFixed(0)}%)`}
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
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-3">Tier</th>
              <th className="py-1.5 pr-3">Odds / pack</th>
              <th className="py-1.5 pr-3">Avg card value</th>
              <th className="py-1.5 pr-3">EV / pack</th>
              <th className="py-1.5 pr-3">Priced</th>
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
                  {rarityLabel(t.rarity)}
                </td>
                <td className="tabular py-1.5 pr-3">
                  {formatProbability(t.perPackProbability)}
                </td>
                <td className="tabular py-1.5 pr-3">{formatCents(t.avgValueCents)}</td>
                <td className="tabular py-1.5 pr-3">{formatCents(t.evContributionCents)}</td>
                <td className="tabular py-1.5 pr-3 text-muted">
                  {t.pricedCardCount}/{t.totalCardCount}
                </td>
                <td className="tabular py-1.5">
                  {formatProbability(ev.probAtLeastOne[t.rarity] ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        <p className="text-xs text-muted">
          Expected hits per product: {ev.expectedHits.toFixed(2)} (counting every
          tier the pull-rate table enumerates)
        </p>
      </section>

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
        {ev.chase.length === 0 ? (
          <p className="text-sm text-muted">No priced chase cards.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {ev.chase.map((c) => {
              const img = payload.cards.find((x) => x.cardId === c.cardId)?.imageUrl;
              return (
                <div
                  key={c.cardId}
                  className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition hover:border-accent/60 hover:shadow-lg hover:shadow-black/30"
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
                      {formatCents(c.valueCents)}
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
                        title={`Chance of at least one per ${shortType(payload.productType)}`}
                      >
                        {formatProbability(c.probPerProduct)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-xs text-muted">
          Each tile: card value (top-right), odds per pack, and the chance of at
          least one per {shortType(payload.productType)} (bottom-right). Per-card
          odds assume every card in a tier is equally likely — no public data
          quantifies short prints. See{" "}
          <Link href={withFilter("/methodology")} className="underline">
            methodology
          </Link>
          .
        </p>
      </section>

      {/* ---- packs-needed calculator ---- */}
      <PacksCalculator ev={ev} roiMarket={roiMarket} />

      {/* ---- data provenance ---- */}
      <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
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
  const [cardId, setCardId] = useState(ev.chase[0]?.cardId ?? "");
  const card = ev.chase.find((c) => c.cardId === cardId) ?? ev.chase[0];
  if (!card) return null;

  const p50 = packsForProbability(card.perPackProbability, 0.5);
  const p90 = packsForProbability(card.perPackProbability, 0.9);

  return (
    <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-lg font-semibold">How many packs for…</h2>
      <select
        value={card.cardId}
        onChange={(e) => setCardId(e.target.value)}
        className="w-full max-w-sm rounded border border-border bg-surface-raised px-2 py-1 text-sm"
      >
        {ev.chase.map((c) => (
          <option key={c.cardId} value={c.cardId}>
            {c.name} #{c.number} ({formatCents(c.valueCents)})
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

function shortType(t: string): string {
  return t === "booster_pack" ? "pack" : t === "booster_box" ? "box" : t.replace("_", " ");
}
