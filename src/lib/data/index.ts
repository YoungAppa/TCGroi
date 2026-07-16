import { loadRankingsFromDb } from "./db";
import type { ProductPayload, RankingsPayload } from "./types";

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
