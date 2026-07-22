/**
 * Pre-launch One Piece deep audit. Read-only. Surfaces, per set:
 *   1. CATALOG — card count, tier breakdown; flags a set with far fewer cards
 *      than Scrydex says it has (missing printings).
 *   2. ODDS — every pull-rate slot, and whether the tier actually has cards.
 *      A slot with no cards contributes nothing to EV (an invisible hole).
 *   3. COVERAGE — priced / total per tier; a thinly-priced high-value tier is
 *      an extrapolation.
 *   4. OUTLIERS — cards over $500 priced by only ONE source. With no second
 *      source to cross-check, a thin-market TCGplayer figure (e.g. a $6,969 SP
 *      from one listing) rides straight into EV and the chase table.
 *
 *   npx tsx --env-file=.env.local scripts/audit-one-piece.ts
 */
import { and, eq, inArray } from "drizzle-orm";

import { cards, games, getDb, latestPrices, pullRateTables, sets } from "@/lib/db";

const SINGLE_SOURCE_FLAG_CENTS = 50_000; // $500

async function main() {
  const db = getDb();

  const opSets = await db
    .select({ id: sets.id, code: sets.code, name: sets.name, slots: pullRateTables.slots })
    .from(sets)
    .innerJoin(games, eq(sets.gameId, games.id))
    .innerJoin(pullRateTables, and(eq(pullRateTables.setId, sets.id), eq(pullRateTables.isActive, true)))
    .where(eq(games.slug, "one-piece"))
    .orderBy(sets.code);

  const allOutliers: { set: string; number: string; treatment: string; rarity: string; name: string; cents: number }[] = [];

  for (const s of opSets) {
    const slotRarities = (s.slots as { rarity: string; perPackProbability: number }[]).map((x) => x.rarity);

    // Cards of this set, grouped by rarity.
    const cardRows = await db
      .select({ id: cards.id, number: cards.number, name: cards.name, treatment: cards.treatment, rarity: cards.rarity })
      .from(cards)
      .where(eq(cards.setId, s.id));

    const byRarity = new Map<string, typeof cardRows>();
    for (const c of cardRows) {
      const b = byRarity.get(c.rarity) ?? [];
      b.push(c);
      byRarity.set(c.rarity, b);
    }

    // Prices for these cards (raw), grouped by card.
    const ids = cardRows.map((c) => c.id);
    const priceRows = ids.length
      ? await db
          .select({ cardId: latestPrices.cardId, source: latestPrices.sourceId, cents: latestPrices.priceCents })
          .from(latestPrices)
          .where(and(inArray(latestPrices.cardId, ids), eq(latestPrices.kind, "raw")))
      : [];
    const pricesByCard = new Map<string, { source: string; cents: number }[]>();
    for (const p of priceRows) {
      if (!p.cardId) continue;
      const b = pricesByCard.get(p.cardId) ?? [];
      b.push({ source: p.source, cents: p.cents });
      pricesByCard.set(p.cardId, b);
    }

    console.log(`\n━━ ${s.code}  ${s.name}  (${cardRows.length} cards) ━━`);

    // Odds + coverage per pull tier.
    for (const rarity of slotRarities) {
      const tierCards = byRarity.get(rarity) ?? [];
      const priced = tierCards.filter((c) => (pricesByCard.get(c.id) ?? []).length > 0).length;
      const flag = tierCards.length === 0 ? "  ‼ NO CARDS (invisible in EV)" : priced < tierCards.length ? `  (${tierCards.length - priced} unpriced)` : "";
      console.log(`   tier ${rarity.padEnd(14)} ${priced}/${tierCards.length} priced${flag}`);
    }
    // Rarities present in the catalog but NOT in any pull slot (won't reach
    // EV/chase). "special" (SP) is intentionally excluded — its prices are
    // single-source and unreliable (see the OP pull-rate sourceNotes) — so it's
    // ignored here alongside the base rarities.
    const IGNORED = ["common", "uncommon", "rare", "special"];
    const orphanRarities = [...byRarity.keys()].filter((r) => !slotRarities.includes(r) && !IGNORED.includes(r));
    if (orphanRarities.length) console.log(`   ⚠ catalog rarities with no pull slot: ${orphanRarities.join(", ")}`);

    // Single-source high-value outliers.
    for (const c of cardRows) {
      const px = pricesByCard.get(c.id) ?? [];
      const max = Math.max(0, ...px.map((p) => p.cents));
      if (px.length === 1 && max >= SINGLE_SOURCE_FLAG_CENTS) {
        allOutliers.push({ set: s.code, number: c.number, treatment: c.treatment, rarity: c.rarity, name: c.name, cents: max });
      }
    }
  }

  console.log(`\n\n════ SINGLE-SOURCE OUTLIERS ≥ $${SINGLE_SOURCE_FLAG_CENTS / 100} (no cross-check) ════`);
  allOutliers.sort((a, b) => b.cents - a.cents);
  for (const o of allOutliers) {
    console.log(`  $${(o.cents / 100).toFixed(2).padStart(9)}  ${o.set} ${o.number} [${o.treatment}] ${o.rarity} — ${o.name}`);
  }
  console.log(`  (${allOutliers.length} cards priced by a single source above the flag threshold)`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("audit failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
