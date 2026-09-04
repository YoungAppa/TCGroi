/**
 * English names for Simplified-Chinese cards, two passes:
 *  1. PokéAPI's official species localizations (zh-Hans -> en) — covers every
 *     Pokémon card whose Chinese name is a species (+ex/GX/V suffixes).
 *  2. PriceCharting's English rows matched by number — covers priced cards
 *     including trainers, and anything pass 1 missed.
 * Stored as external_ids->name_en; native names stay primary.
 */
import { and, eq, sql } from "drizzle-orm";
import { cards, games, getDb, sets } from "@/lib/db";

const norm = (n: string) => n.replace(/^0+(?=\d)/, "");

async function speciesDict(): Promise<Map<string, string>> {
  const dict = new Map<string, string>();
  // PokéAPI: ~1100 species, names in every official language.
  const list = await fetch("https://pokeapi.co/api/v2/pokemon-species?limit=2000", { signal: AbortSignal.timeout(30000) }).then((r) => r.json());
  const urls: string[] = list.results.map((r: { url: string }) => r.url);
  let done = 0;
  for (let i = 0; i < urls.length; i += 20) {
    const chunk = await Promise.all(
      urls.slice(i, i + 20).map(async (u) => {
        try {
          const d = await fetch(u, { signal: AbortSignal.timeout(30000) }).then((r) => r.json());
          const zh = d.names.find((n: any) => n.language.name === "zh-Hans")?.name;
          const en = d.names.find((n: any) => n.language.name === "en")?.name;
          return zh && en ? ([zh, en] as const) : null;
        } catch { return null; }
      }),
    );
    for (const c of chunk) if (c) dict.set(c[0], c[1]);
    done += 20;
    if (done % 400 === 0) console.log(`  species ${done}/${urls.length}`);
  }
  return dict;
}

interface PcRow { "product-name"?: string; "console-name"?: string }

async function main() {
  const db = getDb();
  const [pk] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  const zhSets = await db.select({ id: sets.id, code: sets.code, ext: sets.externalIds }).from(sets)
    .where(and(eq(sets.gameId, pk!.id), eq(sets.language, "ZH")));

  const dict = await speciesDict();
  console.log(`species dict: ${dict.size} zh-Hans names`);

  // Suffixes that ride through: 皮卡丘ex -> "Pikachu ex" etc.
  const SUFFIX = /(ex|EX|GX|V|VMAX|VSTAR|BREAK)$/;

  let bySpecies = 0, byPc = 0;
  for (const s of zhSets) {
    const ours = await db.select({ id: cards.id, name: cards.name, number: cards.number, ext: cards.externalIds }).from(cards).where(eq(cards.setId, s.id));
    const updates: { id: string; en: string }[] = [];

    // Pass 1: species dictionary.
    for (const c of ours) {
      if ((c.ext as Record<string, unknown>)["name_en"]) continue;
      const m = SUFFIX.exec(c.name.trim());
      const base = m ? c.name.trim().slice(0, -m[1]!.length).trim() : c.name.trim();
      const en = dict.get(base);
      if (en) updates.push({ id: c.id, en: m ? `${en} ${m[1]}` : en });
    }
    bySpecies += updates.length;

    // Pass 2: PriceCharting English rows for whatever remains.
    const suffix = (s.ext as Record<string, string>)["pricecharting"];
    if (suffix) {
      const covered = new Set(updates.map((u) => u.id));
      const remaining = ours.filter((c) => !covered.has(c.id) && !(c.ext as Record<string, unknown>)["name_en"]);
      if (remaining.length > 0) {
        try {
          const r = await fetch(
            `https://www.pricecharting.com/api/products?t=${process.env.PRICECHARTING_TOKEN}&q=${encodeURIComponent(`pokemon chinese ${suffix}`)}`,
            { signal: AbortSignal.timeout(30000) },
          );
          const rows = (((await r.json()) as { products?: PcRow[] }).products ?? []);
          const consoleName = `pokemon chinese ${suffix}`.toLowerCase();
          const enByNum = new Map<string, string>();
          for (const p of rows) {
            if ((p["console-name"] ?? "").trim().toLowerCase() !== consoleName) continue;
            const m = /^(.*?)(?:\s*\[[^\]]+\])?\s*#\s*([A-Za-z0-9]+)\s*$/.exec((p["product-name"] ?? "").trim());
            if (m) enByNum.set(norm(m[2]!), m[1]!.trim());
          }
          for (const c of remaining) {
            const en = enByNum.get(norm(c.number));
            if (en) { updates.push({ id: c.id, en }); byPc++; }
          }
        } catch { /* PC hiccup: species names still land */ }
      }
    }

    for (let i = 0; i < updates.length; i += 500) {
      const chunk = updates.slice(i, i + 500);
      await db.execute(sql`
        update cards set external_ids = external_ids || jsonb_build_object('name_en', v.en), updated_at = now()
        from (select unnest(${sql.raw(`array[${chunk.map((u) => `'${u.id}'::uuid`).join(",")}]`)}) as id,
                     unnest(${sql.raw(`array[${chunk.map((u) => `'${u.en.replace(/'/g, "''")}'`).join(",")}]`)}) as en) v
        where cards.id = v.id`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`ZH english names: ${bySpecies} via species dict, ${byPc} via PriceCharting`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
