/**
 * Foundations Play Booster odds from WotC's Collecting article
 * (https://magic.wizards.com/en/news/feature/collecting-foundations).
 * R/M slot: rare 78% / mythic 12.8% / borderless rare 7.7% / borderless
 * mythic 1.5%. Wildcard adds rare 16.3% / mythic 2.6% / borderless 1.9%.
 * Special Guests replace a common in 1.5% of packs (10-card sheet, its own
 * set code SPG — the 2024-11-15 batch). Borderless commons/uncommons in the
 * wildcard (~4.2%, near-bulk) and all foils stay unmodelled: understates.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import { cards, games, getDb, latestPrices, sets } from "@/lib/db";

const HEADERS = { "User-Agent": "WhatsThatROI/1.0 (fdn official odds)" };
const cardSchema = z.object({
  id: z.string(), name: z.string(), collector_number: z.string(), rarity: z.string(),
  released_at: z.string().nullish(),
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
const imgOf = (c: z.infer<typeof cardSchema>) =>
  c.image_uris?.large ?? c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.large ?? c.card_faces?.[0]?.image_uris?.normal ?? null;
const usdOf = (c: z.infer<typeof cardSchema>) => {
  const v = c.prices?.usd ? Number(c.prices.usd) : NaN;
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
};

async function upsert(db: ReturnType<typeof getDb>, setId: string, c: z.infer<typeof cardSchema>, number: string, rarity: string) {
  const moved = await db.execute(sql`
    update cards set rarity = ${rarity}, display_only = false, updated_at = now()
    where set_id = ${setId} and number = ${number} returning id`);
  if ([...moved].length > 0) return "moved";
  const [row] = await db.insert(cards).values({
    setId, name: c.name, number, rarity, treatment: "special",
    imageUrl: imgOf(c), externalIds: { scryfall: c.id },
  }).onConflictDoNothing().returning({ id: cards.id });
  if (!row) return "skip";
  const cents = usdOf(c);
  if (cents !== null) {
    await db.insert(latestPrices).values([{ cardId: row.id, sourceId: "tcgplayer_market", priceCents: cents, kind: "raw" as const, capturedAt: new Date() }]).onConflictDoNothing();
  }
  return "inserted";
}

async function main() {
  const db = getDb();
  const [mtg] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "mtg"));
  const [fdn] = await db.select({ id: sets.id }).from(sets)
    .where(and(eq(sets.gameId, mtg!.id), eq(sets.code, "fdn"), eq(sets.language, "EN")));
  if (!fdn) throw new Error("fdn missing");

  const counts: Record<string, number> = {};
  for (const c of await all("e:fdn game:paper border:borderless (rarity:rare or rarity:mythic)")) {
    const rarity = c.rarity === "mythic" ? "borderless_mythic" : "borderless_rare";
    const r = await upsert(db, fdn.id, c, c.collector_number, rarity);
    counts[`${rarity}:${r}`] = (counts[`${rarity}:${r}`] ?? 0) + 1;
  }
  for (const c of await all("e:spg game:paper")) {
    if (c.released_at !== "2024-11-15") continue; // the Foundations SPG batch
    const r = await upsert(db, fdn.id, c, `SPG-${c.collector_number}`, "bonus_sheet");
    counts[`spg:${r}`] = (counts[`spg:${r}`] ?? 0) + 1;
  }
  console.log(JSON.stringify(counts));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
