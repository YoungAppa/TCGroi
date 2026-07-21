import { sql } from "drizzle-orm";

import { getDb, priceSnapshots } from "@/lib/db";

import { loadRankingsFromDb } from "./db";
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
 * On DB failure this returns an EMPTY payload rather than throwing, for one
 * specific reason: CI builds with a DATABASE_URL that points nowhere, and the
 * "app builds with only env vars set" guarantee must survive that. In
 * production the build has the real database. The failure is logged loudly —
 * an empty site with a healthy DB is a bug, not a state to render silently.
 */

const EMPTY: RankingsPayload = {
  generatedAt: "",
  availableSources: [],
  products: [],
};

let cached: RankingsPayload | null = null;

export async function getRankings(): Promise<RankingsPayload> {
  if (cached && cached.products.length > 0) return cached;

  try {
    cached = await loadRankingsFromDb();
  } catch (err) {
    console.error(
      "[data] DB unavailable — rendering empty payload:",
      err instanceof Error ? err.message : err,
    );
    return EMPTY;
  }
  return cached;
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
