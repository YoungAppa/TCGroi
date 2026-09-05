import type { Metadata } from "next";
import Link from "next/link";

import { PokedexGrid } from "@/components/PokedexGrid";
import { getSpeciesIndex } from "@/lib/data/species";
import { formatCents } from "@packroi/ev/format";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Pokédex — every Pokémon's cards, prices and pull odds",
  description:
    "Every Pokémon from Bulbasaur to Pecharunt with all of its cards in one place: English, Japanese and Chinese printings, live prices, and which packs pull them.",
};

/**
 * The Pokédex hub: one tile per species linking to its card list. The page is
 * the crawlable index of every species page; the grid filters client-side.
 */
export default async function PokedexPage() {
  const species = await getSpeciesIndex();
  const withCards = species.filter((s) => s.cardCount > 0);
  const totalCards = withCards.reduce((n, s) => n + s.cardCount, 0);
  const mostPrinted = [...withCards].sort((a, b) => b.cardCount - a.cardCount).slice(0, 12);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Pokédex</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Pick a Pokémon to see every card it appears on — {totalCards.toLocaleString()} cards across{" "}
          {withCards.length.toLocaleString()} species, in English, Japanese and Chinese — with live prices and the
          packs that pull each one.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Most printed</h2>
        <div className="flex flex-wrap gap-2">
          {mostPrinted.map((s) => (
            <Link
              key={s.id}
              href={`/pokedex/${s.slug}`}
              className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 text-sm hover:border-accent/50"
            >
              {s.imageUrl && <img src={s.imageUrl} alt="" loading="lazy" className="h-7 w-7 object-contain" />}
              <span className="font-medium">{s.nameEn}</span>
              <span className="tabular text-xs text-muted">{s.cardCount}</span>
              {s.topPriceCents !== null && (
                <span className="tabular text-xs text-muted">· {formatCents(s.topPriceCents)}</span>
              )}
            </Link>
          ))}
        </div>
      </section>

      <PokedexGrid
        species={species.map(({ id, slug, nameEn, nameJa, nameZh, generation, cardCount, topPriceCents }) => ({
          id, slug, nameEn, nameJa, nameZh, generation, cardCount, topPriceCents,
        }))}
      />
    </div>
  );
}
