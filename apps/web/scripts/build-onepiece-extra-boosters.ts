/**
 * One Piece Extra Booster (EB) and Premium Booster (PRB) catalogs.
 *
 * These are genuine booster products the site was missing — we carried only the
 * sixteen main OP-xx sets. They ingest as catalog + prices, and they are
 * deliberately NOT ranked, for the same reason Japanese sets are not:
 *
 *   - PACK COUNT is not sourceable. Scrydex states pack counts for POKEMON
 *     boxes ("contains 36 booster packs") but never for One Piece — every OP
 *     box description is empty or marketing copy. Pack count scales EV
 *     linearly, so asserting one from memory is the error that had Shiny
 *     Treasure ex overstated 3x.
 *   - PULL RATES do not exist for them. An Extra Booster is a 61-card set with
 *     a different SR/SEC distribution from a 120-card main set, so borrowing a
 *     main set's odds would be inventing them.
 *
 * What ships is real: the cards, their rarities and their prices, which feed
 * the card gallery, search and the collection tracker. Ranking needs only a
 * sourced pack count and a pull table, and neither is fabricated here.
 *
 * Usage: tsx --env-file=.env.local scripts/build-onepiece-extra-boosters.ts
 */
import { eq, sql } from "drizzle-orm";

import { ScrydexCatalogAdapter } from "@/lib/catalog/providers/scrydex";
import type { CatalogSet } from "@/lib/catalog/types";
import { scrydexPriceProvider } from "@/lib/prices/providers/scrydex-prices";
import {
  cards,
  games,
  getDb,
  latestPrices,
  priceSnapshots,
  sets,
} from "@/lib/db";
import type { PriceableCard } from "@/lib/prices/types";

const BASE = "https://api.scrydex.com";

async function main() {
  const key = process.env.TCGPLAYER_MIRROR_API_KEY;
  const teamId = process.env.SCRYDEX_TEAM_ID;
  if (!key || !teamId) {
    console.error("Need TCGPLAYER_MIRROR_API_KEY + SCRYDEX_TEAM_ID.");
    process.exit(1);
  }
  const headers = { "X-Api-Key": key, "X-Team-ID": teamId, accept: "application/json" };

  const db = getDb();
  const [game] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "one-piece"));
  if (!game) throw new Error("one-piece game row missing");

  // Every EB/PRB expansion Scrydex knows about.
  const expansions: { id: string; name: string; release_date?: string }[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${BASE}/onepiece/v1/expansions?page=${page}&page_size=100`, { headers });
    if (!res.ok) break;
    const b = await res.json();
    expansions.push(...(b.data ?? []));
    if (!(b.data ?? []).length || page * (b.page_size ?? 100) >= (b.total_count ?? 0)) break;
  }
  const targets = expansions.filter((e) => /^(EB|PRB)\d+$/i.test(e.id));
  console.log(`${targets.length} Extra/Premium Booster expansions on Scrydex\n`);

  const adapter = new ScrydexCatalogAdapter();
  let setsDone = 0;
  let cardsDone = 0;
  let pricesDone = 0;
  const thin: string[] = [];

  for (const exp of targets) {
    // Our One Piece set codes are hyphenated ("OP-01"); match that shape.
    const code = exp.id.replace(/^([A-Z]+)(\d+)$/i, "$1-$2").toUpperCase();

    const [setRow] = await db
      .insert(sets)
      .values({
        gameId: game.id,
        code,
        name: exp.name,
        language: "EN",
        releaseDate: exp.release_date ? exp.release_date.replace(/\//g, "-") : null,
        externalIds: { scrydex: exp.id },
      })
      .onConflictDoUpdate({
        target: [sets.gameId, sets.code, sets.language],
        set: {
          name: sql`excluded.name`,
          releaseDate: sql`excluded.release_date`,
          externalIds: sql`${sets.externalIds} || excluded.external_ids`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: sets.id });
    if (!setRow) continue;

    const catalogSet: CatalogSet = {
      code,
      name: exp.name,
      releaseDate: exp.release_date ? exp.release_date.replace(/\//g, "-") : null,
      language: "EN",
      expectedCardCount: null,
      externalIds: { scrydex: exp.id },
    };

    let catalogCards;
    try {
      catalogCards = await adapter.fetchCards(catalogSet);
    } catch (err) {
      console.log(`  ${code.padEnd(8)} FAILED: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (catalogCards.length === 0) continue;

    // A set Scrydex barely covers (PRB01 returns a single card) is worse than
    // no set: it would show as a near-empty gallery. Record and skip.
    if (catalogCards.length < 20) {
      thin.push(`${code} (${catalogCards.length} cards)`);
      continue;
    }
    setsDone++;

    const rows = catalogCards.map((c) => ({
      setId: setRow.id,
      number: c.number,
      name: c.name,
      rarity: c.rarity,
      treatment: c.treatment,
      imageUrl: c.imageUrl,
      displayOnly: c.displayOnly ?? false,
      externalIds: c.externalIds,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await db
        .insert(cards)
        .values(rows.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [cards.setId, cards.number, cards.treatment],
          set: {
            name: sql`excluded.name`,
            rarity: sql`excluded.rarity`,
            imageUrl: sql`coalesce(excluded.image_url, ${cards.imageUrl})`,
            displayOnly: sql`excluded.display_only`,
            externalIds: sql`${cards.externalIds} || excluded.external_ids`,
            updatedAt: new Date(),
          },
        });
    }
    cardsDone += rows.length;

    // Prices, through the same provider the ranked sets use.
    const written = await db
      .select({
        id: cards.id,
        name: cards.name,
        number: cards.number,
        rarity: cards.rarity,
        treatment: cards.treatment,
        externalIds: cards.externalIds,
      })
      .from(cards)
      .where(eq(cards.setId, setRow.id));
    const priceable: PriceableCard[] = written.map((c) => ({
      cardId: c.id,
      name: c.name,
      number: c.number,
      rarity: c.rarity,
      treatment: c.treatment,
      externalIds: c.externalIds,
      rawCents: null,
    }));

    const snapshots = await scrydexPriceProvider.fetchCardPrices(catalogSet, priceable);
    const byExternal = new Map<string, string>();
    for (const c of written) {
      for (const ext of Object.values(c.externalIds)) byExternal.set(ext, c.id);
    }
    const priceRows = snapshots.flatMap((s) => {
      const id = s.externalCardId ? byExternal.get(s.externalCardId) : undefined;
      return id
        ? [{
            cardId: id,
            sourceId: s.sourceId,
            priceCents: s.priceCents,
            kind: s.kind,
            capturedAt: s.capturedAt,
          }]
        : [];
    });
    for (let i = 0; i < priceRows.length; i += 500) {
      const chunk = priceRows.slice(i, i + 500);
      await db.insert(priceSnapshots).values(chunk);
      await db
        .insert(latestPrices)
        .values(chunk)
        .onConflictDoUpdate({
          target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind],
          targetWhere: sql`${latestPrices.cardId} IS NOT NULL`,
          set: {
            priceCents: sql`excluded.price_cents`,
            capturedAt: sql`excluded.captured_at`,
            updatedAt: new Date(),
          },
        });
    }
    pricesDone += priceRows.length;

    console.log(
      `  ${code.padEnd(8)} ${String(rows.length).padStart(3)} cards, ${String(priceRows.length).padStart(3)} priced  ${exp.name}`,
    );
  }

  console.log(`\nDone. ${setsDone} sets, ${cardsDone} cards, ${pricesDone} prices.`);
  if (thin.length) {
    console.log(`\nSkipped — Scrydex covers these too thinly to be worth showing: ${thin.join(", ")}`);
  }
  console.log(
    `\nNOT RANKED, deliberately: Scrydex states no pack count for any One Piece box, and no\n` +
      `pull-rate study exists for Extra Boosters. Both would have to be invented, and pack\n` +
      `count alone scales EV linearly.`,
  );
  process.exit(0);
}

main();
