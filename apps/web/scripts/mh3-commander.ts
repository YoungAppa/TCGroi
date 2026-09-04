/** MH3's boosterable Commander mythics (m3c) into both MH3 pools:
 *  play (non-foil prices, wildcard 4.2%) and collector (foil prices, ~21.2%). */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { fetchJson } from "@/lib/catalog/http";
import { cards, games, getDb, sets } from "@/lib/db";

const HEADERS = { "User-Agent": "WhatsThatROI/1.0 (mh3 commander)" };
const cardSchema = z.object({
  id: z.string(), name: z.string(), collector_number: z.string(), rarity: z.string(),
  reprint: z.boolean().nullish(),
  promo_types: z.array(z.string()).nullish(),
  image_uris: z.object({ large: z.string().nullish(), normal: z.string().nullish() }).passthrough().nullish(),
  card_faces: z.array(z.object({ image_uris: z.object({ large: z.string().nullish(), normal: z.string().nullish() }).passthrough().nullish() }).passthrough()).nullish(),
  prices: z.object({ usd: z.string().nullish(), usd_foil: z.string().nullish(), usd_etched: z.string().nullish() }).passthrough().nullish(),
}).passthrough();
const respSchema = z.object({ data: z.array(cardSchema), has_more: z.boolean(), next_page: z.string().nullish() });

async function fetchAll(query: string) {
  const out: z.infer<typeof cardSchema>[] = [];
  let url: string | null = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=set`;
  while (url) {
    let res: z.infer<typeof respSchema>;
    try { res = await fetchJson(url, respSchema, { provider: "scryfall", headers: HEADERS, retries: 3 }); }
    catch (e) { if (e instanceof Error && /HTTP 404/.test(e.message)) break; throw e; }
    out.push(...res.data.filter((c) => !c.promo_types?.includes("serialized")));
    url = res.has_more ? (res.next_page ?? null) : null;
    if (url) await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}

async function main() {
  const db = getDb();
  const [mtg] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "mtg"));
  // The article: "8 Commander mythic rares in regular and borderless versions"
  // appear in boosters — the set's NEW mythics, not deck reprints.
  const pool = await fetchAll("e:m3c game:paper rarity:mythic -is:reprint");
  const base = new Set(pool.map((c) => c.name));
  console.log(`m3c new mythics: ${pool.length} prints of ${base.size} cards:`, [...base].join(" | "));

  for (const [code, foil] of [["mh3", false], ["mh3-collector", true]] as const) {
    const [setRow] = await db.select({ id: sets.id }).from(sets)
      .where(and(eq(sets.gameId, mtg!.id), eq(sets.code, code), eq(sets.language, "EN")));
    if (!setRow) { console.log(code, "missing"); continue; }
    let ins = 0, priced = 0;
    for (const c of pool) {
      const number = `M3C-${c.collector_number}`;
      const raw = foil
        ? (c.prices?.usd_foil ?? c.prices?.usd_etched ?? c.prices?.usd)
        : c.prices?.usd;
      const v = raw ? Number(raw) : NaN;
      const cents = Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
      const upd = await db.execute<{ id: string }>(sql`
        update cards set rarity = ${"commander_fun"}, display_only = false, updated_at = now()
        where set_id = ${setRow.id} and number = ${number} returning id`);
      let ids = [...upd].map((r) => r.id);
      if (ids.length === 0) {
        const img = c.image_uris?.large ?? c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.large ?? c.card_faces?.[0]?.image_uris?.normal ?? null;
        const [row] = await db.insert(cards).values({
          setId: setRow.id, name: c.name, number, rarity: "commander_fun",
          treatment: "special", imageUrl: img, externalIds: { scryfall: c.id },
        }).onConflictDoNothing().returning({ id: cards.id });
        if (!row) continue;
        ids = [row.id]; ins++;
      }
      if (cents !== null) {
        for (const id of ids) {
          await db.execute(sql`
            insert into latest_prices (card_id, source_id, price_cents, kind, captured_at)
            values (${id}::uuid, ${"tcgplayer_market"}, ${cents}, ${"raw"}, now())
            on conflict (card_id, source_id, kind) where card_id is not null
            do update set price_cents = ${cents}, captured_at = now(), updated_at = now()`);
          priced++;
        }
      }
    }
    console.log(`${code}: inserted ${ins}, priced ${priced} (${foil ? "foil" : "non-foil"} prices)`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
