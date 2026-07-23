/**
 * Build the Collector Booster card pool for Magic sets, as a separate
 * "<code>-collector" set. A Collector Booster is a different product from the
 * Play/Draft booster the main set ranks: 12 packs, ~15 cards each, and its value
 * is almost entirely the FOIL rare/mythic prints — INCLUDING the special
 * treatments (showcase, borderless, extended-art, serialized) that the Play
 * Booster ingest deliberately excludes. A set can only carry one pull-rate table,
 * so Collector lives on its own set with its own table + box product.
 *
 * This ingests every rare/mythic print of the set (base frame AND treatments) at
 * its FOIL price (usd_foil, falling back to etched/usd), which is what a Collector
 * pack actually contains. Uniform-within-rarity over that foil pool is the
 * (disclosed) approximation, same as everywhere. Idempotent per set.
 *
 *   npx tsx --env-file=.env.local scripts/ingest-magic-collector.ts fin mh3 dsk
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { fetchJson } from "@/lib/catalog/http";
import { cards, games, getDb, latestPrices, sets } from "@/lib/db";

const BASE = "https://api.scryfall.com";
const HEADERS = { "User-Agent": "TCGROI/1.0 (collector set ingest)" };
const GAP_MS = 90;

const imageUris = z.object({ large: z.string().nullish(), normal: z.string().nullish() }).passthrough();
const cardSchema = z.object({
  id: z.string(),
  name: z.string(),
  collector_number: z.string(),
  rarity: z.string(),
  booster: z.boolean().nullish(),
  promo_types: z.array(z.string()).nullish(),
  image_uris: imageUris.nullish(),
  card_faces: z.array(z.object({ image_uris: imageUris.nullish() }).passthrough()).nullish(),
  prices: z
    .object({ usd: z.string().nullish(), usd_foil: z.string().nullish(), usd_etched: z.string().nullish() })
    .passthrough()
    .nullish(),
});
const cardsResponse = z.object({ data: z.array(cardSchema), has_more: z.boolean(), next_page: z.string().nullish() });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
/** Foil price in cents (what a Collector pack holds): foil > etched > non-foil. */
function foilCents(c: z.infer<typeof cardSchema>): number | null {
  for (const raw of [c.prices?.usd_foil, c.prices?.usd_etched, c.prices?.usd]) {
    const v = raw ? Number(raw) : NaN;
    if (Number.isFinite(v) && v > 0) return Math.round(v * 100);
  }
  return null;
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
  if (codes.length === 0) throw new Error("pass set codes, e.g. ingest-magic-collector.ts fin mh3");
  const db = getDb();
  const [mtg] = await db.select().from(games).where(eq(games.slug, "mtg"));
  if (!mtg) throw new Error("mtg game not seeded");
  const capturedAt = new Date();

  for (const code of codes) {
    try {
      const [orig] = await db
        .select({ name: sets.name, releaseDate: sets.releaseDate })
        .from(sets)
        .where(and(eq(sets.gameId, mtg.id), eq(sets.code, code), eq(sets.language, "EN")));
      if (!orig) {
        console.warn(`  ${code}: base set not in DB — skipped`);
        continue;
      }
      const cCode = `${code}-collector`;
      const cName = `${orig.name} (Collector)`;

      // Every rare/mythic print of the set (base + treatments), foil-priced.
      const rows: Row[] = [];
      let url: string | null =
        `${BASE}/cards/search?q=${encodeURIComponent(`e:${code} game:paper (rarity:rare or rarity:mythic)`)}&unique=prints&order=set`;
      while (url) {
        let res: z.infer<typeof cardsResponse>;
        try {
          res = await fetchJson(url, cardsResponse, { provider: "scryfall", headers: HEADERS, retries: 3 });
        } catch (err) {
          if (err instanceof Error && /HTTP 404/.test(err.message)) break;
          throw err;
        }
        for (const c of res.data) {
          if (c.rarity !== "rare" && c.rarity !== "mythic") continue;
          // Serialized cards (numbered 1/500 etc.) are a 1-per-many-boxes insert,
          // not a standard Collector rare/mythic slot; their $1,000s prices wreck
          // the tier mean, so exclude them (same spirit as the Play treatment filter).
          if (c.promo_types?.includes("serialized")) continue;
          const cents = foilCents(c);
          // Ultra-chase inserts (>$500 foil — textured/galaxy/"god" borderless,
          // etc.) are pulled at far below the standard mythic rate; at a flat rate
          // they dominate the mean and inflate box EV. Exclude; the standard
          // rare/mythic pool is what a Collector pack reliably yields.
          if (cents !== null && cents > 50000) continue;
          rows.push({
            name: c.name,
            number: c.collector_number,
            rarity: c.rarity,
            image: cardImage(c),
            scryfallId: c.id,
            cents,
          });
        }
        url = res.has_more ? (res.next_page ?? null) : null;
        if (url) await sleep(GAP_MS);
      }

      const byNumber = new Map<string, Row>();
      for (const r of rows) {
        const ex = byNumber.get(r.number);
        if (!ex || (r.cents ?? 0) > (ex.cents ?? 0)) byNumber.set(r.number, r);
      }
      const unique = [...byNumber.values()];
      if (unique.length === 0) {
        console.warn(`  ${code}: no rare/mythic prints — skipped`);
        continue;
      }

      const [setRow] = await db
        .insert(sets)
        .values({
          gameId: mtg.id,
          code: cCode,
          name: cName,
          releaseDate: orig.releaseDate,
          language: "EN",
          externalIds: { scryfall_collector: code },
        })
        .onConflictDoUpdate({ target: [sets.gameId, sets.code, sets.language], set: { name: cName, updatedAt: new Date() } })
        .returning({ id: sets.id });
      const setId = setRow!.id;

      await db.delete(cards).where(eq(cards.setId, setId));
      const inserted = await db
        .insert(cards)
        .values(
          unique.map((r) => ({
            setId,
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
          .values(priceRows.map((r) => ({ cardId: r.cardId, sourceId: "tcgplayer_market", priceCents: r.cents, kind: "raw" as const, capturedAt })))
          .onConflictDoUpdate({
            target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind],
            targetWhere: sql`${latestPrices.cardId} IS NOT NULL`,
            set: { priceCents: sql`excluded.price_cents`, capturedAt, updatedAt: new Date() },
          });
      }

      console.log(`  ${cCode}: ${unique.length} rare/mythic foil prints (${priceRows.length} priced)`);
    } catch (err) {
      console.warn(`  ${code}: ${err instanceof Error ? err.message : String(err)} — skipped`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("collector ingest failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
