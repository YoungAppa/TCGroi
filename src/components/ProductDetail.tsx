"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { rarityLabel } from "@/lib/catalog/rarities";
import { computeForPayload } from "@/lib/data/compute";
import type { ProductPayload } from "@/lib/data/types";
import { packsForProbability } from "@/lib/ev";
import {
  formatCents,
  formatOneIn,
  formatProbability,
  formatRoi,
} from "@/lib/ev/format";
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

  const ev = useMemo(
    () => computeForPayload(payload, state, availableIds),
    [payload, state, availableIds],
  );

  const disagreements = useMemo(() => {
    // Rebuild a PullRateFile shape for the disagreement helper.
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

  return (
    <div className="space-y-6">
      <SourceFilter
        available={availableSources}
        state={state}
        onChange={setState}
        gradedAvailable={false}
      />

      {/* ---- headline numbers ---- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="EV (product)" value={formatCents(ev.evProductCents)} />
        <Stat label="EV per pack" value={formatCents(ev.evPackCents)} />
        <Stat
          label={`Price${payload.sealedIsPlaceholder ? " (placeholder)" : ""}`}
          value={ev.sealedPriceCents !== null ? formatCents(ev.sealedPriceCents) : "—"}
          sub={describeOrigin(ev.sealedPriceOrigin)}
        />
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="text-xs uppercase tracking-wide text-muted">ROI</div>
          <div className="tabular mt-1 text-xl">
            <RoiCell roi={ev.roi} />
          </div>
          <div className="text-xs text-muted">
            {ev.roi !== null && ev.roi < 0 && "you lose this fraction on average"}
          </div>
        </div>
      </div>

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

        <table className="w-full text-sm">
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

        <p className="text-xs text-muted">
          Expected hits per product: {ev.expectedHits.toFixed(2)} (counting every
          tier the pull-rate table enumerates)
        </p>
      </section>

      {/* ---- chase table ---- */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Chase cards</h2>
        <ChaseTable ev={ev} payload={payload} />
        <p className="text-xs text-muted">
          Per-card odds assume every card in a tier is equally likely — no public
          data quantifies short prints. See{" "}
          <Link href={withFilter("/methodology")} className="underline">
            methodology
          </Link>
          .
        </p>
      </section>

      {/* ---- packs-needed calculator ---- */}
      <PacksCalculator ev={ev} />

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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="tabular mt-1 text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

function ChaseTable({
  ev,
  payload,
}: {
  ev: ReturnType<typeof computeForPayload>;
  payload: ProductPayload;
}) {
  if (ev.chase.length === 0) {
    return <p className="text-sm text-muted">No priced chase cards.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-3 py-2">Card</th>
            <th className="px-3 py-2">Tier</th>
            <th className="px-3 py-2">Value</th>
            <th className="px-3 py-2">Odds</th>
            <th className="px-3 py-2">P(≥1) / {shortType(payload.productType)}</th>
          </tr>
        </thead>
        <tbody>
          {ev.chase.map((c) => (
            <tr key={c.cardId} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-1.5">
                {c.name} <span className="text-muted">#{c.number}</span>
              </td>
              <td className="px-3 py-1.5 text-muted">{rarityLabel(c.rarity)}</td>
              <td className="tabular px-3 py-1.5">{formatCents(c.valueCents)}</td>
              <td className="tabular px-3 py-1.5">{formatOneIn(c.oneInPacks)}</td>
              <td className="tabular px-3 py-1.5">{formatProbability(c.probPerProduct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PacksCalculator({ ev }: { ev: ReturnType<typeof computeForPayload> }) {
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
        No number of packs guarantees it — that is what {formatRoi(ev.roi ?? 0)} ROI
        pays for.
      </p>
    </section>
  );
}

function describeOrigin(o: { kind: string; sourceIds?: string[]; sourceId?: string }): string {
  switch (o.kind) {
    case "selected":
      return `from ${o.sourceIds?.join(" + ")}`;
    case "fallback":
      return `fallback: ${o.sourceId}`;
    case "msrp":
      return "MSRP — no market price available";
    default:
      return "no price available";
  }
}

function shortType(t: string): string {
  return t === "booster_pack" ? "pack" : t === "booster_box" ? "box" : t.replace("_", " ");
}
