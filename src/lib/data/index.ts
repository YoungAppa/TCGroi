import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ProductPayload, RankingsPayload } from "./types";

/**
 * Data access for pages. Server-only.
 *
 * Currently fixture-backed (data/fixtures/payloads.json, built by
 * scripts/make-fixture.ts from live APIs). When DATABASE_URL lands, these
 * functions swap to DB queries serving the IDENTICAL shape — no page changes.
 *
 * Never fetches from an external API: that is the non-negotiable, and it holds
 * for the fixture path trivially (a file read) and must keep holding for the
 * DB path.
 */

let cached: RankingsPayload | null = null;

export async function getRankings(): Promise<RankingsPayload> {
  if (cached) return cached;

  const raw = await readFile(
    join(process.cwd(), "data", "fixtures", "payloads.json"),
    "utf8",
  );
  cached = JSON.parse(raw) as RankingsPayload;
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
