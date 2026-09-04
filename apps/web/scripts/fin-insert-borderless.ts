/** Insert the FIN nonfoil borderless prints the play set never had. */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { fetchJson } from "@/lib/catalog/http";
import { cards, games, getDb, latestPrices, sets } from "@/lib/db";

const HEADERS = { "User-Agent": "WhatsThatROI/1.0 (fin pool)" };
const cardSchema = z.object({
  id: z.string(), name: z.string(), collector_number: z.string(), rarity: z.string(),
  promo_types: z.array(z.string()).nullish(),
  image_uris: z.object({ large: z.string().nullish(), normal: z.string().nullish() }).passthrough().nullish(),
  card_faces: z.array(z.object({ image_uris: z.object({ large: z.string().nullish(), normal: z.string().nullish() }).passthrough().nullish() }).passthrough()).nullish(),
  prices: z.object({ usd: z.string().nullish() }).passthrough().nullish(),
}).passthrough();
const respSchema = z.object({ data: z.array(cardSchema), has_more: z.boolean(), next_page: z.string().nullish() });

async function main() {
  const db = getDb();
  const [mtg] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "mtg"));
  const [fin] = await db.select({ id: sets.id }).from(sets)
    .where(and(eq(sets.gameId, mtg!.id), eq(sets.code, "fin"), eq(sets.language, "EN")));
  const have = new Set((await db.select({ n: cards.number }).from(cards).where(eq(cards.setId, fin!.id))).map(r => r.n));
  let url: string | null = `https://api.scryfall.com/cards/search?q=${encodeURIComponent("e:fin game:paper border:borderless (rarity:rare or rarity:mythic) is:nonfoil")}&unique=prints&order=set`;
  let ins = 0, priced = 0;
  while (url) {
    const res: z.infer<typeof respSchema> = await fetchJson(url, respSchema, { provider: "scryfall", headers: HEADERS, retries: 3 });
    for (const c of res.data) {
      if (c.promo_types?.includes("serialized") || have.has(c.collector_number)) continue;
      const img = c.image_uris?.large ?? c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.large ?? c.card_faces?.[0]?.image_uris?.normal ?? null;
      const [row] = await db.insert(cards).values({
        setId: fin!.id, name: c.name, number: c.collector_number,
        rarity: c.rarity === "mythic" ? "borderless_mythic" : "borderless_rare",
        treatment: "special", imageUrl: img, externalIds: { scryfall: c.id },
      }).onConflictDoNothing().returning({ id: cards.id });
      if (!row) continue;
      ins++;
      const v = c.prices?.usd ? Number(c.prices.usd) : NaN;
      if (Number.isFinite(v) && v > 0) {
        await db.insert(latestPrices).values([{ cardId: row.id, sourceId: "tcgplayer_market", priceCents: Math.round(v*100), kind: "raw" as const, capturedAt: new Date() }]).onConflictDoNothing();
        priced++;
      }
    }
    url = res.has_more ? (res.next_page ?? null) : null;
    if (url) await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`fin inserted ${ins} (${priced} priced nonfoil)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
