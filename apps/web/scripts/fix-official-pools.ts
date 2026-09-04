/**
 * Corrective pass for the official-odds sets (fin, mh3, fdn): the special
 * tiers must contain ONLY prints that exist non-foil in Play/Draft boosters,
 * priced non-foil. The first pass let Collector-exclusive foil-only variants
 * (priced at foil from the collector ingest) into the pools, inflating tiers.
 *
 * For each card currently in a special tier:
 *  - in the play-legal pool (is:nonfoil) -> reprice to Scryfall's
 *    non-foil usd;
 *  - not in it -> back to display-only under its base rarity.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import { games, getDb, latestPrices, sets } from "@/lib/db";

const HEADERS = { "User-Agent": "WhatsThatROI/1.0 (pool fix)" };
const cardSchema = z.object({
  collector_number: z.string(), rarity: z.string(),
  promo_types: z.array(z.string()).nullish(),
  prices: z.object({ usd: z.string().nullish() }).passthrough().nullish(),
}).passthrough();
const respSchema = z.object({ data: z.array(cardSchema), has_more: z.boolean(), next_page: z.string().nullish() });

async function pool(query: string) {
  const out = new Map<string, { rarity: string; cents: number | null }>();
  let url: string | null = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=set`;
  while (url) {
    let res: z.infer<typeof respSchema>;
    try {
      res = await fetchJson(url, respSchema, { provider: "scryfall", headers: HEADERS, retries: 3 });
    } catch (e) {
      if (e instanceof Error && /HTTP 404/.test(e.message)) break; // empty result
      throw e;
    }
    for (const c of res.data) {
      if (c.promo_types?.includes("serialized")) continue;
      const v = c.prices?.usd ? Number(c.prices.usd) : NaN;
      out.set(c.collector_number, { rarity: c.rarity, cents: Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null });
    }
    url = res.has_more ? (res.next_page ?? null) : null;
    if (url) await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}

const SETS: { code: string; tiers: string[]; query: (t: string) => string }[] = [
  { code: "fin", tiers: ["borderless_rare", "borderless_mythic"], query: () => "e:fin game:paper border:borderless (rarity:rare or rarity:mythic) is:nonfoil" },
  { code: "fdn", tiers: ["borderless_rare", "borderless_mythic"], query: () => "e:fdn game:paper border:borderless (rarity:rare or rarity:mythic) is:nonfoil" },
  { code: "mh3", tiers: ["booster_fun"], query: () => "e:mh3 game:paper border:borderless (rarity:rare or rarity:mythic) -frame:1997 is:nonfoil" },
  { code: "mh3", tiers: ["retro_frame"], query: () => "e:mh3 game:paper frame:1997 (rarity:rare or rarity:mythic) is:nonfoil" },
];

async function main() {
  const db = getDb();
  const [mtg] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "mtg"));
  for (const spec of SETS) {
    const [setRow] = await db.select({ id: sets.id }).from(sets)
      .where(and(eq(sets.gameId, mtg!.id), eq(sets.code, spec.code), eq(sets.language, "EN")));
    if (!setRow) continue;
    const legal = await pool(spec.query(spec.tiers[0]!));
    // Full print list (foil-only included) so demotions restore base rarity.
    const allPrints = await pool(spec.query(spec.tiers[0]!).replace(" is:nonfoil", ""));
    const rows = await db.execute<{ id: string; number: string }>(sql`
      select id, number from cards where set_id = ${setRow.id}
      and rarity in ${sql.raw(`('${spec.tiers.join("','")}')`)}`);
    let kept = 0, repriced = 0, demoted = 0;
    for (const r of [...rows]) {
      const p = legal.get(r.number);
      if (p) {
        kept++;
        if (p.cents !== null) {
          await db.execute(sql`
            insert into latest_prices (card_id, source_id, price_cents, kind, captured_at)
            values (${r.id}::uuid, ${"tcgplayer_market"}, ${p.cents}, ${"raw"}, now())
            on conflict (card_id, source_id, kind) where card_id is not null
            do update set price_cents = ${p.cents}, captured_at = now(), updated_at = now()`);
          // Purge any other-source rows carrying foil prices for this card.
          await db.execute(sql`
            delete from latest_prices where card_id = ${r.id}::uuid and kind = ${"raw"} and source_id != ${"tcgplayer_market"}`);
          repriced++;
        }
      } else {
        const base = allPrints.get(r.number)?.rarity ?? "rare";
        await db.execute(sql`
          update cards set display_only = true, rarity = ${base}, updated_at = now()
          where id = ${r.id}::uuid`);
        demoted++;
      }
    }
    console.log(`${spec.code} ${spec.tiers.join("/")}: kept ${kept} (repriced ${repriced}), demoted ${demoted} foil-only prints`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
