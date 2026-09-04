/** Insert MH3 retro/borderless prints the play-set card list lacks (non-foil
 *  prices — the play-booster printing), so the official tiers have full pools. */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import { cards, games, getDb, latestPrices, sets } from "@/lib/db";

const HEADERS = { "User-Agent": "WhatsThatROI/1.0 (mh3 pools)" };
const cardSchema = z.object({
  id: z.string(),
  name: z.string(),
  collector_number: z.string(),
  rarity: z.string(),
  promo_types: z.array(z.string()).nullish(),
  image_uris: z.object({ large: z.string().nullish(), normal: z.string().nullish() }).passthrough().nullish(),
  card_faces: z.array(z.object({ image_uris: z.object({ large: z.string().nullish(), normal: z.string().nullish() }).passthrough().nullish() }).passthrough()).nullish(),
  prices: z.object({ usd: z.string().nullish() }).passthrough().nullish(),
}).passthrough();
const respSchema = z.object({ data: z.array(cardSchema), has_more: z.boolean(), next_page: z.string().nullish() });

async function all(query: string) {
  const out: z.infer<typeof cardSchema>[] = [];
  let url: string | null = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=set`;
  while (url) {
    const res: z.infer<typeof respSchema> = await fetchJson(url, respSchema, { provider: "scryfall", headers: HEADERS, retries: 3 });
    out.push(...res.data.filter((c) => !c.promo_types?.includes("serialized")));
    url = res.has_more ? (res.next_page ?? null) : null;
    if (url) await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}

async function main() {
  const db = getDb();
  const [mtg] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "mtg"));
  const [mh3] = await db.select({ id: sets.id }).from(sets)
    .where(and(eq(sets.gameId, mtg!.id), eq(sets.code, "mh3"), eq(sets.language, "EN")));
  const existing = new Set(
    (await db.select({ number: cards.number }).from(cards).where(eq(cards.setId, mh3!.id))).map((r) => r.number),
  );
  let ins = 0, priced = 0;
  for (const [rarity, q] of [
    ["retro_frame", "e:mh3 game:paper frame:1997 (rarity:rare or rarity:mythic)"],
    ["booster_fun", "e:mh3 game:paper border:borderless (rarity:rare or rarity:mythic) -frame:1997"],
  ] as const) {
    for (const c of await all(q)) {
      if (existing.has(c.collector_number)) continue;
      const img = c.image_uris?.large ?? c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.large ?? c.card_faces?.[0]?.image_uris?.normal ?? null;
      const [row] = await db.insert(cards).values({
        setId: mh3!.id, name: c.name, number: c.collector_number, rarity,
        treatment: "special", imageUrl: img, externalIds: { scryfall: c.id },
      }).onConflictDoNothing().returning({ id: cards.id });
      if (!row) continue;
      ins++;
      const v = c.prices?.usd ? Number(c.prices.usd) : NaN;
      if (Number.isFinite(v) && v > 0) {
        await db.insert(latestPrices).values([{ cardId: row.id, sourceId: "tcgplayer_market", priceCents: Math.round(v * 100), kind: "raw" as const, capturedAt: new Date() }]).onConflictDoNothing();
        priced++;
      }
    }
  }
  console.log(`inserted ${ins} (${priced} priced)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
