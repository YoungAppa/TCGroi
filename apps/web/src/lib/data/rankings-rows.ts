import type { BlendStrategy } from "@packroi/ev/types";
import { DEFAULT_FILTER_STATE, type FilterState } from "@packroi/ev/url-state";

import { computeProduct } from "./compute";
import type { ProductPayload } from "./types";

/**
 * The rankings page's row model — the whole product list WITHOUT card data.
 *
 * Why this exists: the page used to hand every ProductPayload to the client so
 * the table could re-run the EV engine locally when you toggle a source. That
 * shipped 552 products x ~200 priced cards each (sets duplicated once per
 * product) — a 39MB prop tree, a 42MB HTML document, and a 587MB build that
 * Vercel refused to deploy. It was also the single worst thing on the site for
 * Core Web Vitals, which SEO scores directly.
 *
 * With only two price sources there are just 24 reachable filter combinations
 * (3 non-empty source subsets x 4 blends x graded on/off), and each one needs
 * six numbers per product. So the server computes all of them once — the exact
 * same engine, so the numbers cannot drift — and the client does a dictionary
 * lookup instead of a recompute. Toggling stays instant; the payload drops
 * ~25x. Product pages still get the full payload: they show per-card tables and
 * are one product, not five hundred.
 */

export interface EvSummary {
  evProductCents: number;
  evPackCents: number;
  roiMarket: number | null;
  roiRetail: number | null;
  /** P(>=1 of the game's headline rarity) per product. Drives "P(top hit)". */
  pTop: number;
  /** Mean value of the top-10 chase cards — the "Popular" sort's demand proxy. */
  popularScore: number;
}

export interface RankingsRow {
  gameSlug: ProductPayload["gameSlug"];
  gameName: string;
  setCode: string;
  setName: string;
  setLanguage: ProductPayload["setLanguage"];
  releaseDate: string | null;
  productId: string;
  productName: string;
  productSlug: string;
  productType: ProductPayload["productType"];
  packsContained: number;
  imageUrl: string | null;
  msrpCents: number | null;
  market: ProductPayload["market"];
  pullRates: {
    confidence: ProductPayload["pullRates"]["confidence"];
    sampleSizePacks: number | null;
  };
  /** Up to 3 chase-card images for the tile's hover fan. Cosmetic, so they are
   *  fixed at the default filter state rather than varying per combination. */
  chaseThumbs: { cardId: string; imageUrl: string }[];
  /** EV by combination key — see comboKey(). */
  ev: Record<string, EvSummary>;
}

/** The rarity whose per-box probability headlines the rankings, per game. */
const HEADLINE_RARITY: Record<string, string[]> = {
  pokemon: ["special_illustration_rare"],
  "one-piece": ["secret_rare", "manga_rare"],
};

const BLENDS: BlendStrategy[] = ["median", "mean", "min", "max"];

/** Stable key for a filter combination. Sources are sorted so order can't split
 *  one combination into two. */
export function comboKey(sources: string[], blend: BlendStrategy, graded: boolean): string {
  return `${[...sources].sort().join("+")}|${blend}|${graded ? "g" : "r"}`;
}

/** Non-empty subsets of the available sources, smallest first. */
function sourceSubsets(available: string[]): string[][] {
  const out: string[][] = [];
  for (let mask = 1; mask < 1 << available.length; mask++) {
    out.push(available.filter((_, i) => mask & (1 << i)));
  }
  return out;
}

function summarize(
  payload: ProductPayload,
  state: FilterState,
  availableIds: string[],
): EvSummary {
  const c = computeProduct(payload, state, availableIds);
  const rarities = HEADLINE_RARITY[payload.gameSlug] ?? [];
  let pTop = 0;
  for (const r of rarities) {
    const p = c.ev.probAtLeastOne[r];
    if (p !== undefined && p > pTop) pTop = p;
  }
  const top = c.ev.chase.slice(0, 10);
  return {
    evProductCents: c.ev.evProductCents,
    evPackCents: c.ev.evPackCents,
    roiMarket: c.roiMarket,
    roiRetail: c.roiRetail,
    pTop,
    popularScore: top.length
      ? top.reduce((s, ch) => s + ch.valueCents, 0) / top.length
      : Number.NEGATIVE_INFINITY,
  };
}

export function buildRankingsRows(
  products: ProductPayload[],
  availableSourceIds: string[],
): { rows: RankingsRow[]; gradedAvailable: boolean } {
  const subsets = sourceSubsets(availableSourceIds);
  const gradedAvailable = products.some((p) => p.cards.some((c) => c.psa9 && c.psa10));

  const rows = products.map((payload) => {
    const ev: Record<string, EvSummary> = {};
    for (const sources of subsets) {
      for (const blend of BLENDS) {
        for (const graded of [false, true]) {
          const state: FilterState = { ...DEFAULT_FILTER_STATE, sources, blend, graded };
          ev[comboKey(sources, blend, graded)] = summarize(payload, state, availableSourceIds);
        }
      }
    }

    // Thumbnails come from the default state's chase order. Blended products
    // (UPCs, tins) hold their chase cards in componentPacks, not payload.cards.
    const def = computeProduct(payload, DEFAULT_FILTER_STATE, availableSourceIds);
    const findCard = (id: string) =>
      payload.cards.find((cd) => cd.cardId === id) ??
      payload.componentPacks?.flatMap((cp) => cp.cards).find((cd) => cd.cardId === id);
    const chaseThumbs = def.ev.chase
      .slice(0, 6)
      .map((ch) => ({ cardId: ch.cardId, imageUrl: findCard(ch.cardId)?.imageUrl ?? null }))
      .filter((t): t is { cardId: string; imageUrl: string } => t.imageUrl !== null)
      .slice(0, 3);

    return {
      gameSlug: payload.gameSlug,
      gameName: payload.gameName,
      setCode: payload.setCode,
      setName: payload.setName,
      setLanguage: payload.setLanguage,
      releaseDate: payload.releaseDate,
      productId: payload.productId,
      productName: payload.productName,
      productSlug: payload.productSlug,
      productType: payload.productType,
      packsContained: payload.packsContained,
      imageUrl: payload.imageUrl,
      msrpCents: payload.msrpCents,
      market: payload.market,
      pullRates: {
        confidence: payload.pullRates.confidence,
        sampleSizePacks: payload.pullRates.sampleSizePacks,
      },
      chaseThumbs,
      ev,
    } satisfies RankingsRow;
  });

  return { rows, gradedAvailable };
}

/** Look up a row's numbers for the active filter state. */
export function summaryFor(
  row: RankingsRow,
  state: FilterState,
  availableIds: string[],
): EvSummary {
  const sources = state.sources.length === 0 ? availableIds : state.sources.filter((s) => availableIds.includes(s));
  const effective = sources.length > 0 ? sources : availableIds;
  return (
    row.ev[comboKey(effective, state.blend, state.graded)] ??
    row.ev[comboKey(availableIds, "median", false)]!
  );
}
