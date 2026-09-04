/**
 * Modern Horizons 3 Play Booster odds from WotC's Collecting article
 * (https://magic.wizards.com/en/news/feature/collecting-modern-horizons-3).
 *
 * Stated per-pack rates, combined across the R/M slot and the wildcard slot:
 *   default rare  .798 + .067 = .865      default mythic .130 + .011 = .141
 *   retro frame   .021 + .042 = .063      borderless Booster Fun .051 + .004 = .055
 * Deliberately UNMODELLED (all understate EV, each noted in the table): the
 * new-to-Modern slot's extra rares, the wildcard slot's Commander mythics,
 * DFC uncommons, and every foil. Collector-exclusive treatments (textured,
 * ripple, serialized) never enter — they aren't in Play Boosters at all.
 *
 * This script reclassifies mh3's display-only treatment cards into the two
 * new tiers via Scryfall: frame:1997 -> retro_frame, border:borderless ->
 * booster_fun (serialized excluded).
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import { games, getDb, sets } from "@/lib/db";

const HEADERS = { "User-Agent": "WhatsThatROI/1.0 (mh3 official odds)" };
const cardSchema = z.object({
  collector_number: z.string(),
  rarity: z.string(),
  promo_types: z.array(z.string()).nullish(),
}).passthrough();
const respSchema = z.object({ data: z.array(cardSchema), has_more: z.boolean(), next_page: z.string().nullish() });

async function nums(query: string): Promise<string[]> {
  const out: string[] = [];
  let url: string | null = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=set`;
  while (url) {
    const res: z.infer<typeof respSchema> = await fetchJson(url, respSchema, { provider: "scryfall", headers: HEADERS, retries: 3 });
    for (const c of res.data) if (!c.promo_types?.includes("serialized")) out.push(c.collector_number);
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
  if (!mh3) throw new Error("mh3 missing");

  const retro = await nums("e:mh3 game:paper frame:1997 (rarity:rare or rarity:mythic)");
  const borderless = await nums("e:mh3 game:paper border:borderless (rarity:rare or rarity:mythic) -frame:1997");
  for (const [rarity, list] of [["retro_frame", retro], ["booster_fun", borderless]] as const) {
    let moved = 0;
    for (const n of list) {
      const r = await db.execute(sql`
        update cards set rarity = ${rarity}, display_only = false, updated_at = now()
        where set_id = ${mh3.id} and number = ${n} and treatment != ${"base"}
        returning id`);
      moved += [...r].length;
    }
    console.log(`${rarity}: ${list.length} scryfall prints, ${moved} cards moved into EV`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
