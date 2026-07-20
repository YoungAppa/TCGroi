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

type ViewMode = "list" | "icons";

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
  const [view, setView] = useState<ViewMode>("list");

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
        <div className="flex items-center gap-3">
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
          {/* List / Icon view toggle */}
          <div className="flex overflow-hidden rounded border border-border text-xs">
            <button
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
              className={`px-2.5 py-1 ${view === "list" ? "bg-surface-raised text-foreground" : "text-muted hover:text-foreground"}`}
            >
              ▤ List
            </button>
            <button
              onClick={() => setView("icons")}
              aria-pressed={view === "icons"}
              className={`border-l border-border px-2.5 py-1 ${view === "icons" ? "bg-surface-raised text-foreground" : "text-muted hover:text-foreground"}`}
            >
              ▦ Icons
            </button>
          </div>
        </div>
      </div>

      {view === "icons" ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {sorted.map((row) => (
            <IconTile key={row.payload.productId} row={row} withFilter={withFilter} />
          ))}
        </div>
      ) : (
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
      )}

      <p className="text-xs text-muted">
        Retail ROI answers &quot;is it worth opening at MSRP&quot;; market ROI answers
        &quot;is it worth opening at what it actually costs today&quot;.
        {anyManualMarket &&
          " Market prices marked * are hand-tracked with a source and date — a live sealed price source replaces them automatically."}
      </p>
    </div>
  );
}

/** Short product-type badge used on the icon tiles. */
const TYPE_LABEL: Record<ProductPayload["productType"], string> = {
  booster_pack: "Pack",
  booster_box: "Booster Box",
  etb: "ETB",
  bundle: "Bundle",
  display: "Display",
  case: "UPC",
};

/**
 * Icon-view tile: the set logo stands in as product art (we have no photos of
 * the sealed products themselves), with a product-type badge to tell a set's
 * Pack/Box/ETB apart. Hovering fades in the set's three biggest chase cards
 * over the logo — the payoff the whole site is about, made visual.
 */
function IconTile({
  row,
  withFilter,
}: {
  row: Row;
  withFilter: (path: string) => string;
}) {
  const { payload, c } = row;
  const chase = c.ev.chase
    .slice(0, 3)
    .map((ch) => ({
      key: ch.cardId,
      value: ch.valueCents,
      img: payload.cards.find((cd) => cd.cardId === ch.cardId)?.imageUrl ?? null,
    }))
    .filter((ch) => ch.img);

  // Market ROI is the headline; fall back to retail when there's no market price.
  const roi = c.roiMarket ?? c.roiRetail;

  return (
    <Link
      href={withFilter(`/${payload.gameSlug}/${payload.setCode}/${payload.productSlug}`)}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-surface p-3 transition hover:border-accent/60 hover:shadow-lg hover:shadow-black/30"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
          {TYPE_LABEL[payload.productType]}
        </span>
        <ConfidenceBadge
          confidence={payload.pullRates.confidence}
          sampleSizePacks={payload.pullRates.sampleSizePacks}
        />
      </div>

      {/* Hero: set logo, overlaid on hover by the three chase cards. */}
      <div className="relative flex h-28 items-center justify-center rounded-lg bg-surface-raised/40">
        {payload.imageUrl ? (
          <img
            src={payload.imageUrl}
            alt={payload.setName}
            loading="lazy"
            className="max-h-20 max-w-[85%] object-contain transition-opacity duration-200 group-hover:opacity-0"
          />
        ) : (
          <span className="px-2 text-center text-sm font-semibold text-muted transition-opacity group-hover:opacity-0">
            {payload.setName}
          </span>
        )}

        {chase.length > 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            {chase.map((ch, i) => (
              <span key={ch.key} className="relative flex flex-col items-center">
                <img
                  src={ch.img!}
                  alt=""
                  loading="lazy"
                  className="h-24 w-auto rounded-sm border border-border object-contain shadow-md"
                  style={{
                    transform: `rotate(${(i - 1) * 7}deg) translateY(${i === 1 ? -2 : 4}px)`,
                  }}
                />
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2.5 min-w-0">
        <div className="truncate text-sm font-medium" title={payload.setName}>
          {payload.setName}
        </div>
        <div className="truncate text-xs text-muted" title={payload.productName}>
          {payload.productName}
        </div>
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="tabular text-sm font-semibold" title="Expected value">
            {formatCents(c.ev.evProductCents)}
          </span>
          <span className="tabular text-sm">
            <RoiCell roi={roi} />
          </span>
        </div>
      </div>

      {chase.length > 0 && (
        <div className="mt-1 text-[10px] text-muted opacity-70 transition-opacity group-hover:opacity-0">
          hover for top {chase.length} chase card{chase.length > 1 ? "s" : ""}
        </div>
      )}
    </Link>
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
