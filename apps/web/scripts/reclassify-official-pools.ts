/** Rebuild the official-odds tier pools from scratch: nonfoil play prints only,
 *  priced at Scryfall's non-foil usd (single source; foil rows purged). */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import { games, getDb, sets } from "@/lib/db";

const HEADERS = { "User-Agent": "WhatsThatROI/1.0 (pool rebuild)" };
const cardSchema = z.object({
  collector_number: z.string(), rarity: z.string(),
  promo_types: z.array(z.string()).nullish(),
  prices: z.object({ usd: z.string().nullish() }).passthrough().nullish(),
}).passthrough();
const respSchema = z.object({ data: z.array(cardSchema), has_more: z.boolean(), next_page: z.string().nullish() });

async function pool(query: string) {
  const out: { number: string; rarity: string; cents: number | null }[] = [];
  let url: string | null = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=set`;
  while (url) {
    let res: z.infer<typeof respSchema>;
    try { res = await fetchJson(url, respSchema, { provider: "scryfall", headers: HEADERS, retries: 3 }); }
    catch (e) { if (e instanceof Error && /HTTP 404/.test(e.message)) break; throw e; }
    for (const c of res.data) {
      if (c.promo_types?.includes("serialized")) continue;
      const v = c.prices?.usd ? Number(c.prices.usd) : NaN;
      out.push({ number: c.collector_number, rarity: c.rarity, cents: Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null });
    }
    url = res.has_more ? (res.next_page ?? null) : null;
    if (url) await new Promise((r) => setTimeout(r, 100));
  }
  return out;
}

const JOBS: { code: string; query: string; tier: (r: string) => string }[] = [
  { code: "fin", query: "e:fin game:paper border:borderless (rarity:rare or rarity:mythic) is:nonfoil",
    tier: (r) => (r === "mythic" ? "borderless_mythic" : "borderless_rare") },
  { code: "fdn", query: "e:fdn game:paper border:borderless (rarity:rare or rarity:mythic) is:nonfoil",
    tier: (r) => (r === "mythic" ? "borderless_mythic" : "borderless_rare") },
  { code: "mh3", query: "e:mh3 game:paper border:borderless (rarity:rare or rarity:mythic) -frame:1997 is:nonfoil",
    tier: () => "booster_fun" },
  { code: "mh3", query: "e:mh3 game:paper frame:1997 (rarity:rare or rarity:mythic) is:nonfoil",
    tier: () => "retro_frame" },
];

async function main() {
  const db = getDb();
  const [mtg] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "mtg"));
  for (const job of JOBS) {
    const [setRow] = await db.select({ id: sets.id }).from(sets)
      .where(and(eq(sets.gameId, mtg!.id), eq(sets.code, job.code), eq(sets.language, "EN")));
    const members = await pool(job.query);
    let tagged = 0, priced = 0, missing = 0;
    for (const m of members) {
      const tier = job.tier(m.rarity);
      const upd = await db.execute<{ id: string }>(sql`
        update cards set rarity = ${tier}, display_only = false, updated_at = now()
        where set_id = ${setRow!.id} and number = ${m.number} returning id`);
      const rows = [...upd];
      if (rows.length === 0) { missing++; continue; }
      tagged += rows.length;
      if (m.cents !== null) {
        for (const r of rows) {
          await db.execute(sql`
            insert into latest_prices (card_id, source_id, price_cents, kind, captured_at)
            values (${r.id}::uuid, ${"tcgplayer_market"}, ${m.cents}, ${"raw"}, now())
            on conflict (card_id, source_id, kind) where card_id is not null
            do update set price_cents = ${m.cents}, captured_at = now(), updated_at = now()`);
          await db.execute(sql`
            delete from latest_prices where card_id = ${r.id}::uuid and kind = ${"raw"} and source_id != ${"tcgplayer_market"}`);
          priced++;
        }
      }
    }
    console.log(`${job.code} -> ${job.tier("rare")}/${job.tier("mythic")}: ${members.length} nonfoil prints, ${tagged} tagged, ${priced} repriced, ${missing} not in DB`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
