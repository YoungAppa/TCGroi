/**
 * Builds data/fixtures/payloads.json — the demo data layer that stands in for
 * the database until DATABASE_URL exists.
 *
 * Fetches live catalog + prices from pokemontcg.io for every set that has a
 * pull-rate file, and snapshots them into the exact payload shape the DB layer
 * will later serve. Committing the fixture keeps builds deterministic and
 * offline, which CI relies on.
 *
 * Sealed product definitions and their prices are HAND-ENTERED here and
 * flagged sealedIsPlaceholder: true — no configured source prices sealed
 * product yet (pokemontcg.io is singles-only; PriceCharting needs a token).
 * The UI shows that flag; the numbers are shaped like reality but are inputs.
 *
 *   npx tsx scripts/make-fixture.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { PokemonTcgIoAdapter } from "@/lib/catalog/providers/pokemontcgio";
import type { CardPriceData } from "@/lib/ev/types";
import { pokemonTcgIoPriceProvider } from "@/lib/prices/providers/pokemontcgio-prices";
import type { PriceableCard } from "@/lib/prices/types";
import { loadAllPullRates } from "@/lib/pullrates/load";
import type { ProductPayload, RankingsPayload } from "@/lib/data/types";

/**
 * Sealed products per set. packsContained and MSRP are physical facts;
 * sealedCents values are typical street prices entered by hand on 2026-07-16
 * and are placeholders until PriceCharting lands.
 */
const SEALED_PRODUCTS: Record<
  string,
  {
    name: string;
    slug: string;
    type: ProductPayload["productType"];
    packsContained: number;
    msrpCents: number | null;
    sealedCents: number | null;
  }[]
> = {
  sv8: [
    {
      name: "Booster Box (36 packs)",
      slug: "booster-box",
      type: "booster_box",
      packsContained: 36,
      msrpCents: 16344,
      sealedCents: 12999,
    },
    {
      name: "Booster Pack",
      slug: "booster-pack",
      type: "booster_pack",
      packsContained: 1,
      msrpCents: 454,
      sealedCents: 399,
    },
    {
      name: "Elite Trainer Box (9 packs)",
      slug: "elite-trainer-box",
      type: "etb",
      packsContained: 9,
      msrpCents: 4999,
      sealedCents: 5499,
    },
  ],
  sv1: [
    {
      name: "Booster Box (36 packs)",
      slug: "booster-box",
      type: "booster_box",
      packsContained: 36,
      msrpCents: 14400,
      sealedCents: 10999,
    },
    {
      name: "Booster Pack",
      slug: "booster-pack",
      type: "booster_pack",
      packsContained: 1,
      msrpCents: 400,
      sealedCents: 329,
    },
  ],
};

async function main() {
  const catalog = new PokemonTcgIoAdapter();
  const pullRates = await loadAllPullRates();
  const pokemonTables = pullRates.filter((p) => p.file.game === "pokemon");

  console.log(`Pull-rate files found: ${pokemonTables.map((p) => p.file.setCode).join(", ")}`);

  const sets = await catalog.fetchSets();
  const products: ProductPayload[] = [];

  for (const { file } of pokemonTables) {
    const set = sets.find((s) => s.code === file.setCode);
    if (!set) {
      console.warn(`  SKIP ${file.setCode}: not in catalog`);
      continue;
    }

    console.log(`  ${set.code} ${set.name}: fetching catalog + prices...`);
    const cards = await catalog.fetchCards(set);

    const priceable: PriceableCard[] = cards.map((c, i) => ({
      cardId: `${set.code}-${c.number}-${i}`,
      name: c.name,
      number: c.number,
      rarity: c.rarity,
      externalIds: c.externalIds,
    }));

    const snapshots = await pokemonTcgIoPriceProvider.fetchCardPrices(set, priceable);
    const priceByExt = new Map(snapshots.map((s) => [s.externalCardId!, s.priceCents]));

    const priced: CardPriceData[] = priceable.map((c) => {
      const cents = priceByExt.get(c.externalIds["pokemontcg_io"] ?? "");
      const raw: Record<string, number> = {};
      if (cents !== undefined) raw["tcgplayer_market"] = cents;
      return { cardId: c.cardId, name: c.name, number: c.number, rarity: c.rarity, raw };
    });

    console.log(`    ${cards.length} cards, ${snapshots.length} priced`);

    for (const sp of SEALED_PRODUCTS[file.setCode] ?? []) {
      const sealed: Record<string, number> = {};
      if (sp.sealedCents !== null) sealed["tcgplayer_market"] = sp.sealedCents;

      products.push({
        gameSlug: "pokemon",
        gameName: "Pokémon TCG",
        setCode: set.code,
        setName: set.name,
        releaseDate: set.releaseDate,
        productId: `${set.code}-${sp.slug}`,
        productName: sp.name,
        productSlug: sp.slug,
        productType: sp.type,
        packsContained: sp.packsContained,
        msrpCents: sp.msrpCents,
        sealed,
        sealedIsPlaceholder: true,
        guaranteedCardIds: [],
        boxGuarantees: [],
        pullRates: {
          version: file.version,
          sampleSizePacks: file.sampleSizePacks,
          sourceUrl: file.sourceUrl,
          sourceNote: file.sourceNote,
          confidence: file.confidence,
          slots: file.slots,
          guaranteedSlots: file.guaranteedSlots,
          alternateEstimates: file.alternateEstimates,
        },
        cards: priced,
      });
    }
  }

  const payload: RankingsPayload = {
    generatedAt: new Date().toISOString(),
    availableSources: [{ id: "tcgplayer_market", displayName: "TCGplayer Market" }],
    products,
  };

  const dir = join(process.cwd(), "data", "fixtures");
  await mkdir(dir, { recursive: true });
  const out = join(dir, "payloads.json");
  await writeFile(out, JSON.stringify(payload, null, 1));

  console.log(`\nWrote ${products.length} products to data/fixtures/payloads.json`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("Fixture build failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
