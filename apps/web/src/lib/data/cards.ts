import { and, eq, ilike, inArray, sql } from "drizzle-orm";

import { cards, games, getDb, latestPrices, sets } from "@/lib/db";

/**
 * Card search + valuation for the collection tracker. Unlike the rankings data
 * layer (products, ISR), these run on demand from route handlers — a user
 * typing a search box can't be statically rendered.
 */

export interface CardHit {
  id: string;
  name: string;
  number: string;
  rarity: string;
  imageUrl: string | null;
  setCode: string;
  setName: string;
  game: string;
  /** Best raw market price across sources, cents; null if unpriced. */
  priceCents: number | null;
}

/** Highest raw price per card across sources (the collection's "current value"). */
async function pricesFor(cardIds: string[]): Promise<Map<string, number>> {
  if (cardIds.length === 0) return new Map();
  const db = getDb();
  const rows = await db
    .select({ cardId: latestPrices.cardId, cents: sql<number>`max(${latestPrices.priceCents})` })
    .from(latestPrices)
    .where(and(inArray(latestPrices.cardId, cardIds), eq(latestPrices.kind, "raw")))
    .groupBy(latestPrices.cardId);
  const out = new Map<string, number>();
  for (const r of rows) if (r.cardId) out.set(r.cardId, Number(r.cents));
  return out;
}

/** Search cards by name (optionally within a game), richest first. */
export async function searchCards(
  query: string,
  opts: { game?: string; limit?: number } = {},
): Promise<CardHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 60);

  const rows = await db
    .select({
      id: cards.id,
      name: cards.name,
      number: cards.number,
      rarity: cards.rarity,
      imageUrl: cards.imageUrl,
      treatment: cards.treatment,
      setCode: sets.code,
      setName: sets.name,
      game: games.slug,
    })
    .from(cards)
    .innerJoin(sets, eq(cards.setId, sets.id))
    .innerJoin(games, eq(sets.gameId, games.id))
    .where(
      and(
        ilike(cards.name, `%${q}%`),
        opts.game ? eq(games.slug, opts.game as "pokemon" | "one-piece" | "mtg") : undefined,
      ),
    )
    .limit(limit * 2);

  const priceByCard = await pricesFor(rows.map((r) => r.id));
  return rows
    .map((r) => ({
      id: r.id,
      name: r.treatment && r.treatment !== "base" ? `${r.name} (${labelTreatment(r.treatment)})` : r.name,
      number: r.number,
      rarity: r.rarity,
      imageUrl: r.imageUrl,
      setCode: r.setCode,
      setName: r.setName,
      game: r.game,
      priceCents: priceByCard.get(r.id) ?? null,
    }))
    .sort((a, b) => (b.priceCents ?? -1) - (a.priceCents ?? -1))
    .slice(0, limit);
}

/** Current value of specific cards (for a saved collection). */
export async function valueCards(cardIds: string[]): Promise<Map<string, number>> {
  return pricesFor([...new Set(cardIds)]);
}

export interface HistoryPoint {
  date: string;
  cents: number;
}

/** Daily raw-price history for one card (median across sources/runs). */
export async function getCardHistory(cardId: string, days = 180): Promise<HistoryPoint[]> {
  try {
    const db = getDb();
    const cutoffIso = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = await db.execute<{ day: string; cents: number | string }>(sql`
      select to_char(date(${latestPrices.capturedAt}), 'YYYY-MM-DD') as day,
             round(percentile_cont(0.5) within group (order by ps.price_cents))::int as cents
      from price_snapshots ps
      where ps.card_id = ${cardId}::uuid and ps.kind = 'raw'
        and ps.captured_at >= ${cutoffIso}::timestamptz
      group by date(ps.captured_at)
      order by day
    `);
    return [...rows].map((r) => ({ date: String(r.day), cents: Number(r.cents) }));
  } catch {
    return [];
  }
}

/**
 * Portfolio value over time for a set of holdings: for each day, sum(median
 * price that day × qty) over the cards that were priced that day. Thin until
 * the daily job accumulates snapshots; grows automatically.
 */
export async function getCollectionHistory(
  holdings: { cardId: string; qty: number }[],
  days = 180,
): Promise<HistoryPoint[]> {
  const qtyById = new Map(holdings.map((h) => [h.cardId, h.qty]));
  const ids = [...qtyById.keys()];
  if (ids.length === 0) return [];
  try {
    const db = getDb();
    const cutoffIso = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = await db.execute<{ card_id: string; day: string; cents: number | string }>(sql`
      select ps.card_id,
             to_char(date(ps.captured_at), 'YYYY-MM-DD') as day,
             round(percentile_cont(0.5) within group (order by ps.price_cents))::int as cents
      from price_snapshots ps
      where ps.card_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
        and ps.kind = 'raw' and ps.captured_at >= ${cutoffIso}::timestamptz
      group by ps.card_id, date(ps.captured_at)
    `);
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const qty = qtyById.get(String(r.card_id)) ?? 0;
      byDay.set(String(r.day), (byDay.get(String(r.day)) ?? 0) + Number(r.cents) * qty);
    }
    return [...byDay.entries()].map(([date, cents]) => ({ date, cents })).sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

const TREATMENT_LABELS: Record<string, string> = {
  alt_art: "Alt Art",
  manga: "Manga",
  wanted_poster: "Wanted Poster",
  treasure: "Treasure",
  sp: "SP",
  parallel: "Parallel",
};
function labelTreatment(t: string): string {
  return TREATMENT_LABELS[t] ?? t.replace(/_/g, " ");
}
