"use client";

/* eslint-disable @next/next/no-img-element -- external card/set art domains
   are not configured for next/image yet; plain img is deliberate here. */

import Link from "next/link";
import { useMemo, useState } from "react";

import { computeProduct, type ProductComputation } from "@/lib/data/compute";
import type { ProductPayload } from "@/lib/data/types";
import {formatProbability, formatRoi} from "@packroi/ev/format";

import { useI18n } from "@/lib/i18n/context";
import { useMoney } from "@/lib/money/context";

import { ConfidenceBadge, RoiCell } from "./badges";
import { SourceFilter } from "./SourceFilter";
import { useFilterState } from "./useFilterState";

type SortKey =
  | "roi"
  | "roiMarket"
  | "roiRetail"
  | "ev"
  | "market"
  | "evPerPack"
  | "pTopBox"
  | "popular"
  | "released";
type Row = { payload: ProductPayload; c: ProductComputation };
type ViewMode = "list" | "icons";

/**
 * Pokémon generation/era a set belongs to, derived from its code prefix. Used
 * by the rankings generation filter. Non-Pokémon games return "" (no filter).
 */
function generationOf(p: ProductPayload): string {
  if (p.gameSlug !== "pokemon") return "";
  const c = p.setCode.toLowerCase(); // JP codes are upper-cased (SV2a, S9)
  if (/^gem-pack/.test(c)) return "Gem Pack";
  if (/^me/.test(c)) return "Mega Evolution";
  if (/^(sv|rsv|zsv)/.test(c)) return "Scarlet & Violet";
  if (/^swsh/.test(c)) return "Sword & Shield";
  if (/^sm/.test(c)) return "Sun & Moon";
  if (/^xy/.test(c)) return "XY";
  if (/^bw/.test(c)) return "Black & White";
  if (/^(dp|pl)/.test(c)) return "Diamond & Pearl / Platinum";
  // JP era prefixes: S# = Sword & Shield, SV already caught above.
  if (/^s\d/.test(c)) return "Sword & Shield";
  return "Other";
}

/** Generations newest→oldest, for a stable filter-dropdown order. */
const GENERATION_ORDER = [
  "Mega Evolution",
  "Scarlet & Violet",
  "Sword & Shield",
  "Sun & Moon",
  "XY",
  "Black & White",
  "Diamond & Pearl / Platinum",
  "Gem Pack",
  "Other",
];

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
  // "roi" follows the active price column (see `sorted`); this default is the
  // market metric, overridden at sort time when only Retail is shown.
  roi: (r) => r.c.roiMarket ?? -Infinity,
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
  // Release date as an epoch ms; undated sets sink to the bottom either way.
  released: (r) =>
    r.payload.releaseDate ? Date.parse(r.payload.releaseDate) : Number.NEGATIVE_INFINITY,
};

/** Named sort options for the dropdown → (metric, descending). */
const SORT_OPTIONS: { value: string; label: string; key: SortKey; desc: boolean }[] = [
  { value: "popular", label: "Popular", key: "popular", desc: true },
  { value: "newest", label: "Newest released", key: "released", desc: true },
  { value: "oldest", label: "Oldest released", key: "released", desc: false },
  { value: "roi-high", label: "Highest ROI", key: "roi", desc: true },
  { value: "roi-low", label: "Lowest ROI", key: "roi", desc: false },
  { value: "price-high", label: "Most expensive", key: "market", desc: true },
  { value: "price-low", label: "Cheapest", key: "market", desc: false },
];

export function RankingsTable({
  products: allProducts,
  availableSources,
}: {
  products: ProductPayload[];
  availableSources: { id: string; displayName: string }[];
}) {
  const { money } = useMoney();
  const { t } = useI18n();
  // Only products that can produce a real EV or ROI belong in the rankings (and
  // in the game tabs derived from them). A freshly-scaffolded game with no price
  // source yet — CS2 before Skinport — is thus hidden from the public list while
  // its own product pages (a separate loader) stay reachable by direct link.
  const products = useMemo(
    () =>
      allProducts.filter(
        (p) =>
          p.market.priceCents !== null ||
          p.msrpCents !== null ||
          p.cards.some((c) => Object.keys(c.raw).length > 0),
      ),
    [allProducts],
  );
  const { state, setState, withFilter } = useFilterState();
  const [sortKey, setSortKey] = useState<SortKey>("popular");
  const [sortDesc, setSortDesc] = useState(true);
  const [game, setGame] = useState<string>("pokemon");
  const [lang, setLang] = useState<"en" | "ja" | "zh">("en");
  // Icons is the default view everywhere (product photos sell the page);
  // List remains a click away for the data-dense comparison.
  const [userView, setUserView] = useState<ViewMode | null>(null);
  const view: ViewMode = userView ?? "icons";
  // Which price denominators to show. Lives in the URL FilterState so the choice
  // hides the other everywhere (tiles, list columns, product page) and travels
  // in shared links. Never both-off — the toggles snap the last one back on.
  const retailOn = state.showRetail;
  const marketOn = state.showMarket;
  const toggleRetail = () =>
    setState({ ...state, showRetail: !retailOn, showMarket: !retailOn ? state.showMarket : true });
  const toggleMarket = () =>
    setState({ ...state, showMarket: !marketOn, showRetail: !marketOn ? state.showRetail : true });
  // Search + filters.
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [confFilter, setConfFilter] = useState<string>("all");
  const [genFilter, setGenFilter] = useState<string>("all");
  const [positiveOnly, setPositiveOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const availableIds = useMemo(() => availableSources.map((s) => s.id), [availableSources]);
  // Offer the graded toggle once any product has a card with both PSA legs.
  const gradedAvailable = useMemo(
    () => products.some((p) => p.cards.some((c) => c.psa9 && c.psa10)),
    [products],
  );

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Language tab filters by the set's language. Simplified Chinese Gem Packs
    // (their card names come from PriceCharting in English, but the sets are
    // ZH) live under 中文; JP has no ranked sets yet, so that tab is empty.
    const wantLang = lang === "ja" ? "JP" : lang === "zh" ? "ZH" : "EN";
    return products
      .filter((p) => p.gameSlug === game)
      .filter((p) => p.setLanguage === wantLang)
      .filter((p) => p.pullRates.confidence !== "placeholder")
      .filter((p) => confFilter === "all" || p.pullRates.confidence === confFilter)
      .filter((p) => typeFilter === "all" || p.productType === typeFilter)
      .filter((p) => genFilter === "all" || generationOf(p) === genFilter)
      .filter((p) => !q || `${p.setName} ${p.productName}`.toLowerCase().includes(q))
      .map((payload) => ({ payload, c: computeProduct(payload, state, availableIds) }))
      .filter((r) => {
        if (!positiveOnly) return true;
        // "Worth opening" means worth opening at a price you can actually pay,
        // so it keys on MARKET ROI alone. Retail ROI is measured against MSRP,
        // which for anything sought-after is a price no shelf has — counting it
        // marked sets "worth opening" that lose most of their value at the only
        // price you could really buy them at (Paldea Evolved: +80% at MSRP,
        // -38% at market). Retail ROI is still shown; it just doesn't decide
        // the verdict.
        return (r.c.roiMarket ?? -1) >= 0;
      });
  }, [products, state, availableIds, game, lang, confFilter, typeFilter, genFilter, query, positiveOnly]);

  const sorted = useMemo(() => {
    // The dropdown's "Highest/Lowest ROI" sorts by whichever price column is
    // active: Retail's ROI when only Retail is shown, Market's otherwise. The
    // explicit per-column ROI headers (roiRetail/roiMarket) stay literal.
    const marketColumnOn = state.showMarket || !state.showRetail;
    const metric: (r: Row) => number =
      sortKey === "roi"
        ? (r) => (marketColumnOn ? r.c.roiMarket : r.c.roiRetail) ?? -Infinity
        : SORTS[sortKey];
    return [...rows].sort((a, b) => (metric(b) - metric(a)) * (sortDesc ? 1 : -1));
  }, [rows, sortKey, sortDesc, state.showMarket, state.showRetail]);

  function clickSort(key: SortKey) {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  const games = [...new Set(products.map((p) => p.gameSlug))];
  const gameName = (slug: string) => products.find((p) => p.gameSlug === slug)?.gameName ?? slug;
  // Product-type options are game-specific: One Piece has no ETBs or UPCs, so
  // the filter must only offer the types the selected game actually has.
  const productTypes = [...new Set(products.filter((p) => p.gameSlug === game).map((p) => p.productType))];
  const anyManualMarket = rows.some((r) => r.payload.market.isManual);
  // Generation options for the selected game, newest era first (Pokémon only —
  // One Piece/Magic use set codes without a familiar generation vocabulary).
  const generations = useMemo(() => {
    if (game !== "pokemon") return [];
    const present = new Set(
      products.filter((p) => p.gameSlug === game).map((p) => generationOf(p)),
    );
    return GENERATION_ORDER.filter((g) => present.has(g));
  }, [products, game]);
  const activeFilterCount =
    (query.trim() !== "" ? 1 : 0) +
    (typeFilter !== "all" ? 1 : 0) +
    (confFilter !== "all" ? 1 : 0) +
    (genFilter !== "all" ? 1 : 0) +
    (positiveOnly ? 1 : 0);
  const filtersActive =
    query.trim() !== "" ||
    typeFilter !== "all" ||
    confFilter !== "all" ||
    genFilter !== "all" ||
    positiveOnly;
  function clearFilters() {
    setQuery("");
    setTypeFilter("all");
    setConfFilter("all");
    setGenFilter("all");
    setPositiveOnly(false);
  }

  function renderGrid(sectionRows: Row[]) {
    return (
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
        {sectionRows.map((row) => (
          <IconTile
            key={row.payload.productId}
            row={row}
            withFilter={withFilter}
            retailOn={retailOn}
            marketOn={marketOn}
          />
        ))}
      </div>
    );
  }

  // A faint wash behind the market column group. Market ROI is the honest
  // answer ("worth opening at what it costs today"), so the eye should land
  // there; the tint is semi-transparent so it survives the row-hover bg.
  const MARKET_TINT = "bg-foreground/[0.025]";

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
                <th
                  colSpan={2}
                  className={`border-l border-border/60 px-3 py-1 font-semibold text-foreground ${MARKET_TINT}`}
                >
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
                  <SortHeader label="Price" k="market" cur={sortKey} desc={sortDesc} onClick={clickSort} borderLeft className={MARKET_TINT} />
                  <SortHeader label="ROI" k="roiMarket" cur={sortKey} desc={sortDesc} onClick={clickSort} className={MARKET_TINT} />
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
                      <span className="font-medium">{payload.setName}</span>
                      {payload.gameSlug === "one-piece" && (
                        <span className="tabular text-muted"> ({payload.setCode})</span>
                      )}{" "}
                      <span className="text-muted">{payload.productName}</span>
                    </span>
                  </Link>
                </td>
                <td className="tabular px-3 py-2">{money(c.ev.evProductCents)}</td>
                {retailOn && (
                  <>
                    <td className="tabular border-l border-border/60 px-3 py-2 text-muted">
                      {payload.msrpCents !== null ? money(payload.msrpCents) : "—"}
                    </td>
                    <td className="tabular px-3 py-2">
                      <RoiCell roi={c.roiRetail} />
                    </td>
                  </>
                )}
                {marketOn && (
                  <>
                    <td className={`tabular border-l border-border/60 px-3 py-2 ${MARKET_TINT}`}>
                      {payload.market.priceCents !== null ? money(payload.market.priceCents) : "—"}
                      {payload.market.isManual && (
                        <span
                          title={`Hand-tracked ${payload.market.asOf ?? ""} — ${payload.market.source ?? ""}. Replaced automatically once a sealed price source is connected.`}
                          className="ml-1 cursor-help text-amber-400"
                        >
                          *
                        </span>
                      )}
                    </td>
                    <td className={`tabular px-3 py-2 ${MARKET_TINT}`}>
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
                onClick={() => {
                  setGame(g);
                  // A type/generation filter from the other game would hide
                  // everything here — reset them when the game changes.
                  setTypeFilter("all");
                  setGenFilter("all");
                }}
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
        {/* "Card language", not "Language": the header already carries a
            language select for the SITE's own words, and two adjacent controls
            both labelled Language gave no way to tell which did what. This one
            picks which printing of a set to rank. */}
        <label className="flex items-center gap-1.5 pb-1 text-xs text-muted">
          {t("filter.cardLanguage")}
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as "en" | "ja" | "zh")}
            className="rounded-md bg-surface-raised px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
          >
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="zh">中文 (Chinese)</option>
          </select>
        </label>
      </div>

      {/* On a phone these two rows stacked into six, pushing the first product
          ~1,350px down the page — the rankings became a filter form with the
          rankings below the fold. They collapse behind a button there, with the
          active count visible so a hidden filter is never a surprise. On sm+
          the panel is always open and this renders exactly as before. */}
      <button
        type="button"
        onClick={() => setFiltersOpen((v) => !v)}
        aria-expanded={filtersOpen}
        className="flex items-center gap-2 self-start rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground sm:hidden"
      >
        {filtersOpen ? "Hide filters" : "Filters"}
        {activeFilterCount > 0 && (
          <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">
            {activeFilterCount}
          </span>
        )}
        <span className="text-muted">· {rows.length} shown</span>
      </button>

      <div className={`${filtersOpen ? "flex" : "hidden"} flex-col gap-3 sm:flex`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SourceFilter
            available={availableSources}
            state={state}
            onChange={setState}
            gradedAvailable={gradedAvailable}
          />
          {/* Price toggles: which denominator to show (hides the other page-wide). */}
          <span className="ml-1 text-xs uppercase tracking-wide text-muted">Show</span>
          <ColumnPill label={t("filter.retail")} on={retailOn} onClick={toggleRetail} />
          <ColumnPill label={t("filter.market")} on={marketOn} onClick={toggleMarket} />
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
          placeholder={t("filter.search")}
          aria-label="Search products"
          className="w-52 rounded-md bg-surface-raised px-3 py-1.5 text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md bg-surface-raised px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
          aria-label="Filter by product type"
        >
          <option value="all">{t("filter.allTypes")}</option>
          {productTypes.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        {generations.length > 1 && (
          <select
            value={genFilter}
            onChange={(e) => setGenFilter(e.target.value)}
            className="rounded-md bg-surface-raised px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
            aria-label="Filter by generation"
          >
            <option value="all">{t("filter.allGenerations")}</option>
            {generations.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
        <select
          value={confFilter}
          onChange={(e) => setConfFilter(e.target.value)}
          className="rounded-md bg-surface-raised px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-accent/40"
          aria-label="Filter by data confidence"
        >
          <option value="all">{t("filter.anyConfidence")}</option>
          <option value="high">HIGH data</option>
          <option value="medium">Medium data</option>
          <option value="low">Low data</option>
        </select>
        <ColumnPill
          label={t("filter.worthOpening")}
          title="Products whose average unbox beats today's market price — the price you can actually buy at. Retail/MSRP ROI is shown but doesn't decide this."
          on={positiveOnly}
          onClick={() => setPositiveOnly((v) => !v)}
        />
        {filtersActive && (
          <button onClick={clearFilters} className="text-muted underline hover:text-foreground">
            clear
          </button>
        )}
        <span className="ml-auto text-muted">{rows.length} shown</span>
      </div>
      </div>

      {/* What the Japanese data does and does not cover. Shown above the
          results, not as an empty state, because the caveat matters most when
          sets ARE listed — a reader needs to know a ranked JP set rests on a
          different evidence base than an English one. */}
      {lang === "ja" && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs text-muted">
          <span className="font-medium text-foreground">{t("jp.about.title")}</span>{" "}
          {t("jp.about.body")}
        </div>
      )}

      {lang === "ja" && rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
          {gameName(game)} <span className="font-medium">Japanese</span> ROI is rolling out set by
          set — a first batch of flagship sets is ranked, with more to come. Try another game tab or
          check back soon.
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

function ColumnPill({
  label,
  on,
  onClick,
  title,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      title={title}
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
  retailOn,
  marketOn,
}: {
  row: Row;
  withFilter: (path: string) => string;
  /** Which denominators the user has active — hides the other, drives ROI. */
  retailOn: boolean;
  marketOn: boolean;
}) {
  const { money } = useMoney();
  const { payload, c } = row;
  const chase = c.ev.chase
    .slice(0, 3)
    .map((ch) => ({
      key: ch.cardId,
      value: ch.valueCents,
      img: payload.cards.find((cd) => cd.cardId === ch.cardId)?.imageUrl ?? null,
    }))
    .filter((ch) => ch.img);

  // The tile shows the selected denominator(s) plus average-unbox (EV). With
  // both on, market leads (the honest verdict) and retail sits alongside; with
  // one hidden, only the chosen price shows and its ROI drives the headline.
  const marketPrice = payload.market.priceCents;
  const retailPrice = payload.msrpCents;
  const useMarket = marketOn && (marketPrice !== null || !retailOn);
  const roi = useMarket ? c.roiMarket : c.roiRetail;
  // Which price the tile leads with: whichever column the reader has on, market
  // first when both are. That price is also what the ROI pill is measured
  // against, so the two can never disagree.
  const headlineIsRetail = !useMarket;
  const headlinePrice = headlineIsRetail ? retailPrice : marketPrice;

  // Same green -> amber -> orange -> red ramp as before, as a pill.
  const roiPillClass =
    roi === null
      ? "bg-surface-raised text-muted"
      : roi >= 0
        ? "bg-roi-pos/15 text-roi-pos"
        : roi >= -0.25
          ? "bg-amber-400/15 text-amber-400"
          : roi >= -0.5
            ? "bg-orange-400/15 text-orange-400"
            : "bg-roi-neg/15 text-roi-neg";

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
        <ConfidenceBadge
          confidence={payload.pullRates.confidence}
          sampleSizePacks={payload.pullRates.sampleSizePacks}
        />
      </div>

      {/* Hero: set logo or top chase card, overlaid on hover by the chase trio. */}
      <div className="relative flex h-40 items-center justify-center rounded-lg bg-surface-raised/40">
        {heroImg ? (
          <img
            src={heroImg}
            alt={payload.setName}
            loading="lazy"
            className={`${heroIsCard ? "h-full" : "max-h-36 max-w-[90%]"} w-auto object-contain transition-opacity duration-200 group-hover:opacity-0`}
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
          {payload.gameSlug === "one-piece" && (
            <span className="tabular font-normal text-muted"> ({payload.setCode})</span>
          )}
        </div>
        <div className="truncate text-xs text-muted" title={payload.productName}>
          {payload.productName}
        </div>
        <div className="tabular mt-2 border-t border-border pt-2">
          {/* The price you pay leads, the average unbox is its caption, and
              the ROI is a pill your eye lands on. Previously the ROI — the one
              number the whole site exists to give — was the SMALLEST text on
              the card, under two larger figures that matter less. */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <div>
              <div className="text-[15px] font-semibold leading-tight sm:text-[17px]">
                {headlinePrice !== null ? money(headlinePrice) : "—"}
                {headlineIsRetail && (
                  <span className="ml-1 text-[10px] font-medium text-muted">MSRP</span>
                )}
              </div>
              <div className="text-[10.5px] text-muted">
                opens for{" "}
                <span className="font-semibold text-foreground">
                  {money(c.ev.evProductCents)}
                </span>
              </div>
            </div>
            {roi !== null ? (
              <span
                className={`flex-none rounded-full px-2.5 py-1 text-[12.5px] font-bold ${roiPillClass}`}
                title={
                  headlineIsRetail
                    ? "Return if you buy at retail price"
                    : "Return at today's market price"
                }
              >
                {formatRoi(roi)}
              </span>
            ) : (
              <span className="flex-none rounded-full bg-surface-raised px-2.5 py-1 text-[12.5px] font-bold text-muted">
                —
              </span>
            )}
          </div>
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
  className = "",
}: {
  label: string;
  k: SortKey;
  cur: SortKey;
  desc: boolean;
  onClick: (k: SortKey) => void;
  borderLeft?: boolean;
  className?: string;
}) {
  const active = cur === k;
  return (
    <th className={`px-3 py-2 font-medium ${borderLeft ? "border-l border-border/60" : ""} ${className}`}>
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
