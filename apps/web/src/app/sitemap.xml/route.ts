import { getDb } from "@/lib/db";
import { sql } from "drizzle-orm";
import { SITE_URL as BASE } from "@/lib/site";

/**
 * Sitemap INDEX. The catalog outgrew a single sitemap (the protocol caps one
 * file at 50,000 URLs and every card >= $1 in every set now gets a page), so
 * /sitemap.xml lists shards: /sitemaps/core.xml (home, sets, products) and
 * /sitemaps/cards-N.xml chunks.
 */
export const revalidate = 3600;


export const CARDS_PER_SHARD = 40000;

export async function cardShardCount(): Promise<number> {
  const db = getDb();
  const r = await db.execute<{ n: string }>(sql`
    select count(*)::bigint as n from (
      select c.set_id, c.number
      from cards c join latest_prices lp on lp.card_id = c.id and lp.kind = ${"raw"}
      group by c.set_id, c.number
      having max(lp.price_cents) >= 100
    ) q`);
  const n = Number([...r][0]?.n ?? 0);
  return Math.max(1, Math.ceil(n / CARDS_PER_SHARD));
}

export async function GET() {
  const shards = ["core", ...Array.from({ length: await cardShardCount() }, (_, i) => `cards-${i}`)];
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    shards.map((s) => `<sitemap><loc>${BASE}/sitemaps/${s}.xml</loc></sitemap>`).join("\n") +
    `\n</sitemapindex>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
}
