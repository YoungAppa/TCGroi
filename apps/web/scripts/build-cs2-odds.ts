/**
 * Generate the CS2 odds pull-rate tables + case products from the ingested
 * catalog. Every weapon case shares the SAME five official Valve drop odds, so
 * this writes one HIGH-confidence pull-rate file per case (slots limited to the
 * tiers that case actually has) plus one "case" sealed product per case.
 *
 * Prices are NOT set here — the case's own price + skin prices come from Skinport
 * later; a case's cost to open is (case price + a $2.50 key). Run after
 * build-cs2-catalog.ts, then load with load-pullrates-products.ts.
 *
 *   npx tsx --env-file=.env.local scripts/build-cs2-odds.ts
 */
import { mkdirSync, writeFileSync } from "fs";

import { eq, sql } from "drizzle-orm";

import { cards, games, getDb, sets } from "@/lib/db";

/** Official CS2 weapon-case odds (sum to 1.0), identical for every case. */
const ODDS: Record<string, number> = {
  mil_spec: 0.7992,
  restricted: 0.1598,
  classified: 0.032,
  covert: 0.0064,
  rare_special: 0.0026,
};
const TIER_ORDER = ["mil_spec", "restricted", "classified", "covert", "rare_special"];

const NOTE =
  "Official Counter-Strike 2 weapon-case drop odds — the same for every case: Mil-Spec 79.92%, Restricted 15.98%, Classified 3.20%, Covert 0.64%, Rare Special (knife/glove) 0.26%. These are Valve's disclosed rates, not a community estimate, so confidence is OFFICIAL — the strongest tier. Within a tier every skin is equally likely; the wear (Factory New … Battle-Scarred) and ~10% StatTrak sub-distribution is modelled at the price layer, not here.";

async function main() {
  const db = getDb();
  const [game] = await db.select().from(games).where(eq(games.slug, "counter-strike-2"));
  if (!game) throw new Error("counter-strike-2 game not seeded");

  const dir = "data/pullrates/counter-strike-2";
  mkdirSync(dir, { recursive: true });

  const setRows = await db
    .select({ id: sets.id, code: sets.code, name: sets.name })
    .from(sets)
    .where(eq(sets.gameId, game.id));

  const products: unknown[] = [];
  let files = 0;

  for (const s of setRows) {
    const present = await db
      .select({ rarity: cards.rarity })
      .from(cards)
      .where(eq(cards.setId, s.id))
      .groupBy(cards.rarity);
    const have = new Set(present.map((r) => r.rarity));
    const slots = TIER_ORDER.filter((t) => have.has(t)).map((rarity) => ({
      rarity,
      perPackProbability: ODDS[rarity]!,
    }));
    if (slots.length < 5) console.warn(`  ${s.code}: only ${slots.length}/5 tiers present`);

    const obj = {
      game: "counter-strike-2",
      setCode: s.code,
      version: 1,
      sampleSizePacks: null,
      sourceUrl: "https://www.csgo.com.cn/news/gamebroad/20170911/206155.shtml",
      sourceNote: `${s.name}: ${NOTE}`,
      confidence: "official",
      slots,
      alternateEstimates: [],
      guaranteedSlots: [],
      boxGuarantees: [],
      showWhenPlaceholder: false,
    };
    writeFileSync(`${dir}/${s.code}.json`, JSON.stringify(obj, null, 2) + "\n");
    files++;

    products.push({
      setCode: s.code,
      language: "EN",
      name: s.name,
      slug: "case",
      type: "case",
      packsContained: 1,
      msrpCents: null,
      contentsNote:
        "Opening also needs a $2.50 key (Valve's cut). Cost to open = case price + key; prices come from Skinport.",
    });
  }

  writeFileSync(
    "data/products/counter-strike-2.json",
    JSON.stringify(
      { _comment: "CS2 cases as sealed products; prices (case + skins) load from Skinport.", products },
      null,
      2,
    ) + "\n",
  );
  void sql;
  console.log(`Wrote ${files} odds files + ${products.length} case products.`);
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error("build-cs2-odds failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
