/** Ingest the FIC (Final Fantasy Commander) Booster Fun / extended-art
 *  rares+mythics that FIN Collector Boosters drop, foil-priced, into the
 *  fin-collector pool under the commander_fun tier. */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { fetchJson } from "@/lib/catalog/http";
import { cards, games, getDb, latestPrices, sets } from "@/lib/db";

const HEADERS = { "User-Agent": "WhatsThatROI/1.0 (fin-collector fic)" };
const cardSchema = z.object({
  id: z.string(), name: z.string(), collector_number: z.string(), rarity: z.string(),
  promo_types: z.array(z.string()).nullish(),
  image_uris: z.object({ large: z.string().nullish(), normal: z.string().nullish() }).passthrough().nullish(),
  card_faces: z.array(z.object({ image_uris: z.object({ large: z.string().nullish(), normal: z.string().nullish() }).passthrough().nullish() }).passthrough()).nullish(),
  prices: z.object({ usd: z.string().nullish(), usd_foil: z.string().nullish(), usd_etched: z.string().nullish() }).passthrough().nullish(),
}).passthrough();
const respSchema = z.object({ data: z.array(cardSchema), has_more: z.boolean(), next_page: z.string().nullish() });

async function main() {
  const db = getDb();
  const [mtg] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "mtg"));
  const [fc] = await db.select({ id: sets.id }).from(sets)
    .where(and(eq(sets.gameId, mtg!.id), eq(sets.code, "fin-collector"), eq(sets.language, "EN")));
  if (!fc) throw new Error("fin-collector missing");

  let url: string | null = `https://api.scryfall.com/cards/search?q=${encodeURIComponent("e:fic game:paper (border:borderless or is:extendedart or is:showcase) (rarity:rare or rarity:mythic)")}&unique=prints&order=set`;
  let ins = 0, upd = 0, priced = 0;
  while (url) {
    const res: z.infer<typeof respSchema> = await fetchJson(url, respSchema, { provider: "scryfall", headers: HEADERS, retries: 3 });
    for (const c of res.data) {
      if (c.promo_types?.includes("serialized")) continue;
      const number = `FIC-${c.collector_number}`;
      // Collector pool prices are FOIL, matching the rest of fin-collector.
      const f = c.prices?.usd_foil ?? c.prices?.usd_etched ?? c.prices?.usd;
      const v = f ? Number(f) : NaN;
      const cents = Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
      const existing = await db.execute<{ id: string }>(sql`
        update cards set rarity = ${"commander_fun"}, display_only = false, updated_at = now()
        where set_id = ${fc.id} and number = ${number} returning id`);
      let ids = [...existing].map((r) => r.id);
      if (ids.length === 0) {
        const img = c.image_uris?.large ?? c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.large ?? c.card_faces?.[0]?.image_uris?.normal ?? null;
        const [row] = await db.insert(cards).values({
          setId: fc.id, name: c.name, number, rarity: "commander_fun",
          treatment: "special", imageUrl: img, externalIds: { scryfall: c.id },
        }).onConflictDoNothing().returning({ id: cards.id });
        if (!row) continue;
        ids = [row.id]; ins++;
      } else upd++;
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
    url = res.has_more ? (res.next_page ?? null) : null;
    if (url) await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`fic pool: inserted ${ins}, updated ${upd}, priced ${priced}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
