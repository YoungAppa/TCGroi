/**
 * The Pokédex layer: species pages that list every card of one Pokémon across
 * sets and languages. Built on the card_species junction (scripts/build-species.ts).
 * Everything here reads the live DB (ISR pages), never the rankings payload.
 */
import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";

export interface SpeciesSummary {
  id: number;
  slug: string;
  nameEn: string;
  nameJa: string | null;
  nameZh: string | null;
  generation: number | null;
  imageUrl: string | null;
  cardCount: number;
  topPriceCents: number | null;
}

export interface SpeciesCard {
  cardId: string;
  name: string;
  nameEn: string | null;
  number: string;
  rarity: string;
  imageUrl: string | null;
  setCode: string;
  setName: string;
  language: "EN" | "JP" | "ZH";
  releaseDate: string | null;
  priceCents: number | null;
}

export interface SpeciesPage extends SpeciesSummary {
  cards: SpeciesCard[];
  setCount: number;
}

/** Every species, national-dex order, with card counts and the priciest card. */
export async function getSpeciesIndex(): Promise<SpeciesSummary[]> {
  const db = getDb();
  const rows = await db.execute<{
    id: number; slug: string; name_en: string; name_ja: string | null; name_zh: string | null;
    generation: number | null; image_url: string | null; card_count: string; top: string | null;
  }>(sql`
    select p.id, p.slug, p.name_en, p.name_ja, p.name_zh, p.generation, p.image_url,
           count(distinct (c.set_id, c.number)) as card_count, max(lp.price_cents) as top
    from pokemon_species p
    left join card_species cs on cs.species_id = p.id
    left join cards c on c.id = cs.card_id
    left join latest_prices lp on lp.card_id = cs.card_id and lp.kind = 'raw'
    group by p.id
    order by p.id`);
  return [...rows].map((r) => ({
    id: Number(r.id), slug: r.slug, nameEn: r.name_en, nameJa: r.name_ja, nameZh: r.name_zh,
    generation: r.generation === null ? null : Number(r.generation), imageUrl: r.image_url,
    cardCount: Number(r.card_count), topPriceCents: r.top === null ? null : Number(r.top),
  }));
}

/** One species with every card of it, richest first, one row per printed card (set+number). */
export async function getSpeciesPage(slug: string): Promise<SpeciesPage | null> {
  const db = getDb();
  const sp = await db.execute<{
    id: number; slug: string; name_en: string; name_ja: string | null; name_zh: string | null;
    generation: number | null; image_url: string | null;
  }>(sql`select id, slug, name_en, name_ja, name_zh, generation, image_url from pokemon_species where slug = ${slug}`);
  const s = [...sp][0];
  if (!s) return null;

  const rows = await db.execute<{
    id: string; name: string; name_en: string | null; number: string; rarity: string; image_url: string | null;
    code: string; set_name: string; language: "EN" | "JP" | "ZH"; release_date: string | null; cents: string | null;
  }>(sql`
    select c.id, c.name, c.external_ids->>'name_en' as name_en, c.number, c.rarity, c.image_url,
           s.code, s.name as set_name, s.language, s.release_date::text as release_date, max(lp.price_cents) as cents
    from card_species cs
    join cards c on c.id = cs.card_id
    join sets s on s.id = c.set_id
    left join latest_prices lp on lp.card_id = c.id and lp.kind = 'raw'
    where cs.species_id = ${s.id}
    group by c.id, s.id`);

  // A card page is keyed by set+number and shows the priciest printing, so one
  // row per printed card here too — the same printing the page will open on.
  const byKey = new Map<string, SpeciesCard>();
  for (const r of [...rows]) {
    const key = `${r.language}/${r.code}/${r.number}`;
    const cents = r.cents === null ? null : Number(r.cents);
    const ex = byKey.get(key);
    if (ex && (ex.priceCents ?? -1) >= (cents ?? -1)) continue;
    byKey.set(key, {
      cardId: r.id, name: r.name, nameEn: r.name_en && r.name_en !== r.name ? r.name_en : null, number: r.number,
      rarity: r.rarity, imageUrl: r.image_url, setCode: r.code, setName: r.set_name, language: r.language,
      releaseDate: r.release_date, priceCents: cents,
    });
  }
  const cards = [...byKey.values()].sort(
    (a, b) => (b.priceCents ?? -1) - (a.priceCents ?? -1) || (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""),
  );
  const sets = new Set(cards.map((c) => `${c.language}/${c.setCode}`));
  return {
    id: Number(s.id), slug: s.slug, nameEn: s.name_en, nameJa: s.name_ja, nameZh: s.name_zh,
    generation: s.generation === null ? null : Number(s.generation), imageUrl: s.image_url,
    cardCount: cards.length, topPriceCents: cards[0]?.priceCents ?? null, cards, setCount: sets.size,
  };
}

/** Species whose name (any language) starts with / contains the query — for the search dropdown. */
export async function searchSpecies(query: string, limit = 4): Promise<SpeciesSummary[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const db = getDb();
  const rows = await db.execute<{
    id: number; slug: string; name_en: string; name_ja: string | null; name_zh: string | null;
    generation: number | null; image_url: string | null; card_count: string; top: string | null;
  }>(sql`
    select p.id, p.slug, p.name_en, p.name_ja, p.name_zh, p.generation, p.image_url,
           count(distinct (c.set_id, c.number)) as card_count, max(lp.price_cents) as top
    from pokemon_species p
    join card_species cs on cs.species_id = p.id
    join cards c on c.id = cs.card_id
    left join latest_prices lp on lp.card_id = cs.card_id and lp.kind = 'raw'
    where p.name_en ilike ${q + "%"} or p.name_ja like ${q + "%"} or p.name_zh like ${q + "%"}
    group by p.id
    order by (p.name_en ilike ${q}) desc, count(distinct (c.set_id, c.number)) desc
    limit ${limit}`);
  return [...rows].map((r) => ({
    id: Number(r.id), slug: r.slug, nameEn: r.name_en, nameJa: r.name_ja, nameZh: r.name_zh,
    generation: r.generation === null ? null : Number(r.generation), imageUrl: r.image_url,
    cardCount: Number(r.card_count), topPriceCents: r.top === null ? null : Number(r.top),
  }));
}

/** The species a card depicts (two for a tag team), for the card page's cross-link. */
export async function getSpeciesForCard(cardId: string): Promise<{ slug: string; nameEn: string; cardCount: number }[]> {
  try {
    const db = getDb();
    const rows = await db.execute<{ slug: string; name_en: string; n: string }>(sql`
      select p.slug, p.name_en,
             (select count(distinct (c.set_id, c.number)) from card_species x join cards c on c.id = x.card_id where x.species_id = p.id) as n
      from card_species cs join pokemon_species p on p.id = cs.species_id
      where cs.card_id = ${cardId}::uuid`);
    return [...rows].map((r) => ({ slug: r.slug, nameEn: r.name_en, cardCount: Number(r.n) }));
  } catch {
    return [];
  }
}
