import type { Metadata } from "next";
import Link from "next/link";

import { getDb, sets, games, cards, sealedProducts } from "@/lib/db";
import { eq, sql } from "drizzle-orm";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "All sets — every ranked and tracked TCG set",
  description:
    "Every Pokémon (EN/JP/中文), One Piece and Magic set on WhatsThatROI: ranked sets with sealed-product EV, plus tracked sets with full card lists and live prices.",
};

/**
 * The sets index — a browsable (and crawlable) hub linking every set page.
 * Ranked sets link to their EV pages; unranked ones to their card-list
 * fallback. Grouped by game, newest first, because that is how people browse.
 */
export default async function SetsPage() {
  const db = getDb();
  const rows = await db
    .select({
      code: sets.code,
      name: sets.name,
      language: sets.language,
      releaseDate: sets.releaseDate,
      gameSlug: games.slug,
      gameName: games.displayName,
      cardCount: sql<number>`count(distinct ${cards.id})::int`,
      productCount: sql<number>`count(distinct ${sealedProducts.id})::int`,
    })
    .from(sets)
    .innerJoin(games, eq(sets.gameId, games.id))
    .leftJoin(cards, eq(cards.setId, sets.id))
    .leftJoin(sealedProducts, eq(sealedProducts.setId, sets.id))
    .groupBy(sets.id, games.id)
    .having(sql`count(distinct ${cards.id}) > 0`);

  const byGame = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byGame.get(r.gameSlug) ?? [];
    list.push(r);
    byGame.set(r.gameSlug, list);
  }
  const LANG_LABEL: Record<string, string> = { EN: "English", JP: "日本語", ZH: "中文" };
  const GAME_ORDER = ["pokemon", "one-piece", "mtg"];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">All sets</h1>
        <p className="mt-1 text-sm text-muted">
          Ranked sets carry sealed-product EV from measured odds; the rest are fully
          tracked — cards, prices, images — and say so rather than borrowing numbers.
        </p>
      </div>
      {GAME_ORDER.filter((g) => byGame.has(g)).map((g) => {
        const list = byGame.get(g)!;
        const langs = [...new Set(list.map((s) => s.language))];
        return (
          <section key={g} className="space-y-4">
            <h2 className="font-display text-xl font-bold">{list[0]!.gameName}</h2>
            {langs.map((lang) => (
              <div key={lang} className="space-y-2">
                {langs.length > 1 && (
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {LANG_LABEL[lang] ?? lang}
                  </h3>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {list
                    .filter((s) => s.language === lang)
                    .sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""))
                    .map((s) => (
                      <Link
                        key={`${s.code}-${s.language}`}
                        href={`/${s.gameSlug}/${encodeURIComponent(s.code)}`}
                        className="flex items-baseline justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:border-accent/50"
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{s.name}</span>{" "}
                          <span className="tabular text-xs text-muted">{s.code}</span>
                        </span>
                        <span className="tabular shrink-0 text-xs text-muted">
                          {s.productCount > 0 ? `${s.productCount} products · ` : ""}
                          {s.cardCount} cards
                        </span>
                      </Link>
                    ))}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
