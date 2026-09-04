/**
 * English names for every Japanese card, from Scrydex's official translation
 * field (translation.en.name). Stored as external_ids->name_en — the native
 * name stays the primary display, per the site's names-stay-in-their-language
 * rule; English becomes searchable and rides as a subtitle.
 */
import { and, eq, sql } from "drizzle-orm";
import { cards, games, getDb, sets } from "@/lib/db";

const H = { "X-Api-Key": process.env.TCGPLAYER_MIRROR_API_KEY!, "X-Team-ID": process.env.SCRYDEX_TEAM_ID!, accept: "application/json" };
const norm = (n: string) => n.replace(/^0+(?=\d)/, "");

async function scry(path: string): Promise<any> {
  for (let i = 1; i <= 4; i++) {
    try {
      const r = await fetch(`https://api.scrydex.com/pokemon/v1/${path}`, { headers: H, signal: AbortSignal.timeout(30000) });
      if (r.status === 404 || r.status === 400) return null; // odd set codes 400 — skip them
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (i === 4) throw e; await new Promise((res) => setTimeout(res, i * 1500)); }
  }
}

async function main() {
  const db = getDb();
  const [pk] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  const jpSets = await db.select({ id: sets.id, code: sets.code }).from(sets)
    .where(and(eq(sets.gameId, pk!.id), eq(sets.language, "JP")));

  let setsDone = 0, named = 0, unmatchedSets = 0;
  for (const s of jpSets) {
    const search = await scry(`expansions?q=${encodeURIComponent(`language_code:ja code:${s.code.toLowerCase()}`)}&page_size=2`);
    const expId = search?.data?.[0]?.id;
    if (!expId) { unmatchedSets++; continue; }

    const ours = await db.select({ id: cards.id, number: cards.number }).from(cards).where(eq(cards.setId, s.id));
    const byNum = new Map<string, string[]>();
    for (const c of ours) {
      const k = norm(c.number);
      byNum.set(k, [...(byNum.get(k) ?? []), c.id]);
    }

    const updates: { id: string; en: string }[] = [];
    for (let page = 1; ; page++) {
      const res = await scry(`expansions/${encodeURIComponent(expId)}/cards?page=${page}&page_size=250`);
      const rows = res?.data ?? [];
      for (const c of rows) {
        const en = c?.translation?.en?.name;
        if (!en || !c.number) continue;
        for (const id of byNum.get(norm(String(c.number))) ?? []) updates.push({ id, en });
      }
      const total = res?.total_count ?? 0;
      if (rows.length === 0 || page * 250 >= total) break;
    }

    // Batched: one statement per 500 cards instead of one per card.
    for (let i = 0; i < updates.length; i += 500) {
      const chunk = updates.slice(i, i + 500);
      await db.execute(sql`
        update cards set external_ids = external_ids || jsonb_build_object('name_en', v.en), updated_at = now()
        from (select unnest(${sql.raw(`array[${chunk.map((u) => `'${u.id}'::uuid`).join(",")}]`)}) as id,
                     unnest(${sql.raw(`array[${chunk.map((u) => `'${u.en.replace(/'/g, "''")}'`).join(",")}]`)}) as en) v
        where cards.id = v.id`);
    }
    named += updates.length;
    setsDone++;
    if (setsDone % 25 === 0) console.log(`  ${setsDone}/${jpSets.length} sets, ${named} named`);
  }
  console.log(`JP english names: ${named} cards across ${setsDone} sets (${unmatchedSets} sets had no scrydex match)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
