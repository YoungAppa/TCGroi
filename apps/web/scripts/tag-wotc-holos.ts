/**
 * Make the vintage WOTC-era (1999–2002) booster boxes rankable.
 *
 * The EV model keys off the modern rarity vocabulary, but a WOTC pack's only
 * chase is its HOLO rare (Charizard, Lugia …) — and normalizePokemonRarity maps
 * "Rare Holo" to plain "rare" (bulk), so the holos vanish into the noise and the
 * set can't be valued. This job promotes those holos into the ultra_rare tier so
 * the pull-rate table has a chase pool to price.
 *
 * DURABILITY: the weekly refresh-catalog re-fetches these sets from pokemontcg.io
 * and re-normalizes "Rare Holo" -> "rare", which would wipe a one-shot tag. So we
 * PRESERVE holo-ness in external_ids.wotc_holo (a flag refresh-catalog's upsert
 * merges and keeps), and re-derive the tier from that flag. Idempotent: step 1
 * flags from the raw rarity while it's still visible; step 2 promotes from the
 * flag and survives every later re-normalization. Run it after refresh-catalog.
 *
 *   npx tsx --env-file=.env.local scripts/tag-wotc-holos.ts
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { games, getDb, sets } from "@/lib/db";

/** The WOTC sets we rank (must have a pull-rate file + box product). */
const WOTC_CODES = ["base1", "base2", "base3", "base5", "neo1", "gym1"];

async function main() {
  const db = getDb();
  const [pokemon] = await db.select().from(games).where(eq(games.slug, "pokemon"));
  if (!pokemon) throw new Error("pokemon game not seeded");

  const setRows = await db
    .select({ id: sets.id, code: sets.code })
    .from(sets)
    .where(and(eq(sets.gameId, pokemon.id), eq(sets.language, "EN"), inArray(sets.code, WOTC_CODES)));
  const ids = setRows.map((s) => s.id);
  if (ids.length === 0) {
    console.log("No WOTC sets in the catalog — nothing to tag.");
    return;
  }

  // 1. Flag holos while the raw "Rare Holo" is still present (post build-inventory,
  //    pre re-normalization). Merges into external_ids so refresh-catalog keeps it.
  const flagged = await db.execute(sql`
    update cards set external_ids = coalesce(external_ids, '{}'::jsonb) || '{"wotc_holo": true}'::jsonb
    where set_id in ${ids} and rarity = 'Rare Holo'`);
  // 2. Promote every flagged card to the chase tier — survives re-normalization.
  const promoted = await db.execute(sql`
    update cards set rarity = 'ultra_rare'
    where set_id in ${ids} and external_ids->>'wotc_holo' = 'true'`);

  console.log(
    `WOTC holos tagged: flagged ${flagged.count ?? 0}, promoted ${promoted.count ?? 0} to ultra_rare across ${ids.length} sets (${setRows.map((s) => s.code).join(", ")}).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error("tag-wotc-holos failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
