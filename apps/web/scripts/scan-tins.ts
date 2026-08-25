/** Dry-run: every EN "tin" Scrydex lists, with parsed pack count + set attribution. */
import { eq, and } from "drizzle-orm";
import { games, getDb, sets, pullRateTables } from "@/lib/db";

const H = { "X-Api-Key": process.env.TCGPLAYER_MIRROR_API_KEY!, "X-Team-ID": process.env.SCRYDEX_TEAM_ID!, accept: "application/json" };

async function main() {
  const db = getDb();
  const [pk] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  const ranked = await db.select({ code: sets.code, name: sets.name, ext: sets.externalIds })
    .from(sets).innerJoin(pullRateTables, and(eq(pullRateTables.setId, sets.id), eq(pullRateTables.isActive, true)))
    .where(and(eq(sets.gameId, pk!.id), eq(sets.language, "EN")));

  let own = 0, assorted = 0, mini = 0, noCount = 0;
  for (const s of ranked) {
    const expId = (s.ext as Record<string, string>)["pokemontcg_io"] ?? s.code;
    const r = await fetch(`https://api.scrydex.com/pokemon/v1/expansions/${encodeURIComponent(expId)}/sealed?page_size=100`, { headers: H });
    if (!r.ok) continue;
    const items = ((await r.json()).data ?? []) as { name?: string; description?: string }[];
    for (const i of items) {
      const name = i.name ?? "";
      if (!/\btin\b/i.test(name) || /\bcase\b|display|bundle/i.test(name)) continue;
      const d = String(i.description ?? "").replace(/\s+/g, " ");
      if (/mini tin/i.test(name)) { mini++; continue; }
      const m = /(\d+)\s+Pok[eé]mon TCG(?::\s*([^•]*?))?\s*booster packs?/i.exec(d);
      if (!m) { noCount++; console.log(`  ?count [${s.code}] ${name}`); continue; }
      const statedSet = (m[2] ?? "").trim();
      const isOwn = statedSet.toLowerCase().includes(s.name.toLowerCase());
      if (isOwn) own++; else assorted++;
      console.log(`  ${isOwn ? "OWN " : "ASST"} [${s.code}] ${m[1]}pk ${name}${statedSet ? ` (packs: "${statedSet.slice(0,40)}")` : " (unstated)"}`);
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  console.log(`\nown-set:${own} assorted:${assorted} mini(skipped):${mini} unparseable:${noCount}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
