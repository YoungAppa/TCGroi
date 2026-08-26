/**
 * Pre-build step: fetch the rankings payload from the DB ONCE and write it to
 * a snapshot file that every `next build` worker reads instead of the DB.
 *
 * Why: Next prerenders with ~7 parallel workers, and each one independently
 * initialised the full payload from Railway (a multi-query, multi-megabyte
 * load). Under Vercel's cross-region latency the first page per worker blew
 * Next's 60s static-generation timeout, and after three retries the whole
 * deploy failed — 5 of 6 deploys on 2026-08-26. One fetch, one file, zero
 * per-worker DB load.
 *
 * Failing loudly here is the point: a build without data must die in THIS
 * step (with a clear log line), never ship an empty site.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { loadRankingsFromDb } from "@/lib/data/db";
import { RANKINGS_SNAPSHOT_FILE } from "@/lib/data/snapshot";

async function main() {
  const started = Date.now();
  let payload: Awaited<ReturnType<typeof loadRankingsFromDb>> | null = null;
  const attempts = 5;
  for (let i = 1; i <= attempts; i++) {
    try {
      payload = await loadRankingsFromDb();
      if (payload.products.length > 0) break;
      console.error(`[prebuild] 0 products (attempt ${i}/${attempts})`);
      payload = null;
    } catch (err) {
      console.error(`[prebuild] DB fetch failed (attempt ${i}/${attempts}):`, err instanceof Error ? err.message : err);
    }
    if (i < attempts) await new Promise((r) => setTimeout(r, 2 ** i * 1000));
  }
  if (!payload) {
    console.error("[prebuild] rankings unavailable — failing the build before next build starts");
    process.exit(1);
  }
  const file = join(process.cwd(), RANKINGS_SNAPSHOT_FILE);
  const json = JSON.stringify(payload);
  await writeFile(file, json);
  console.log(
    `[prebuild] snapshot: ${payload.products.length} products, ${(json.length / 1e6).toFixed(1)}MB, ${((Date.now() - started) / 1000).toFixed(1)}s -> ${file}`,
  );
  process.exit(0);
}
main();
