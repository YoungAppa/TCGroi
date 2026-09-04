/**
 * Second JP english-names pass, for the 174 sets Scrydex doesn't carry.
 * TCGdex (where our JP catalog lives — sets carry external_ids->tcgdex) is
 * multilingual: /v2/en/sets/{id} returns the same set with official English
 * card names when a translation exists. One request per set, trainers included.
 * Whatever TCGdex can't translate falls back to PokéAPI species names
 * (ja/ja-Hrkt -> en) with the suffix carried through (リーフィアex -> Leafeon ex).
 */
import { and, eq, sql } from "drizzle-orm";
import { cards, games, getDb, sets } from "@/lib/db";

const norm = (n: string) => n.replace(/^0+(?=\d)/, "");

async function tcgdexEn(id: string): Promise<Map<string, string> | null> {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null; // no English translation of this set
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const m = new Map<string, string>();
      for (const c of d?.cards ?? []) if (c?.localId != null && c?.name) m.set(norm(String(c.localId)), String(c.name));
      return m;
    } catch (e) { if (i === 3) return null; await new Promise((res) => setTimeout(res, i * 1500)); }
  }
  return null;
}

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
          if (!en) return null;
          const out: (readonly [string, string])[] = [];
          for (const lang of ["ja", "ja-hrkt"]) {
            const jp = d.names.find((n: any) => n.language.name === lang)?.name;
            if (jp) out.push([jp, en] as const);
          }
          return out;
        } catch { return null; }
      }),
    );
    for (const pairs of chunk) for (const [jp, en] of pairs ?? []) dict.set(jp, en);
  }
  return dict;
}

const SUFFIX = /(ex|EX|GX|V-UNION|VMAX|VSTAR|V|BREAK|LV\.X|δ)$/;

async function main() {
  const db = getDb();
  const [pk] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  const jpSets = await db.select({ id: sets.id, code: sets.code, ext: sets.externalIds }).from(sets)
    .where(and(eq(sets.gameId, pk!.id), eq(sets.language, "JP")));

  const dict = await speciesDict();
  console.log(`species dict: ${dict.size} ja names`);

  let byDex = 0, bySpecies = 0, setsWithDex = 0, noDexId = 0;
  for (const s of jpSets) {
    const ours = await db.select({ id: cards.id, name: cards.name, number: cards.number, ext: cards.externalIds }).from(cards).where(eq(cards.setId, s.id));
    const missing = ours.filter((c) => !(c.ext as Record<string, unknown>)["name_en"]);
    if (missing.length === 0) continue;

    const updates: { id: string; en: string }[] = [];
    const dexId = (s.ext as Record<string, string>)["tcgdex"];
    if (!dexId) noDexId++;
    const enByNum = dexId ? await tcgdexEn(dexId) : null;
    if (enByNum) {
      setsWithDex++;
      for (const c of missing) {
        const en = enByNum.get(norm(c.number));
        if (en) updates.push({ id: c.id, en });
      }
      byDex += updates.length;
    }

    const covered = new Set(updates.map((u) => u.id));
    for (const c of missing) {
      if (covered.has(c.id)) continue;
      const m = SUFFIX.exec(c.name.trim());
      const base = m ? c.name.trim().slice(0, -m[1]!.length).trim() : c.name.trim();
      const en = dict.get(base);
      if (en) { updates.push({ id: c.id, en: m ? `${en} ${m[1]}` : en }); bySpecies++; }
    }

    for (let i = 0; i < updates.length; i += 500) {
      const chunk = updates.slice(i, i + 500);
      await db.execute(sql`
        update cards set external_ids = external_ids || jsonb_build_object('name_en', v.en), updated_at = now()
        from (select unnest(${sql.raw(`array[${chunk.map((u) => `'${u.id}'::uuid`).join(",")}]`)}) as id,
                     unnest(${sql.raw(`array[${chunk.map((u) => `'${u.en.replace(/'/g, "''")}'`).join(",")}]`)}) as en) v
        where cards.id = v.id`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`JP pass 2: ${byDex} via TCGdex-en (${setsWithDex} sets translated), ${bySpecies} via species dict; ${noDexId} sets had no tcgdex id`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
