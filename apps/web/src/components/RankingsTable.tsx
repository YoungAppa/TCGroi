"use client";

/* eslint-disable @next/next/no-img-element -- external card/set art domains
   are not configured for next/image yet; plain img is deliberate here. */

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";

import { computeProduct, type ProductComputation } from "@/lib/data/compute";
import type { ProductPayload } from "@/lib/data/types";
import { formatCents, formatProbability } from "@packroi/ev/format";

import { ConfidenceBadge, RoiCell } from "./badges";
import { SourceFilter } from "./SourceFilter";
import { useFilterState } from "./useFilterState";

type SortKey = "roiMarket" | "roiRetail" | "ev" | "market" | "evPerPack" | "pTopBox" | "popular";
type Row = { payload: ProductPayload; c: ProductComputation };
type ViewMode = "list" | "icons";

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
  // "Popular" = the average value of a set's top 10 chase cards. The sets with
  // the big-money hits (151, Prismatic Evolutions, Ascended Heroes) are the ones
  // people actually chase — the best demand proxy we have without usage data.
  popular: (r) => {
    const top = r.c.ev.chase.slice(0, 10);
    return top.length ? top.reduce((s, ch) => s + ch.valueCents, 0) / top.length : -Infinity;
  },
};

/** Named sort options for the dropdown → (metric, descending). */
const SORT_OPTIONS: { value: string; label: string; key: SortKey; desc: boolean }[] = [
  { value: "popular", label: "Popular", key: "popular", desc: true },
  { value: "roi-high", label: "Highest ROI", key: "roiMarket", desc: true },
  { value: "roi-low", label: "Lowest ROI", key: "roiMarket", desc: false },
  { value: "price-high", label: "Most expensive", key: "market", desc: true },
  { value: "price-low", label: "Cheapest", key: "market", desc: false },
];

export function RankingsTable({
  products,
  availableSources,
}: {
  products: ProductPayload[];
  availableSources: { id: string; displayName: string }[];
}) {
  const { state, setState, withFilter } = useFilterState();
  const [sortKey, setSortKey] = useState<SortKey>("popular");
  const [sortDesc, setSortDesc] = useState(true);
  const [game, setGame] = useState<string>("pokemon");
  const [lang, setLang] = useState<"en" | "ja">("en");
  // View defaults to icons on a phone (the 8-column list scrolls sideways
  // there), list on desktop — until the user picks one explicitly.
  const [userView, setUserView] = useState<ViewMode | null>(null);
  const isNarrow = useIsNarrow();
  const view: ViewMode = userView ?? (isNarrow ? "icons" : "list");
  // Which price-column groups the List view shows. Independent of the EV source
  // selection above — hiding a column never changes how EV is computed.
  const [showRetail, setShowRetail] = useState(true);
  const [showMarket, setShowMarket] = useState(true);
  // Search + filters.
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [confFilter, setConfFilter] = useState<string>("all");
  const [positiveOnly, setPositiveOnly] = useState(false);

  const availableIds = useMemo(() => availableSources.map((s) => s.id), [availableSources]);

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    // All catalog data is English today; the Japanese tab is a placeholder
    // until a Japanese catalog source lands.
    if (lang !== "en") return [];
    return products
      .filter((p) => p.gameSlug === game)
      .filter((p) => p.pullRates.confidence !== "placeholder")
      .filter((p) => confFilter === "all" || p.pullRates.confidence === confFilter)
      .filter((p) => typeFilter === "all" || p.productType === typeFilter)
      .filter((p) => !q || `${p.setName} ${p.productName}`.toLowerCase().includes(q))
      .map((payload) => ({ payload, c: computeProduct(payload, state, availableIds) }))
      .filter((r) => {
        if (!positiveOnly) return true;
        // "Worth opening": either denominator's ROI is non-negative.
        return (r.c.roiRetail ?? -1) >= 0 || (r.c.roiMarket ?? -1) >= 0;
      });
  }, [products, state, availableIds, game, lang, confFilter, typeFilter, query, positiveOnly]);

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
  const gameName = (slug: string) => products.find((p) => p.gameSlug === slug)?.gameName ?? slug;
  const productTypes = [...new Set(products.map((p) => p.productType))];
  const anyManualMarket = rows.some((r) => r.payload.market.isManual);
  // At least one price column must remain — snap the other on if both go off.
  const retailOn = showRetail || !showMarket;
  const marketOn = showMarket || !showRetail;
  const filtersActive =
    query.trim() !== "" || typeFilter !== "all" || confFilter !== "all" || positiveOnly;
  function clearFilters() {
    setQuery("");
    setTypeFilter("all");
    setConfFilter("all");
    setPositiveOnly(false);
  }

  function renderGrid(sectionRows: Row[]) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {sectionRows.map((row) => (
          <IconTile
            key={row.payload.productId}
            row={row}
            withFilter={withFilter}
            marketFirst={marketOn}
          />
        ))}
      </div>
    );
  }

  function renderList(sectionRows: Row[]) {
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            {/* Group header: the retail/market split is the page's thesis. */}
            <tr className="border-b border-border/60 bg-surface text-center text-[10px] uppercase tracking-wider text-muted">
              <th colSpan={2} className="px-3 py-1" />
              {retailOn && (
                <th colSpan={2} className="border-l border-border/60 px-3 py-1">
                  Retail (MSRP)
                </th>
              )}
              {marketOn && (
                <th colSpan={2} className="border-l border-border/60 px-3 py-1">
                  Current market
                </th>
              )}
              <th colSpan={2} className="border-l border-border/60 px-3 py-1" />
            </tr>
            <tr className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-2 font-medium">Product</th>
              <SortHeader label="EV" k="ev" cur={sortKey} desc={sortDesc} onClick={clickSort} />
              {retailOn && (
                <>
                  <th className="tabular border-l border-border/60 px-3 py-2 font-medium">MSRP</th>
                  <SortHeader label="ROI" k="roiRetail" cur={sortKey} desc={sortDesc} onClick={clickSort} />
                </>
              )}
              {marketOn && (
                <>
                  <SortHeader label="Price" k="market" cur={sortKey} desc={sortDesc} onClick={clickSort} borderLeft />
                  <SortHeader label="ROI" k="roiMarket" cur={sortKey} desc={sortDesc} onClick={clickSort} />
                </>
              )}
              <SortHeader label="P(top hit)" k="pTopBox" cur={sortKey} desc={sortDesc} onClick={clickSort} borderLeft />
              <th className="px-3 py-2 font-medium">Data</th>
            </tr>
          </thead>
          <tbody>
            {sectionRows.map(({ payload, c }) => (
              <tr
                key={payload.productId}
                className="border-b border-border/50 transition-colors last:border-0 hover:bg-surface"
              >
                <td className="px-3 py-2">
                  <Link
                    href={withFilter(`/${payload.gameSlug}/${payload.setCode}/${payload.productSlug}`)}
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
                {retailOn && (
                  <>
                    <td className="tabular border-l border-border/60 px-3 py-2 text-muted">
                      {payload.msrpCents !== null ? formatCents(payload.msrpCents) : "—"}
                    </td>
                    <td className="tabular px-3 py-2">
                      <RoiCell roi={c.roiRetail} />
                    </td>
                  </>
                )}
                {marketOn && (
                  <>
                    <td className="tabular border-l border-border/60 px-3 py-2">
                      {payload.market.priceCents !== null ? formatCents(payload.market.priceCents) : "—"}
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
                  </>
                )}
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
    );
  }

  return (
    <div className="space-y-5">
      {/* Game tabs + language ---------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div className="flex items-end gap-1">
          {games.map((g) => {
            const on = game === g;
            return (
              <button
                key={g}
                onClick={() => setGame(g)}
                aria-pressed={on}
                className={`-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
                  on
                    ? "border-accent text-foreground"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {gameName(g)}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-1.5 pb-1 text-xs text-muted">
          Language
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as "en" | "ja")}
            className="rounded-md bg-surface-raised px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
          >
            <option value="en">English</option>
            <option value="ja">Japanese</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SourceFilter
            available={availableSources}
            state={state}
            onChange={setState}
            gradedAvailable={false /* wired in Phase 6 when a graded source exists */}
          />
          {/* Column toggles: which price columns the List view shows. */}
          <span className="ml-1 text-xs uppercase tracking-wide text-muted">Columns</span>
          <ColumnPill label="Retail (MSRP)" on={retailOn} onClick={() => setShowRetail((v) => !v)} />
          <ColumnPill label="Market" on={marketOn} onClick={() => setShowMarket((v) => !v)} />
        </div>
        <div className="flex items-center gap-3">
          {/* List / Icon view toggle — a calm segmented control */}
          <div className="flex gap-0.5 rounded-md bg-surface-raised p-0.5 text-xs">
            <button
              onClick={() => setUserView("list")}
              aria-pressed={view === "list"}
              className={`rounded px-2.5 py-1 transition-colors ${view === "list" ? "bg-surface text-foreground" : "text-muted hover:text-foreground"}`}
            >
              ▤ List
            </button>
            <button
              onClick={() => setUserView("icons")}
              aria-pressed={view === "icons"}
              className={`rounded px-2.5 py-1 transition-colors ${view === "icons" ? "bg-surface text-foreground" : "text-muted hover:text-foreground"}`}
            >
              ▦ Icons
            </button>
          </div>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5 text-muted">
          Sort
          <select
            value={SORT_OPTIONS.find((o) => o.key === sortKey && o.desc === sortDesc)?.value ?? ""}
            onChange={(e) => {
              const opt = SORT_OPTIONS.find((o) => o.value === e.target.value);
              if (opt) {
                setSortKey(opt.key);
                setSortDesc(opt.desc);
              }
            }}
            className="rounded-md bg-surface-raised px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
            aria-label="Sort products"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {/* When a column header sets a sort the dropdown can't name, show it. */}
            {!SORT_OPTIONS.some((o) => o.key === sortKey && o.desc === sortDesc) && (
              <option value="">Custom (column)</option>
            )}
          </select>
        </label>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search set or product…"
          aria-label="Search products"
          className="w-52 rounded-md bg-surface-raised px-3 py-1.5 text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md bg-surface-raised px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
          aria-label="Filter by product type"
        >
          <option value="all">All product types</option>
          {productTypes.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          value={confFilter}
          onChange={(e) => setConfFilter(e.target.value)}
          className="rounded-md bg-surface-raised px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
          aria-label="Filter by data confidence"
        >
          <option value="all">Any confidence</option>
          <option value="high">HIGH data</option>
          <option value="medium">Medium data</option>
          <option value="low">Low data</option>
        </select>
        <ColumnPill label="Worth opening (+ROI)" on={positiveOnly} onClick={() => setPositiveOnly((v) => !v)} />
        {filtersActive && (
          <button onClick={clearFilters} className="text-muted underline hover:text-foreground">
            clear
          </button>
        )}
        <span className="ml-auto text-muted">{rows.length} shown</span>
      </div>

      {lang === "ja" ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
          {gameName(game)} <span className="font-medium">Japanese</span> sets are coming soon — the
          site tracks English sets today. Prices for Japanese product exist, but a Japanese card
          catalog source is still needed.
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
          No products match your search or filters.{" "}
          <button onClick={clearFilters} className="text-accent underline">
            Clear filters
          </button>
        </div>
      ) : (
        view === "icons" ? renderGrid(sorted) : renderList(sorted)
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

/** True on phone-width viewports. SSR-safe (assumes desktop on the server). */
function useIsNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(max-width: 639px)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(max-width: 639px)").matches,
    () => false,
  );
}

function ColumnPill({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        on
          ? "bg-accent/15 text-accent"
          : "text-muted hover:bg-surface-raised hover:text-foreground"
      }`}
    >
      {label}
    </button>
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
 * Icon-view tile. Pokémon has set logos; One Piece (optcgapi) has none, so the
 * set's biggest chase card stands in as the hero there. Either way, hovering
 * fades the hero out and fans in the set's three biggest chase cards.
 */
function IconTile({
  row,
  withFilter,
  marketFirst,
}: {
  row: Row;
  withFilter: (path: string) => string;
  /** Which column the user has active — drives the price + ROI shown. */
  marketFirst: boolean;
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

  // Follow the Retail/Market column toggle: show that column's price + ROI,
  // falling back to the other when the chosen one has no price.
  const marketPrice = payload.market.priceCents;
  const retailPrice = payload.msrpCents;
  const useMarket = marketFirst ? marketPrice !== null : retailPrice === null;
  const priceCents = useMarket ? marketPrice : retailPrice;
  const roi = useMarket ? c.roiMarket : c.roiRetail;

  // Set logo when we have one; otherwise the top chase card is the hero.
  const heroImg = payload.imageUrl ?? chase[0]?.img ?? null;
  const heroIsCard = !payload.imageUrl && heroImg !== null;

  return (
    <Link
      href={withFilter(`/${payload.gameSlug}/${payload.setCode}/${payload.productSlug}`)}
      className="group relative flex flex-col overflow-hidden rounded-xl bg-surface p-3 ring-1 ring-white/5 transition hover:shadow-lg hover:shadow-black/30 hover:ring-accent/50"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
          {TYPE_LABEL[payload.productType]}
        </span>
      </div>

      {/* Hero: set logo or top chase card, overlaid on hover by the chase trio. */}
      <div className="relative flex h-28 items-center justify-center rounded-lg bg-surface-raised/40">
        {heroImg ? (
          <img
            src={heroImg}
            alt={payload.setName}
            loading="lazy"
            className={`${heroIsCard ? "h-full" : "max-h-20 max-w-[85%]"} w-auto object-contain transition-opacity duration-200 group-hover:opacity-0`}
          />
        ) : (
          <span className="px-2 text-center text-sm font-semibold text-muted transition-opacity group-hover:opacity-0">
            {payload.setName}
          </span>
        )}

        {chase.length > 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            {chase.map((ch, i) => (
              <img
                key={ch.key}
                src={ch.img!}
                alt=""
                loading="lazy"
                className="h-24 w-auto rounded-sm border border-border object-contain shadow-md"
                style={{ transform: `rotate(${(i - 1) * 7}deg) translateY(${i === 1 ? -2 : 4}px)` }}
              />
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
          <span className="tabular text-xs text-muted" title="Expected value">
            EV {formatCents(c.ev.evProductCents)}
          </span>
          <span
            className="flex items-baseline gap-1.5"
            title={useMarket ? "Current market price" : "Retail (MSRP)"}
          >
            <span className="tabular text-sm font-semibold">
              {priceCents !== null ? formatCents(priceCents) : "—"}
            </span>
            <span className="tabular text-sm">
              <RoiCell roi={roi} />
            </span>
          </span>
        </div>
      </div>
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
