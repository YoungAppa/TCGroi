/**
 * Second ZH english-names pass for what the species pass missed: Chinese card
 * names glue regional forms onto the species with no space (阿罗拉九尾 ->
 * Alolan Ninetales), and SWSH-era prefixes/suffixes the first regex didn't
 * carry (光辉 Radiant, V-UNION). Same PokéAPI zh-Hans dictionary, applied to
 * cards still lacking external_ids->name_en only.
 */
import { and, eq, sql } from "drizzle-orm";
import { cards, games, getDb, sets } from "@/lib/db";

async function speciesDict(): Promise<Map<string, string>> {
  const dict = new Map<string, string>();
  const list = await fetch("https://pokeapi.co/api/v2/pokemon-species?limit=2000", { signal: AbortSignal.timeout(30000) }).then((r) => r.json());
  const urls: string[] = list.results.map((r: { url: string }) => r.url);
  for (let i = 0; i < urls.length; i += 20) {
    const chunk = await Promise.all(
      urls.slice(i, i + 20).map(async (u) => {
        try {
          const d = await fetch(u, { signal: AbortSignal.timeout(30000) }).then((r) => r.json());
          const en = d.names.find((n: any) => n.language.name === "en")?.name;
          const out: (readonly [string, string])[] = [];
          for (const lang of ["zh-hans", "zh-hant"]) {
            const zh = d.names.find((n: any) => n.language.name === lang)?.name;
            if (zh && en) out.push([zh, en] as const);
          }
          return out;
        } catch { return null; }
      }),
    );
    for (const pairs of chunk) for (const [zh, en] of pairs ?? []) dict.set(zh, en);
  }
  return dict;
}

const PREFIX: [string, string][] = [
  ["阿罗拉", "Alolan"], ["伽勒尔", "Galarian"], ["洗翠", "Hisuian"], ["帕底亚", "Paldean"], ["光辉", "Radiant"],
];
const SUFFIX = /(ex|EX|GX|V-UNION|VMAX|VSTAR|V)$/;

async function main() {
  const db = getDb();
  const [pk] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  const zhSets = await db.select({ id: sets.id }).from(sets)
    .where(and(eq(sets.gameId, pk!.id), eq(sets.language, "ZH")));

  const dict = await speciesDict();
  console.log(`species dict: ${dict.size} zh names`);

  let named = 0;
  for (const s of zhSets) {
    const ours = await db.select({ id: cards.id, name: cards.name, ext: cards.externalIds }).from(cards).where(eq(cards.setId, s.id));
    const updates: { id: string; en: string }[] = [];
    for (const c of ours) {
      if ((c.ext as Record<string, unknown>)["name_en"]) continue;
      let base = c.name.trim().replace(/\s+/g, "");
      const sm = SUFFIX.exec(base);
      const suffix = sm ? sm[1]! : "";
      if (sm) base = base.slice(0, -suffix.length);
      let prefixEn = "";
      for (const [zh, en] of PREFIX) {
        if (base.startsWith(zh)) { prefixEn = en; base = base.slice(zh.length); break; }
      }
      const en = dict.get(base);
      if (!en) continue;
      updates.push({ id: c.id, en: [prefixEn, en, suffix].filter(Boolean).join(" ") });
    }
    named += updates.length;
    for (let i = 0; i < updates.length; i += 500) {
      const chunk = updates.slice(i, i + 500);
      await db.execute(sql`
        update cards set external_ids = external_ids || jsonb_build_object('name_en', v.en), updated_at = now()
        from (select unnest(${sql.raw(`array[${chunk.map((u) => `'${u.id}'::uuid`).join(",")}]`)}) as id,
                     unnest(${sql.raw(`array[${chunk.map((u) => `'${u.en.replace(/'/g, "''")}'`).join(",")}]`)}) as en) v
        where cards.id = v.id`);
    }
  }
  console.log(`ZH pass 2: ${named} more cards named`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
