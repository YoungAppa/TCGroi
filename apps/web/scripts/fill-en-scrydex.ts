/**
 * English Pokémon sets the catalog lacks or holds empty, filled from Scrydex:
 * the sets pokemontcg.io returned no cards for (Stormfront, Deoxys, Power
 * Keepers, SV Energies, McDonald's 2014-18, EX Trainer Kits, Astral Radiance
 * Trainer Gallery) plus sets it never had (Mega Evolution Black Star Promos +
 * Energies, McDonald's 2023/24, the three Classic decks, every Trainer Kit,
 * the Poké Card Creator pack). Rarity is normalized where our vocab knows the
 * name, else the raw Scrydex label; prices are USD raw market (tcgplayer_market).
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/fill-en-scrydex.ts [ids...]
 */
import { and, eq, sql } from "drizzle-orm";
import { cards, games, getDb, latestPrices, priceSnapshots, sets } from "@/lib/db";
import { normalizePokemonRarity } from "@/lib/catalog/normalize";

const DEFAULT_IDS = [
  "dp7", "ex8", "ex16", "sve", "mcd14", "mcd15", "mcd16", "mcd17", "mcd18", "tk1a", "tk1b", "tk2a", "tk2b", "swsh10tg",
  "mep", "mee", "mcd23", "mcd24", "clv", "clc", "clb", "wb1",
  "tk3a", "tk3b", "tk4a", "tk4b", "tk5a", "tk5b", "tk6a", "tk6b", "tk7a", "tk7b", "tk8a", "tk8b", "tk9a", "tk9b", "tk10a", "tk10b",
];
const H = { "X-Api-Key": process.env.TCGPLAYER_MIRROR_API_KEY!, "X-Team-ID": process.env.SCRYDEX_TEAM_ID!, accept: "application/json" };
const CONDITION_ORDER = ["NM", "LP", "MP", "HP", "DM"];

function rawDollars(prices: Record<string, unknown>[] | undefined): number | null {
  if (!prices?.length) return null;
  const raws = prices.filter((p) => String(p.type ?? "raw").toLowerCase() === "raw" && String(p.currency ?? "USD").toUpperCase() === "USD");
  for (const cond of CONDITION_ORDER) {
    const e = raws.find((p) => p.condition === cond);
    const v = (e?.market ?? e?.low ?? e?.mid) as number | undefined;
    if (typeof v === "number" && v > 0) return v;
  }
  const any = raws.find((p) => typeof p.market === "number" && (p.market as number) > 0);
  return any ? (any.market as number) : null;
}
async function scry(path: string): Promise<any> {
  for (let i = 1; i <= 4; i++) {
    try {
      const r = await fetch(`https://api.scrydex.com/pokemon/v1/${path}`, { headers: H, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (i === 4) throw e; await new Promise((res) => setTimeout(res, i * 1500)); }
  }
}

async function main() {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_IDS;
  const db = getDb();
  const [pk] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  let setsDone = 0, cardsDone = 0, pricesDone = 0;
  for (const id of ids) {
    const exp = (await scry(`expansions/${encodeURIComponent(id)}`))?.data;
    if (!exp) { console.log(`  ${id}: not on Scrydex`); continue; }
    const all: any[] = [];
    for (let page = 1; page < 20; page++) {
      const res = await scry(`expansions/${encodeURIComponent(id)}/cards?include=prices&page=${page}&page_size=250`);
      const rows = res?.data ?? [];
      all.push(...rows);
      if (rows.length < 250) break;
    }
    if (all.length === 0) { console.log(`  ${id}: 0 cards on Scrydex`); continue; }
    const [setRow] = await db.insert(sets).values({
      gameId: pk!.id, code: id, name: exp.name, language: "EN",
      releaseDate: exp.release_date ? String(exp.release_date).replace(/\//g, "-") : null,
      externalIds: { scrydex: exp.id },
    }).onConflictDoUpdate({
      target: [sets.gameId, sets.code, sets.language],
      set: { name: sql`excluded.name`, releaseDate: sql`coalesce(excluded.release_date, ${sets.releaseDate})`, externalIds: sql`${sets.externalIds} || excluded.external_ids`, updatedAt: new Date() },
    }).returning({ id: sets.id });
    if (!setRow) continue;
    setsDone++;
    const priceByNumber = new Map<string, number>();
    const toInsert = all.flatMap((c) => {
      const number = String(c.number ?? c.id.split("-").pop() ?? "").trim();
      if (!number) return [];
      const img = c.images?.find((x: any) => x.type === "front") ?? c.images?.[0];
      let dollars: number | null = null;
      for (const v of c.variants ?? []) { dollars = rawDollars(v.prices); if (dollars !== null) break; }
      if (dollars !== null) priceByNumber.set(number, Math.round(dollars * 100));
      const rawRarity = String(c.rarity ?? c.rarity_code ?? "").trim();
      return [{
        setId: setRow.id, number, name: String(c.name ?? c.id), treatment: "base",
        rarity: normalizePokemonRarity(rawRarity) ?? (rawRarity && rawRarity !== "None" ? rawRarity : "unknown"),
        imageUrl: img?.large ?? img?.medium ?? null, externalIds: { scrydex: c.id },
      }];
    });
    for (let j = 0; j < toInsert.length; j += 500) {
      await db.insert(cards).values(toInsert.slice(j, j + 500)).onConflictDoUpdate({
        target: [cards.setId, cards.number, cards.treatment],
        set: { name: sql`excluded.name`, rarity: sql`excluded.rarity`, imageUrl: sql`coalesce(excluded.image_url, ${cards.imageUrl})`, externalIds: sql`${cards.externalIds} || excluded.external_ids`, updatedAt: new Date() },
      });
    }
    cardsDone += toInsert.length;
    const written = await db.select({ id: cards.id, number: cards.number }).from(cards).where(and(eq(cards.setId, setRow.id), eq(cards.treatment, "base")));
    const pr = written.flatMap((w) => { const cents = priceByNumber.get(w.number); return cents ? [{ cardId: w.id, sourceId: "tcgplayer_market", priceCents: cents, kind: "raw" as const, capturedAt: new Date() }] : []; });
    for (let j = 0; j < pr.length; j += 500) {
      const chunk = pr.slice(j, j + 500);
      await db.insert(priceSnapshots).values(chunk);
      await db.insert(latestPrices).values(chunk).onConflictDoUpdate({
        target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind], targetWhere: sql`card_id is not null`,
        set: { priceCents: sql`excluded.price_cents`, capturedAt: sql`excluded.captured_at`, updatedAt: new Date() },
      });
    }
    pricesDone += pr.length;
    console.log(`  + ${id} ${exp.name}: ${toInsert.length} cards, ${pr.length} priced`);
  }
  console.log(`\nEN fill: ${setsDone} sets, ${cardsDone} cards, ${pricesDone} priced`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
