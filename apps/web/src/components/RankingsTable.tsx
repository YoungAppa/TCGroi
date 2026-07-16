"use client";

/* eslint-disable @next/next/no-img-element -- external card/set art domains
   are not configured for next/image yet; plain img is deliberate here. */

import Link from "next/link";
import { useMemo, useState } from "react";

import { computeProduct, type ProductComputation } from "@/lib/data/compute";
import type { ProductPayload } from "@/lib/data/types";
import { formatCents, formatProbability } from "@packroi/ev/format";

import { ConfidenceBadge, RoiCell } from "./badges";
import { SourceFilter } from "./SourceFilter";
import { useFilterState } from "./useFilterState";

type SortKey = "roiMarket" | "roiRetail" | "ev" | "market" | "evPerPack" | "pTopBox";
type Row = { payload: ProductPayload; c: ProductComputation };

/** The rarity whose per-box probability headlines the rankings, per game. */
const HEADLINE_RARITY: Record<string, string[]> = {
  pokemon: ["special_illustration_rare"],
  "one-piece": ["secret_rare", "manga_rare"],
};

function headlineProb(row: Row): number {
  const rarities = HEADLINE_RARITY[row.payload.gameSlug] ?? [];
  let best = 0;
  for (const r of rarities) {
    const p = row.c.ev.probAtLeastOne[r];
    if (p !== undefined && p > best) best = p;
  }
  return best;
}

const SORTS: Record<SortKey, (r: Row) => number> = {
  // null sinks to the bottom rather than sorting as 0 — "unknown" must not
  // outrank genuinely bad products.
  roiMarket: (r) => r.c.roiMarket ?? -Infinity,
  roiRetail: (r) => r.c.roiRetail ?? -Infinity,
  ev: (r) => r.c.ev.evProductCents,
  market: (r) => r.payload.market.priceCents ?? -Infinity,
  evPerPack: (r) => r.c.ev.evPackCents,
  pTopBox: headlineProb,
};

export function RankingsTable({
  products,
  availableSources,
}: {
  products: ProductPayload[];
  availableSources: { id: string; displayName: string }[];
}) {
  const { state, setState, withFilter } = useFilterState();
  const [sortKey, setSortKey] = useState<SortKey>("roiMarket");
  const [sortDesc, setSortDesc] = useState(true);
  const [game, setGame] = useState<string>("all");

  const availableIds = useMemo(() => availableSources.map((s) => s.id), [availableSources]);

  const rows: Row[] = useMemo(
    () =>
      products
        .filter((p) => game === "all" || p.gameSlug === game)
        .filter((p) => p.pullRates.confidence !== "placeholder")
        .map((payload) => ({ payload, c: computeProduct(payload, state, availableIds) })),
    [products, state, availableIds, game],
  );

  const sorted = useMemo(() => {
    const metric = SORTS[sortKey];
    return [...rows].sort((a, b) => (metric(b) - metric(a)) * (sortDesc ? 1 : -1));
  }, [rows, sortKey, sortDesc]);

  function clickSort(key: SortKey) {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  const games = [...new Set(products.map((p) => p.gameSlug))];
  const anyManualMarket = rows.some((r) => r.payload.market.isManual);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SourceFilter
          available={availableSources}
          state={state}
          onChange={setState}
          gradedAvailable={false /* wired in Phase 6 when a graded source exists */}
        />
        {games.length > 1 && (
          <select
            value={game}
            onChange={(e) => setGame(e.target.value)}
            className="rounded border border-border bg-surface px-2 py-1 text-xs"
          >
            <option value="all">All games</option>
            {games.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            {/* Group header: the retail/market split is the page's thesis. */}
            <tr className="border-b border-border/60 bg-surface text-center text-[10px] uppercase tracking-wider text-muted">
              <th colSpan={2} className="px-3 py-1" />
              <th colSpan={2} className="border-l border-border/60 px-3 py-1">
                Retail (MSRP)
              </th>
              <th colSpan={2} className="border-l border-border/60 px-3 py-1">
                Current market
              </th>
              <th colSpan={2} className="border-l border-border/60 px-3 py-1" />
            </tr>
            <tr className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-2 font-medium">Product</th>
              <SortHeader label="EV" k="ev" cur={sortKey} desc={sortDesc} onClick={clickSort} />
              <th className="tabular border-l border-border/60 px-3 py-2 font-medium">MSRP</th>
              <SortHeader label="ROI" k="roiRetail" cur={sortKey} desc={sortDesc} onClick={clickSort} />
              <SortHeader label="Price" k="market" cur={sortKey} desc={sortDesc} onClick={clickSort} borderLeft />
              <SortHeader label="ROI" k="roiMarket" cur={sortKey} desc={sortDesc} onClick={clickSort} />
              <SortHeader label="P(top hit)" k="pTopBox" cur={sortKey} desc={sortDesc} onClick={clickSort} borderLeft />
              <th className="px-3 py-2 font-medium">Data</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ payload, c }) => (
              <tr
                key={payload.productId}
                className="border-b border-border/50 transition-colors last:border-0 hover:bg-surface"
              >
                <td className="px-3 py-2">
                  <Link
                    href={withFilter(
                      `/${payload.gameSlug}/${payload.setCode}/${payload.productSlug}`,
                    )}
                    className="flex items-center gap-2"
                  >
                    {payload.imageUrl && (
                      <img
                        src={payload.imageUrl}
                        alt=""
                        loading="lazy"
                        className="h-6 w-14 shrink-0 object-contain"
                      />
                    )}
                    <span>
                      <span className="font-medium">{payload.setName}</span>{" "}
                      <span className="text-muted">{payload.productName}</span>
                    </span>
                  </Link>
                </td>
                <td className="tabular px-3 py-2">{formatCents(c.ev.evProductCents)}</td>
                <td className="tabular border-l border-border/60 px-3 py-2 text-muted">
                  {payload.msrpCents !== null ? formatCents(payload.msrpCents) : "—"}
                </td>
                <td className="tabular px-3 py-2">
                  <RoiCell roi={c.roiRetail} />
                </td>
                <td className="tabular border-l border-border/60 px-3 py-2">
                  {payload.market.priceCents !== null
                    ? formatCents(payload.market.priceCents)
                    : "—"}
                  {payload.market.isManual && (
                    <span
                      title={`Hand-tracked ${payload.market.asOf ?? ""} — ${payload.market.source ?? ""}. Replaced automatically once a sealed price source is connected.`}
                      className="ml-1 cursor-help text-amber-400"
                    >
                      *
                    </span>
                  )}
                </td>
                <td className="tabular px-3 py-2">
                  <RoiCell roi={c.roiMarket} />
                </td>
                <td className="tabular border-l border-border/60 px-3 py-2">
                  {formatProbability(headlineProb({ payload, c }))}
                </td>
                <td className="px-3 py-2">
                  <ConfidenceBadge
                    confidence={payload.pullRates.confidence}
                    sampleSizePacks={payload.pullRates.sampleSizePacks}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        Retail ROI answers &quot;is it worth opening at MSRP&quot;; market ROI answers
        &quot;is it worth opening at what it actually costs today&quot;.
        {anyManualMarket &&
          " Market prices marked * are hand-tracked with a source and date — a live sealed price source replaces them automatically."}
      </p>
    </div>
  );
}

function SortHeader({
  label,
  k,
  cur,
  desc,
  onClick,
  borderLeft = false,
}: {
  label: string;
  k: SortKey;
  cur: SortKey;
  desc: boolean;
  onClick: (k: SortKey) => void;
  borderLeft?: boolean;
}) {
  const active = cur === k;
  return (
    <th className={`px-3 py-2 font-medium ${borderLeft ? "border-l border-border/60" : ""}`}>
      <button
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide ${
          active ? "text-foreground" : "hover:text-foreground"
        }`}
      >
        {label}
        <span className="text-[10px]">{active ? (desc ? "▼" : "▲") : ""}</span>
      </button>
    </th>
  );
}
