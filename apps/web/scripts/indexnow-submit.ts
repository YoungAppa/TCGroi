/**
 * Submit every sitemap URL to IndexNow (Bing, Yandex, Seznam, Naver share the
 * endpoint; Google does not participate). The key is public by design — the
 * protocol proves ownership by serving `/{key}.txt` from the site root — so it
 * lives in public/ and .indexnow-key, not in .env. Batches of 10,000 URLs.
 *
 *   npx tsx scripts/indexnow-submit.ts            # all sitemap URLs
 *   npx tsx scripts/indexnow-submit.ts --core     # core sitemap only
 */
import { readFileSync } from "node:fs";
import { SITE_URL } from "@/lib/site";

const key = readFileSync(".indexnow-key", "utf8").trim().replace(/^INDEXNOW_KEY=/, "");
const host = new URL(SITE_URL).host;

async function urlsOf(sitemap: string): Promise<string[]> {
  const xml = await fetch(sitemap, { signal: AbortSignal.timeout(120000) }).then((r) => r.text());
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.trim());
}

async function main() {
  const index = await urlsOf(`${SITE_URL}/sitemap.xml`);
  const shards = process.argv.includes("--core") ? index.filter((u) => u.endsWith("/core.xml")) : index;
  const urls: string[] = [];
  for (const s of shards) urls.push(...(await urlsOf(s)));
  console.log(`${urls.length} URLs from ${shards.length} sitemap shard(s) on ${host}`);
  for (let i = 0; i < urls.length; i += 10000) {
    const batch = urls.slice(i, i + 10000);
    const r = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key, keyLocation: `${SITE_URL}/${key}.txt`, urlList: batch }),
      signal: AbortSignal.timeout(120000),
    });
    console.log(`  batch ${i / 10000 + 1}: ${batch.length} URLs -> HTTP ${r.status} ${r.status === 200 || r.status === 202 ? "accepted" : (await r.text()).slice(0, 200)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
