/**
 * Generic official-odds upgrader for Play-Booster-era Magic sets whose WotC
 * Collecting articles publish numeric rates. Hardened by the FIN/FDN foil
 * incident: tier pools take ONLY prints that exist non-foil (is:nonfoil),
 * priced at Scryfall's non-foil usd, single source, other raw rows purged.
 *
 * Config per set: scryfall query -> tier, optional SPG batch by release date.
 * Table JSON edits stay manual (the numbers deserve human eyes); this script
 * only builds the pools.
 *
 *   npx tsx --env-file=.env.local scripts/upgrade-set-official-generic.ts dsk
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import { cards, games, getDb, latestPrices, sets } from "@/lib/db";

const HEADERS = { "User-Agent": "WhatsThatROI/1.0 (official pools)" };
const cardSchema = z.object({
  id: z.string(), name: z.string(), collector_number: z.string(), rarity: z.string(),
  released_at: z.string().nullish(),
  promo_types: z.array(z.string()).nullish(),
  image_uris: z.object({ large: z.string().nullish(), normal: z.string().nullish() }).passthrough().nullish(),
  card_faces: z.array(z.object({ image_uris: z.object({ large: z.string().nullish(), normal: z.string().nullish() }).passthrough().nullish() }).passthrough()).nullish(),
  prices: z.object({ usd: z.string().nullish() }).passthrough().nullish(),
}).passthrough();
const respSchema = z.object({ data: z.array(cardSchema), has_more: z.boolean(), next_page: z.string().nullish() });

interface Job { query: string; tier: (rarity: string) => string; numberPrefix?: string; releasedAt?: string }
const CONFIG: Record<string, Job[]> = {
  dsk: [
    // The article's Booster Fun + Lurking Evil groups sum to 12.4% — modelled
    // as ONE pool at the exact aggregate, so no risky sub-classification.
    { query: "e:dsk game:paper (border:borderless or is:showcase) (rarity:rare or rarity:mythic) is:nonfoil", tier: () => "booster_fun" },
    { query: "e:spg game:paper is:nonfoil", tier: () => "bonus_sheet", numberPrefix: "SPG-", releasedAt: "2024-09-27" },
  ],
  blb: [
    { query: "e:spg game:paper is:nonfoil", tier: () => "bonus_sheet", numberPrefix: "SPG-", releasedAt: "2024-08-02" },
  ],
};

async function fetchPool(query: string) {
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
  const code = process.argv[2];
  const jobs = CONFIG[code ?? ""];
  if (!jobs) throw new Error(`no config for "${code}" — add one to CONFIG`);
  const db = getDb();
  const [mtg] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "mtg"));
  const [setRow] = await db.select({ id: sets.id }).from(sets)
    .where(and(eq(sets.gameId, mtg!.id), eq(sets.code, code!), eq(sets.language, "EN")));
  if (!setRow) throw new Error(`${code} not in DB`);

  for (const job of jobs) {
    let tagged = 0, inserted = 0, priced = 0;
    for (const c of await fetchPool(job.query)) {
      if (job.releasedAt && c.released_at !== job.releasedAt) continue;
      const number = `${job.numberPrefix ?? ""}${c.collector_number}`;
      const tier = job.tier(c.rarity);
      const v = c.prices?.usd ? Number(c.prices.usd) : NaN;
      const cents = Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;

      const upd = await db.execute<{ id: string }>(sql`
        update cards set rarity = ${tier}, display_only = false, updated_at = now()
        where set_id = ${setRow.id} and number = ${number} returning id`);
      let ids = [...upd].map((r) => r.id);
      if (ids.length === 0) {
        const img = c.image_uris?.large ?? c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.large ?? c.card_faces?.[0]?.image_uris?.normal ?? null;
        const [row] = await db.insert(cards).values({
          setId: setRow.id, name: c.name, number, rarity: tier,
          treatment: "special", imageUrl: img, externalIds: { scryfall: c.id },
        }).onConflictDoNothing().returning({ id: cards.id });
        if (!row) continue;
        ids = [row.id]; inserted++;
      } else tagged++;
      if (cents !== null) {
        for (const id of ids) {
          await db.execute(sql`
            insert into latest_prices (card_id, source_id, price_cents, kind, captured_at)
            values (${id}::uuid, ${"tcgplayer_market"}, ${cents}, ${"raw"}, now())
            on conflict (card_id, source_id, kind) where card_id is not null
            do update set price_cents = ${cents}, captured_at = now(), updated_at = now()`);
          await db.execute(sql`
            delete from latest_prices where card_id = ${id}::uuid and kind = ${"raw"} and source_id != ${"tcgplayer_market"}`);
          priced++;
        }
      }
    }
    console.log(`${code} ${job.tier("rare")}: tagged ${tagged}, inserted ${inserted}, priced ${priced}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
