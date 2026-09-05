import { getRankings } from "@/lib/data";
import { getDb } from "@/lib/db";
import { sql } from "drizzle-orm";
import { SITE_URL as BASE } from "@/lib/site";

/** Sitemap shards — see ../../sitemap.xml/route.ts for the index. */
export const revalidate = 3600;


const CARDS_PER_SHARD = 40000;

function xml(urls: { loc: string; freq: string; pri: string }[]): Response {
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map((u) => `<url><loc>${u.loc}</loc><changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`)
      .join("\n") +
    `\n</urlset>`;
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const name = id.replace(/\.xml$/, "");

  if (name === "core") {
    const { products } = await getRankings();
    const urls = [
      { loc: BASE, freq: "daily", pri: "1" },
      { loc: `${BASE}/sets`, freq: "daily", pri: "0.7" },
      { loc: `${BASE}/pokedex`, freq: "daily", pri: "0.7" },
      { loc: `${BASE}/methodology`, freq: "monthly", pri: "0.5" },
    ];
    const seenSet = new Set<string>();
    for (const p of products) {
      urls.push({ loc: `${BASE}/${p.gameSlug}/${p.setCode}/${p.productSlug}`, freq: "daily", pri: "0.8" });
      const s = `${p.gameSlug}/${p.setCode}`;
      if (!seenSet.has(s)) {
        seenSet.add(s);
        urls.push({ loc: `${BASE}/${s}`, freq: "daily", pri: "0.6" });
      }
    }
    // Set pages for tracked-but-unranked sets (card-list fallbacks) too.
    const db = getDb();
    // Pokédex species pages — every Pokémon that has at least one card.
    const species = await db.execute<{ slug: string }>(sql`
      select p.slug from pokemon_species p
      where exists (select 1 from card_species cs where cs.species_id = p.id) order by p.id`);
    for (const r of [...species]) urls.push({ loc: `${BASE}/pokedex/${r.slug}`, freq: "weekly", pri: "0.6" });
    const extra = await db.execute<{ slug: string; code: string }>(sql`
      select g.slug, s.code from sets s
      join games g on g.id = s.game_id
      where exists (select 1 from cards c where c.set_id = s.id)
        and not exists (select 1 from sealed_products sp where sp.set_id = s.id)`);
    for (const r of [...extra]) {
      const s = `${r.slug}/${encodeURIComponent(r.code)}`;
      if (!seenSet.has(`${r.slug}/${r.code}`)) urls.push({ loc: `${BASE}/${s}`, freq: "weekly", pri: "0.4" });
    }
    return xml(urls);
  }

  const m = /^cards-(\d+)$/.exec(name);
  if (!m) return new Response("not found", { status: 404 });
  const shard = Number(m[1]);
  const db = getDb();
  // Every card >= $1 in every set of every game — ranked or not; the card
  // route renders them all (payload path or DB fallback).
  const rows = await db.execute<{ slug: string; code: string; number: string }>(sql`
    select g.slug, s.code, c.number
    from cards c
    join sets s on s.id = c.set_id
    join games g on g.id = s.game_id
    join latest_prices lp on lp.card_id = c.id and lp.kind = ${"raw"}
    group by g.slug, s.code, c.number
    having max(lp.price_cents) >= 100
    order by g.slug, s.code, c.number
    limit ${CARDS_PER_SHARD} offset ${shard * CARDS_PER_SHARD}`);
  return xml(
    [...rows].map((r) => ({
      loc: `${BASE}/${r.slug}/${encodeURIComponent(r.code)}/card/${encodeURIComponent(r.number)}`,
      freq: "weekly",
      pri: "0.6",
    })),
  );
}
