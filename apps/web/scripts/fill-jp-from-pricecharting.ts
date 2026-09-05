/**
 * Japanese Pokémon sets Scrydex carries with NO card data (most of Sword &
 * Shield and earlier — Eevee Heroes, Shiny Star V, VMAX Climax…), filled from
 * PriceCharting's "Pokemon Japanese <English set name>" consoles: English card
 * name + number + live price per row. Japanese names for Pokémon cards come
 * back through the official species dictionary (Umbreon VMAX -> ブラッキーVMAX);
 * trainers keep the English name. Images: Limitless's JP card CDN, verified
 * per card with a HEAD request so a wrong guess never ships as a broken image.
 * Rarity is "unknown" (no source states it) — nothing here enters EV.
 *
 * Console mapping: Scrydex's English translation of the set name, else an
 * explicit table for pre-Scrydex sets; a mapping is used only when the console
 * has at least 10 priced rows.
 */
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { cards, games, getDb, latestPrices, priceSnapshots, sets } from "@/lib/db";

const CSV = process.argv[2]!;
const JA_LIST = process.argv[3]!; // scrydex-pokemon-ja.json from audit-inventory
const LIMITLESS = "https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc";
const norm = (n: string) => n.replace(/^0+(?=\d)/, "");
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Pre-Scrydex sets: our code -> PriceCharting console suffix (standard English titles). */
const MANUAL: Record<string, string> = {
  DP1: "Space-Time", DP2: "Secret of the Lakes", DP3: "Shining Darkness", DP4D: "Dawn Dash", DP4M: "Moonlit Pursuit",
  DP5C: "Cry from the Mysterious", DP5T: "Temple of Anger", DP6: "Intense Fight in the Destroyed Sky",
  PT1: "Galactic's Conquest", PT2: "Bonds to the End of Time", L1a: "HeartGold Collection", L1b: "SoulSilver Collection", LL: "Lost Link",
  ADV1: "EX Ruby & Sapphire Expansion Pack", ADV2: "Miracle of the Desert", ADV3: "Rulers of the Heavens", ADV4: "Magma VS Aqua: Two Ambitions", ADV5: "Undone Seal",
  PCG10: "World Champions Pack", ECARD1: "Expansion Pack", ECARD2: "The Town on No Map", ECARD3: "Wind from the Sea", ECARD4: "Split Earth", ECARD5: "Mysterious Mountains",
  GYM1: "Leaders' Stadium", GYM2: "Challenge from the Darkness", BASE1: "Expansion Pack", BASE2: "Jungle", BASE3: "Mystery of the Fossils", BASE4: "Rocket Gang",
  VND1: "Vending", VND2: "Vending", VND3: "Vending", EBB1: "EX Battle Boost", XY: "Best of XY", CP4: "Premium Champion Pack", CP5: "Dream Shine Collection",
  SM0: "Collection Sun", SMP2: "Detective Pikachu",
  // Sword & Shield era + SM/XY sub-sets: Scrydex lists these expansions with no
  // cards and no English translation; PriceCharting's console titles are the
  // standard English names.
  S1W: "Sword", S1H: "Shield", S1a: "VMAX Rising", S2: "Rebel Clash", S2a: "Explosive Walker", S3: "Infinity Zone", S3a: "Legendary Heartbeat",
  S4: "Amazing Volt Tackle", S4a: "Shiny Star V", S5I: "Single Strike Master", S5R: "Rapid Strike Master", S5a: "Matchless Fighter",
  S6H: "Silver Lance", S6K: "Jet-Black Spirit", S6a: "Eevee Heroes", S7R: "Blue Sky Stream", S7D: "Skyscraping Perfection", S8: "Fusion Arts",
  S8a: "25th Anniversary Collection", S8b: "VMAX Climax", S10D: "Time Gazer", S10P: "Space Juggler", S10a: "Dark Phantasma", S10b: "Pokemon GO",
  S11: "Lost Abyss", S11a: "Incandescent Arcana",
  "SM1+": "Strength Expansion Pack Sun & Moon", "sm2+": "Facing a New Trial", "SM3+": "Shining Legends", "SM4+": "GX Battle Boost", "SM5+": "Ultra Force",
  XY1a: "Collection X", XY1b: "Collection Y", XY5a: "Gaia Volcano", XY5b: "Tidal Storm", XY8a: "Blue Shock", XY11a: "Fever-Burst Fighter", XY11b: "Cruel Traitor",
};

function splitRow(line: string): { console: string; product: string; cents: number | null } | null {
  const first = line.indexOf(",");
  if (first < 0) return null;
  let rest = line.slice(first + 1);
  const take = () => { let v: string; if (rest.startsWith('"')) { const e = rest.indexOf('"', 1); v = rest.slice(1, e); rest = rest.slice(e + 2); } else { const e = rest.indexOf(","); v = rest.slice(0, e); rest = rest.slice(e + 1); } return v; };
  const consoleName = take(); const product = take();
  const dollars = Number(rest.split(",")[0]!.replace(/[$"]/g, ""));
  return { console: consoleName, product, cents: Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null };
}

async function speciesReverse(): Promise<Map<string, string>> {
  const csv = await fetch("https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv").then((r) => r.text());
  const en = new Map<number, string>(), ja = new Map<number, string>();
  for (const line of csv.split("\n").slice(1)) {
    const m = /^(\d+),(\d+),("(?:[^"]|"")*"|[^,]*)/.exec(line); if (!m) continue;
    const id = Number(m[1]), lang = Number(m[2]); const name = m[3]!.replace(/^"|"$/g, "").replace(/""/g, '"');
    if (lang === 9) en.set(id, name); if (lang === 1) ja.set(id, name);
  }
  const out = new Map<string, string>();
  for (const [id, e] of en) { const j = ja.get(id); if (j) out.set(e.toLowerCase(), j); }
  return out;
}
const SUFFIX = /\s+(ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.X)$/;
function jaName(en: string, dict: Map<string, string>): string | null {
  const m = SUFFIX.exec(en); const base = m ? en.slice(0, -m[0].length) : en;
  const j = dict.get(base.trim().toLowerCase());
  return j ? j + (m ? m[1] : "") : null;
}
async function head(url: string): Promise<boolean> {
  try { const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10000) }); return r.ok; } catch { return false; }
}

async function main() {
  const db = getDb();
  const [pk] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  const ja: { id: string; en?: string; name: string }[] = JSON.parse(readFileSync(JA_LIST, "utf8"));
  const enByCode = new Map(ja.map((e) => [e.id.replace(/_ja$/, "").toLowerCase(), e.en ?? ""]));

  const rowsByConsole = new Map<string, { name: string; number: string; cents: number }[]>();
  for (const line of readFileSync(CSV, "utf8").split("\n").slice(1)) {
    const r = splitRow(line);
    if (!r || r.cents === null || !r.console.startsWith("Pokemon Japanese ")) continue;
    const suffix = r.console.slice("Pokemon Japanese ".length).trim();
    const m = /^(.*?)\s*(?:\[[^\]]*\]\s*)?#\s*([A-Za-z0-9]+)(?:\/[A-Za-z0-9-]+)?\s*$/.exec(r.product.trim());
    if (!m) continue;
    const k = key(suffix);
    if (!rowsByConsole.has(k)) rowsByConsole.set(k, []);
    rowsByConsole.get(k)!.push({ name: m[1]!.trim(), number: norm(m[2]!), cents: r.cents });
  }
  const dict = await speciesReverse();

  const empty = await db.execute<{ id: string; code: string; name: string }>(sql`
    select s.id, s.code, s.name from sets s
    where s.game_id = ${pk!.id} and s.language = 'JP' and not exists (select 1 from cards c where c.set_id = s.id)
    order by s.release_date desc nulls last`);
  let setsDone = 0, cardsDone = 0, imaged = 0, unmapped: string[] = [];
  for (const s of [...empty]) {
    const en = MANUAL[s.code] ?? enByCode.get(s.code.toLowerCase()) ?? "";
    let rows = en ? rowsByConsole.get(key(en)) : undefined;
    if (!rows && en) { // tolerate "ex"/"EX" and punctuation differences
      const k = key(en); const alt = [...rowsByConsole.keys()].find((c) => c === k.replace(/ ex$/, "") || c === `${k} ex`);
      if (alt) rows = rowsByConsole.get(alt);
    }
    if (!rows || rows.length < 10) { unmapped.push(`${s.code}(${en || s.name})`); continue; }
    // One row per number: keep the priciest printing's price, first-seen name.
    const byNum = new Map<string, { name: string; cents: number }>();
    for (const r of rows) { const ex = byNum.get(r.number); if (!ex || r.cents > ex.cents) byNum.set(r.number, { name: r.name, cents: r.cents }); }
    const toInsert = [...byNum.entries()].map(([number, v]) => ({
      setId: s.id, number, name: jaName(v.name, dict) ?? v.name, treatment: "base", rarity: "unknown",
      imageUrl: null as string | null, externalIds: { name_en: v.name, pricecharting_console: en },
    }));
    // Images: Limitless JP CDN, verified. 8 at a time.
    for (let i = 0; i < toInsert.length; i += 8) {
      await Promise.all(toInsert.slice(i, i + 8).map(async (c) => {
        if (!/^\d+$/.test(c.number)) return;
        const url = `${LIMITLESS}/${s.code}/${s.code}_${c.number}_R_JP.png`;
        if (await head(url)) { c.imageUrl = url; imaged++; }
      }));
    }
    for (let j = 0; j < toInsert.length; j += 500) await db.insert(cards).values(toInsert.slice(j, j + 500)).onConflictDoNothing();
    const written = await db.select({ id: cards.id, number: cards.number }).from(cards).where(and(eq(cards.setId, s.id), eq(cards.treatment, "base")));
    const pr = written.flatMap((w) => { const v = byNum.get(w.number); return v ? [{ cardId: w.id, sourceId: "pricecharting_ebay", priceCents: v.cents, kind: "raw" as const, capturedAt: new Date() }] : []; });
    for (let j = 0; j < pr.length; j += 500) {
      const chunk = pr.slice(j, j + 500);
      await db.insert(priceSnapshots).values(chunk);
      await db.insert(latestPrices).values(chunk).onConflictDoUpdate({
        target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind], targetWhere: sql`card_id is not null`,
        set: { priceCents: sql`excluded.price_cents`, capturedAt: sql`excluded.captured_at`, updatedAt: new Date() },
      });
    }
    await db.update(sets).set({ externalIds: sql`external_ids || ${JSON.stringify({ pricecharting: en })}::jsonb` }).where(eq(sets.id, s.id));
    setsDone++; cardsDone += toInsert.length;
    console.log(`  + ${s.code} ${s.name} <- "${en}": ${toInsert.length} cards, ${pr.length} priced, ${toInsert.filter((c) => c.imageUrl).length} imaged`);
  }
  console.log(`\nJP from PriceCharting: ${setsDone} sets, ${cardsDone} cards, ${imaged} imaged`);
  console.log(`unmapped (${unmapped.length}):`, unmapped.join(" | "));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
