// Dumps set inventory + authoritative expansion lists to files (never console.log
// a multi-MB string then process.exit — stdout truncates).
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
const OUT = process.argv[2]!;
const H = { "X-Api-Key": process.env.TCGPLAYER_MIRROR_API_KEY!, "X-Team-ID": process.env.SCRYDEX_TEAM_ID!, accept: "application/json" };
async function scryAll(game: string, q: string) {
  const out: any[] = [];
  for (let page = 1; page < 40; page++) {
    const r = await fetch(`https://api.scrydex.com/${game}/v1/expansions?q=${encodeURIComponent(q)}&page=${page}&page_size=100`, { headers: H, signal: AbortSignal.timeout(30000) });
    if (!r.ok) { out.push({ error: r.status }); break; }
    const d = await r.json();
    out.push(...(d.data ?? []));
    if ((d.data ?? []).length < 100) break;
  }
  return out;
}
async function main() {
  const db = getDb();
  const r = await db.execute(sql`select g.slug as game, s.language, s.code, s.name, s.release_date::text as released, s.external_ids as ext,
    (select count(*) from cards c where c.set_id=s.id)::int as cards, (select count(*) from sealed_products p where p.set_id=s.id)::int as products
    from sets s join games g on g.id=s.game_id order by 1,2,5 desc nulls last`);
  writeFileSync(`${OUT}/db-sets.json`, JSON.stringify([...r]));
  const lists: Record<string, any[]> = {
    "scrydex-pokemon-en": await scryAll("pokemon", "language_code:en"),
    "scrydex-pokemon-ja": await scryAll("pokemon", "language_code:ja"),
    "scrydex-onepiece": await scryAll("onepiece", ""),
  };
  for (const [k, v] of Object.entries(lists)) {
    writeFileSync(`${OUT}/${k}.json`, JSON.stringify(v.map((e: any) => ({ id: e.id, code: e.code, name: e.name, en: e.translation?.en?.name, series: e.series, release: e.release_date, total: e.total ?? e.printed_total, lang: e.language_code, error: e.error }))));
    console.log(k, v.length);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
