import { sql } from "drizzle-orm";

import { getDb, priceSnapshots } from "@/lib/db";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadRankingsFromDb } from "./db";
import { RANKINGS_SNAPSHOT_FILE } from "./snapshot";
import type { ProductPayload, RankingsPayload } from "./types";

export interface MarketHistoryPoint {
  /** YYYY-MM-DD. */
  date: string;
  cents: number;
}

/**
 * Daily market-price history for one sealed product, from the append-only
 * price_snapshots table (the day's median across sources/runs). Empty until
 * the cron has written at least one day — the sparkline handles that. Read-only
 * DB, so it stays inside the ISR page's no-external-fetch guarantee.
 */
export async function getMarketHistory(
  productId: string,
  days = 120,
): Promise<MarketHistoryPoint[]> {
  try {
    const db = getDb();
    // Compute the cutoff in JS: `now() - ($n * interval '1 day')` fails because
    // Postgres can't multiply an untyped bind param by an interval.
    const cutoffIso = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = await db.execute<{ day: string; cents: number | string }>(sql`
      select to_char(date(${priceSnapshots.capturedAt}), 'YYYY-MM-DD') as day,
             round(percentile_cont(0.5) within group (order by ${priceSnapshots.priceCents}))::int as cents
      from ${priceSnapshots}
      where ${priceSnapshots.sealedProductId} = ${productId}::uuid
        and ${priceSnapshots.kind} = 'sealed'
        and ${priceSnapshots.capturedAt} >= ${cutoffIso}::timestamptz
      group by date(${priceSnapshots.capturedAt})
      order by day
    `);
    return [...rows].map((r) => ({ date: String(r.day), cents: Number(r.cents) }));
  } catch (err) {
    console.error(
      "[data] market history unavailable:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/**
 * Data access for pages. Server-only, DB-backed (Neon via Drizzle).
 *
 * Never fetches from an external API — that is the non-negotiable. External
 * calls happen in cron jobs; pages read what the jobs wrote.
 *
 * On DB failure this retries, then — off Vercel only — returns an EMPTY
 * payload rather than throwing, so CI builds whose DATABASE_URL points nowhere
 * still pass. On Vercel the same situation throws instead: a failed build
 * keeps the previous deployment live and a failed revalidation keeps the
 * stale page, either of which beats shipping an empty site (which happened
 * once, 2026-08-25).
 */

const EMPTY: RankingsPayload = {
  generatedAt: "",
  availableSources: [],
  products: [],
};

let cached: RankingsPayload | null = null;

export async function getRankings(): Promise<RankingsPayload> {
  if (cached && cached.products.length > 0) return cached;

  // A transient DB refusal during a Vercel build once shipped a fully EMPTY
  // homepage to production (2026-08-25) — 200, zero products, while the DB was
  // healthy. So: retry with backoff, and on Vercel treat "no products" as a
  // hard failure. Failing a build keeps the previous deployment serving;
  // failing an ISR revalidation keeps the stale page. Both beat rendering an
  // empty site. The empty fallback survives only OFF Vercel, for CI builds
  // whose DATABASE_URL points nowhere.
  // During `next build`, scripts/prebuild-rankings.ts has already fetched the
  // payload once and written it beside the app — every worker reads the file
  // instead of hammering the DB (which blew Next's 60s page timeout on Vercel
  // and failed deploys). At runtime the file doesn't ship; ISR uses the DB.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    try {
      const raw = await readFile(join(process.cwd(), RANKINGS_SNAPSHOT_FILE), "utf8");
      const snap = JSON.parse(raw) as RankingsPayload;
      if (snap.products.length > 0) {
        cached = snap;
        return cached;
      }
    } catch {
      // No snapshot (plain `next build` without the prebuild step) — fall
      // through to the DB path below.
    }
  }

  const attempts = 5;
  for (let i = 1; i <= attempts; i++) {
    try {
      const loaded = await loadRankingsFromDb();
      if (loaded.products.length > 0) {
        cached = loaded;
        return cached;
      }
      console.error(`[data] rankings query returned 0 products (attempt ${i}/${attempts})`);
    } catch (err) {
      console.error(
        `[data] DB fetch failed (attempt ${i}/${attempts}):`,
        err instanceof Error ? err.message : err,
      );
    }
    // Exponential: 2s, 4s, 8s, 16s — Railway refusals during Vercel builds
    // have outlived the old linear backoff and failed whole deploys.
    if (i < attempts) await new Promise((r) => setTimeout(r, 2 ** i * 1000));
  }

  if (process.env.VERCEL) {
    throw new Error(
      "rankings unavailable after retries — failing this render rather than serving an empty site",
    );
  }
  console.error("[data] DB unavailable — rendering empty payload (non-Vercel build)");
  return EMPTY;
}

export async function getProduct(
  game: string,
  setCode: string,
  productSlug: string,
): Promise<ProductPayload | null> {
  const { products } = await getRankings();
  return (
    products.find(
      (p) => p.gameSlug === game && p.setCode === setCode && p.productSlug === productSlug,
    ) ?? null
  );
}

export async function getSetProducts(
  game: string,
  setCode: string,
): Promise<ProductPayload[]> {
  const { products } = await getRankings();
  return products.filter((p) => p.gameSlug === game && p.setCode === setCode);
}

/** Everything the per-card page needs: the card + every product that can pull it. */
export interface CardContext {
  gameSlug: string;
  gameName: string;
  setCode: string;
  setName: string;
  card: import("@packroi/ev/types").CardPriceData;
  /** Products whose packs can contain this card, with the card's odds in each. */
  sources: {
    productName: string;
    productSlug: string;
    setCode: string;
    setName: string;
    productType: string;
    marketCents: number | null;
    imageUrl: string | null;
    /** From the product's chase table; null when the card is below the chase bar. */
    perPackProbability: number | null;
    oneInPacks: number | null;
    probPerProduct: number | null;
    valueCents: number | null;
  }[];
}

export async function getCardContext(
  game: string,
  setCode: string,
  number: string,
): Promise<CardContext | null> {
  const { products } = await getRankings();
  // The card lives in the payload of any product of its set.
  const home = products.find((p) => p.gameSlug === game && p.setCode === setCode);
  if (!home) return null;
  const card = home.cards.find((c) => c.number === number);
  if (!card) return null;

  // Every product whose packs draw from this set: the set's own products plus
  // any blended collection (UPC / tin) whose componentPacks include it.
  const holders = products.filter(
    (p) =>
      (p.gameSlug === game && p.setCode === setCode) ||
      p.componentPacks?.some((cp) => cp.setCode === setCode),
  );

  // Deferred import keeps this module server/client agnostic like the rest.
  const { computeProduct } = await import("@/lib/data/compute");
  const { DEFAULT_FILTER_STATE } = await import("@packroi/ev/url-state");
  const { availableSources } = await getRankings();
  const ids = availableSources.map((s) => s.id);

  const sources = holders.map((p) => {
    const c = computeProduct(p, DEFAULT_FILTER_STATE, ids);
    const chase = c.ev.chase.find((ch) => ch.cardId === card.cardId);
    return {
      productName: p.productName,
      productSlug: p.productSlug,
      setCode: p.setCode,
      setName: p.setName,
      productType: p.productType,
      marketCents: p.market.priceCents,
      imageUrl: p.imageUrl,
      perPackProbability: chase?.perPackProbability ?? null,
      oneInPacks: chase && Number.isFinite(chase.oneInPacks) ? chase.oneInPacks : null,
      probPerProduct: chase?.probPerProduct ?? null,
      valueCents: chase?.valueCents ?? null,
    };
  });
  // Best odds first; products where the card is below the chase bar sink.
  sources.sort((a, b) => (b.probPerProduct ?? -1) - (a.probPerProduct ?? -1));

  return {
    gameSlug: home.gameSlug,
    gameName: home.gameName,
    setCode: home.setCode,
    setName: home.setName,
    card,
    sources,
  };
}
