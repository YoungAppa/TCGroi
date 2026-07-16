/**
 * Live smoke-probe for the catalog adapters. Hits the real providers and
 * prints what we'd ingest — no DB writes.
 *
 * Not part of `npm test`: it depends on the network and on third-party
 * uptime, so it must never be able to fail CI. Run it by hand when adding a
 * provider or when a shape change is suspected.
 *
 *   npx tsx scripts/probe-catalog.ts
 */
import { OptcgApiAdapter } from "@/lib/catalog/providers/optcgapi";
import { PokemonTcgIoAdapter } from "@/lib/catalog/providers/pokemontcgio";
import type { CatalogAdapter, CatalogSet } from "@/lib/catalog/types";

function summarise(label: string, cards: { rarity: string; treatment: string }[]) {
  console.log(`\n  ${label}: ${cards.length} cards`);
  const byRarity = new Map<string, number>();
  for (const c of cards) byRarity.set(c.rarity, (byRarity.get(c.rarity) ?? 0) + 1);
  for (const [r, n] of [...byRarity].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${r.padEnd(30)} ${n}`);
  }
  const treatments = new Map<string, number>();
  for (const c of cards) treatments.set(c.treatment, (treatments.get(c.treatment) ?? 0) + 1);
  console.log(`    treatments: ${[...treatments].map(([t, n]) => `${t}=${n}`).join(", ")}`);
}

async function probe(adapter: CatalogAdapter, pick: (sets: CatalogSet[]) => CatalogSet) {
  console.log(`\n=== ${adapter.displayName} (${adapter.gameSlug}) ===`);
  const sets = await adapter.fetchSets();
  console.log(`  sets: ${sets.length}`);

  const set = pick(sets);
  console.log(`  probing: ${set.code} — ${set.name} (expects ${set.expectedCardCount ?? "?"})`);

  const cards = await adapter.fetchCards(set);
  summarise(set.code, cards);

  // The bug this whole design exists to prevent: identity must be
  // (number, treatment), never number alone.
  const byNumber = new Map<string, number>();
  for (const c of cards) byNumber.set(c.number, (byNumber.get(c.number) ?? 0) + 1);
  const collisions = [...byNumber].filter(([, n]) => n > 1);
  console.log(`    collector numbers with >1 printing: ${collisions.length}`);
  for (const [num] of collisions.slice(0, 3)) {
    const printings = cards.filter((c) => c.number === num);
    console.log(
      `      ${num}: ${printings.map((p) => `${p.treatment}/${p.rarity}`).join(" | ")}`,
    );
  }

  const dupIdentity = new Set<string>();
  let dupes = 0;
  for (const c of cards) {
    const k = `${c.number}::${c.treatment}`;
    if (dupIdentity.has(k)) dupes++;
    dupIdentity.add(k);
  }
  console.log(`    (number, treatment) collisions — must be 0: ${dupes}`);
}

async function main() {
  await probe(new PokemonTcgIoAdapter(), (sets) => {
    const s = sets.find((x) => x.code === "sv8");
    if (!s) throw new Error("sv8 (Surging Sparks) not found");
    return s;
  });

  await probe(new OptcgApiAdapter(), (sets) => {
    const s = sets.find((x) => x.code === "OP-09");
    if (!s) throw new Error("OP-09 not found");
    return s;
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nProbe failed:", err);
    process.exit(1);
  });
