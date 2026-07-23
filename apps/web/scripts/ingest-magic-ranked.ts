/**
 * Re-ingest specific Magic sets for RANKING (EV), as opposed to the inventory
 * build (build-magic-catalog.ts, > $1 only). EV needs the whole rarity tier
 * present — a rare tier averaged over only its > $1 members is wildly inflated —
 * and it needs ONLY pack-openable cards, or promos/box-toppers/Commander cards
 * poison the average. So for each named set this:
 *   1. deletes the set's existing card rows (prices cascade), then
 *   2. re-ingests EVERY Scryfall print with `booster: true` (floor 0), storing a
 *      price wherever one exists.
 *
 * Cards keep their raw Scryfall rarity (common/uncommon/rare/mythic), which is
 * exactly the vocabulary the mtg pull-rate slots use. Special treatments
 * (showcase/borderless) that are seeded into boosters stay in — they are pack-
 * openable — so the tier average leans slightly high; the pull-rate file's note
 * discloses that, same uniform-within-tier caveat as Pokémon alt-arts.
 *
 *   npx tsx --env-file=.env.local scripts/ingest-magic-ranked.ts fin blb eoe
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import { cards, games, getDb, latestPrices, sets } from "@/lib/db";

const BASE = "https://api.scryfall.com";
const HEADERS = { "User-Agent": "TCGROI/1.0 (ranked set ingest)" };
const GAP_MS = 90;

const imageUris = z.object({ large: z.string().nullish(), normal: z.string().nullish() }).passthrough();
const cardSchema = z.object({
  id: z.string(),
  name: z.string(),
  collector_number: z.string(),
  rarity: z.string(),
  booster: z.boolean().nullish(),
  image_uris: imageUris.nullish(),
  card_faces: z.array(z.object({ image_uris: imageUris.nullish() }).passthrough()).nullish(),
  prices: z
    .object({ usd: z.string().nullish(), usd_foil: z.string().nullish(), usd_etched: z.string().nullish() })
    .passthrough()
    .nullish(),
});
const cardsResponse = z.object({
  data: z.array(cardSchema),
  has_more: z.boolean(),
  next_page: z.string().nullish(),
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function bestPriceCents(c: z.infer<typeof cardSchema>): number | null {
  let best = 0;
  for (const raw of [c.prices?.usd, c.prices?.usd_foil, c.prices?.usd_etched]) {
    const v = raw ? Number(raw) : NaN;
    if (Number.isFinite(v) && v > best) best = v;
  }
  return best > 0 ? Math.round(best * 100) : null;
}
function cardImage(c: z.infer<typeof cardSchema>): string | null {
  const top = c.image_uris?.large ?? c.image_uris?.normal;
  if (top) return top;
  const f = c.card_faces?.[0]?.image_uris;
  return f?.large ?? f?.normal ?? null;
}

interface Row {
  name: string;
  number: string;
  rarity: string;
  image: string | null;
  scryfallId: string;
  cents: number | null;
}

async function main() {
  const codes = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (codes.length === 0) throw new Error("pass set codes, e.g. ingest-magic-ranked.ts fin blb");
  const db = getDb();
  const [mtg] = await db.select().from(games).where(eq(games.slug, "mtg"));
  if (!mtg) throw new Error("mtg game not seeded");
  const capturedAt = new Date();

  for (const code of codes) {
    const [setRow] = await db
      .select({ id: sets.id, name: sets.name })
      .from(sets)
      .where(and(eq(sets.gameId, mtg.id), eq(sets.code, code), eq(sets.language, "EN")));
    if (!setRow) {
      console.warn(`  ${code}: set not in DB (run the inventory build first) — skipped`);
      continue;
    }

    // Collect every booster print of the set.
    const rows: Row[] = [];
    let url: string | null =
      `${BASE}/cards/search?q=${encodeURIComponent(`e:${code} game:paper`)}&unique=prints&order=set`;
    while (url) {
      let res: z.infer<typeof cardsResponse>;
      try {
        res = await fetchJson(url, cardsResponse, { provider: "scryfall", headers: HEADERS, retries: 3 });
      } catch (err) {
        if (err instanceof Error && /HTTP 404/.test(err.message)) break;
        throw err;
      }
      for (const c of res.data) {
        if (c.booster !== true) continue; // only pack-openable cards enter EV tiers
        rows.push({
          name: c.name,
          number: c.collector_number,
          rarity: c.rarity,
          image: cardImage(c),
          scryfallId: c.id,
          cents: bestPriceCents(c),
        });
      }
      url = res.has_more ? (res.next_page ?? null) : null;
      if (url) await sleep(GAP_MS);
    }

    // Clean slate: drop the set's inventory-era cards (prices cascade), so the
    // tier averages reflect exactly the booster cards, all of them.
    await db.delete(cards).where(eq(cards.setId, setRow.id));

    // De-dupe by collector number (a number can repeat across variants).
    const byNumber = new Map<string, Row>();
    for (const r of rows) {
      const ex = byNumber.get(r.number);
      if (!ex || (r.cents ?? 0) > (ex.cents ?? 0)) byNumber.set(r.number, r);
    }
    const unique = [...byNumber.values()];

    const inserted = await db
      .insert(cards)
      .values(
        unique.map((r) => ({
          setId: setRow.id,
          name: r.name,
          number: r.number,
          rarity: r.rarity,
          treatment: "base",
          imageUrl: r.image,
          externalIds: { scryfall: r.scryfallId },
        })),
      )
      .returning({ id: cards.id, number: cards.number });

    const idByNumber = new Map(inserted.map((r) => [r.number, r.id]));
    const priceRows = unique
      .filter((r) => r.cents !== null)
      .map((r) => ({ cardId: idByNumber.get(r.number)!, cents: r.cents! }))
      .filter((r) => r.cardId);
    if (priceRows.length > 0) {
      await db
        .insert(latestPrices)
        .values(
          priceRows.map((r) => ({
            cardId: r.cardId,
            sourceId: "tcgplayer_market",
            priceCents: r.cents,
            kind: "raw" as const,
            capturedAt,
          })),
        )
        .onConflictDoUpdate({
          target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind],
          targetWhere: sql`${latestPrices.cardId} IS NOT NULL`,
          set: { priceCents: sql`excluded.price_cents`, capturedAt, updatedAt: new Date() },
        });
    }

    console.log(
      `  ${code} ${setRow.name}: ${unique.length} booster cards (${priceRows.length} priced)`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("ranked magic ingest failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
