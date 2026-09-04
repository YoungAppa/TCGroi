/**
 * Final Fantasy (FIN) Play Booster odds from WotC's own Collecting article —
 * the first Magic set on the site with OFFICIAL confidence.
 *
 * https://magic.wizards.com/en/news/feature/collecting-final-fantasy states,
 * numerically: rare/mythic slot = default rare 80% / default mythic 10% /
 * borderless rare 8% / borderless mythic 1% / FF-artist rare 0.5% / mythic
 * 0.5%; and one third of Play Boosters carry a Through the Ages (FCA) card
 * split uncommon 63.25% / rare 29.75% / mythic 7%.
 *
 * This script makes the card pools match those slots:
 *  1. FIN borderless rares/mythics move from display-only into
 *     borderless_rare / borderless_mythic tiers (Scryfall border_color).
 *     The tiny FF-artist series (1% combined) stays display-only — the
 *     article's group is real but its cards are hard to identify reliably,
 *     and 1% of a slot is not worth a misclassification.
 *  2. FCA cards are ingested INTO fin (non-foil prices — the play-booster
 *     printing) under bonus_uncommon / bonus_rare / bonus_mythic, so the
 *     stated 63/30/7 split is modelled instead of flattened.
 * The fin.json table (v2, OFFICIAL) carries the matching slots.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import { cards, games, getDb, latestPrices, sets } from "@/lib/db";

const HEADERS = { "User-Agent": "WhatsThatROI/1.0 (fin official odds)" };
const cardSchema = z.object({
  id: z.string(),
  name: z.string(),
  collector_number: z.string(),
  rarity: z.string(),
  border_color: z.string().nullish(),
  promo_types: z.array(z.string()).nullish(),
  image_uris: z.object({ large: z.string().nullish(), normal: z.string().nullish() }).passthrough().nullish(),
  card_faces: z.array(z.object({ image_uris: z.object({ large: z.string().nullish(), normal: z.string().nullish() }).passthrough().nullish() }).passthrough()).nullish(),
  prices: z.object({ usd: z.string().nullish(), usd_foil: z.string().nullish() }).passthrough().nullish(),
});
const respSchema = z.object({ data: z.array(cardSchema), has_more: z.boolean(), next_page: z.string().nullish() });

async function scry(query: string) {
  const out: z.infer<typeof cardSchema>[] = [];
  let url: string | null = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=set`;
  while (url) {
    const res: z.infer<typeof respSchema> = await fetchJson(url, respSchema, { provider: "scryfall", headers: HEADERS, retries: 3 });
    out.push(...res.data);
    url = res.has_more ? (res.next_page ?? null) : null;
    if (url) await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}
const img = (c: z.infer<typeof cardSchema>) =>
  c.image_uris?.large ?? c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.large ?? c.card_faces?.[0]?.image_uris?.normal ?? null;
const usd = (c: z.infer<typeof cardSchema>) => {
  const v = c.prices?.usd ? Number(c.prices.usd) : NaN;
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
};

async function main() {
  const db = getDb();
  const [mtg] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "mtg"));
  const [fin] = await db.select({ id: sets.id }).from(sets)
    .where(and(eq(sets.gameId, mtg!.id), eq(sets.code, "fin"), eq(sets.language, "EN")));
  if (!fin) throw new Error("fin set missing");

  // 1. Borderless rares/mythics -> their own tiers, in EV.
  const borderless = await scry("e:fin game:paper border:borderless (rarity:rare or rarity:mythic) -is:serialized");
  let moved = 0;
  for (const c of borderless) {
    const rarity = c.rarity === "mythic" ? "borderless_mythic" : "borderless_rare";
    const r = await db.execute(sql`
      update cards set rarity = ${rarity}, display_only = false, updated_at = now()
      where set_id = ${fin.id} and number = ${c.collector_number} and treatment != ${"base"}
      returning id`);
    moved += [...r].length;
  }
  console.log(`borderless moved into EV tiers: ${moved}`);

  // 2. FCA cards into fin at PLAY (non-foil) prices, stated-split tiers.
  const fca = await scry("e:fca game:paper -is:serialized");
  let inserted = 0, priced = 0;
  for (const c of fca) {
    const rarity = c.rarity === "mythic" ? "bonus_mythic" : c.rarity === "rare" ? "bonus_rare" : "bonus_uncommon";
    const [row] = await db.insert(cards).values({
      setId: fin.id,
      name: c.name,
      number: `FCA-${c.collector_number}`,
      rarity,
      treatment: "base",
      imageUrl: img(c),
      externalIds: { scryfall: c.id },
    }).onConflictDoUpdate({
      target: [cards.setId, cards.number, cards.treatment],
      set: { rarity, displayOnly: false, updatedAt: new Date() },
    }).returning({ id: cards.id });
    inserted++;
    const cents = usd(c);
    if (row && cents !== null) {
      await db.insert(latestPrices).values([{ cardId: row.id, sourceId: "tcgplayer_market", priceCents: cents, kind: "raw" as const, capturedAt: new Date() }])
        .onConflictDoUpdate({
          target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind],
          targetWhere: sql`${latestPrices.cardId} IS NOT NULL`,
          set: { priceCents: cents, capturedAt: new Date(), updatedAt: new Date() },
        });
      priced++;
    }
  }
  console.log(`FCA in fin: ${inserted} cards, ${priced} priced (non-foil)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
