/**
 * Fill every fillable missing product image from Scrydex, and load + price the
 * Mega Charizard X ex UPC. Idempotent; logs what it cannot source.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { cards, games, getDb, latestPrices, priceSnapshots, sealedProducts, sets } from "@/lib/db";
import { loadSealedProducts } from "@/lib/jobs/refresh-catalog";

const H = { "X-Api-Key": process.env.TCGPLAYER_MIRROR_API_KEY!, "X-Team-ID": process.env.SCRYDEX_TEAM_ID!, accept: "application/json" };

interface ScryItem { name?: string; type?: string; images?: { large?: string; medium?: string }[] }
const img = (i?: ScryItem) => i?.images?.[0]?.large ?? i?.images?.[0]?.medium ?? null;

async function scrySealed(expId: string): Promise<ScryItem[]> {
  const r = await fetch(`https://api.scrydex.com/pokemon/v1/expansions/${encodeURIComponent(expId)}/sealed?page=1&page_size=100`, { headers: H });
  if (!r.ok) return [];
  return ((await r.json()).data ?? []) as ScryItem[];
}

/** Scrydex expansion id for a JP set code (e.g. S9 -> swsh9_ja). */
async function jpExpansionId(code: string): Promise<string | null> {
  const r = await fetch(`https://api.scrydex.com/pokemon/v1/expansions?q=${encodeURIComponent(`language_code:ja code:${code.toLowerCase()}`)}&page_size=3`, { headers: H });
  if (!r.ok) return null;
  const d = ((await r.json()).data ?? []) as { id?: string }[];
  return d[0]?.id ?? null;
}

/** Pick the Scrydex item for one of our products, conservatively. */
function pick(items: ScryItem[], slug: string): ScryItem | undefined {
  const named = (re: RegExp, not = /\bcase\b/i) => items.find((i) => re.test(i.name ?? "") && !not.test(i.name ?? ""));
  if (slug === "elite-trainer-box-pokemon-center")
    return named(/elite trainer/i, /\bcase\b/i) && items.find((i) => /elite trainer/i.test(i.name ?? "") && /pok[eé]mon center/i.test(i.name ?? ""));
  if (slug === "elite-trainer-box") return named(/elite trainer/i, /\bcase\b|pok[eé]mon center|plus\b/i);
  if (slug === "booster-box") return named(/booster box/i, /\bcase\b|pok[eé]mon center/i);
  if (slug === "booster-pack") return named(/booster pack/i, /\bcase\b|sleeved|blister/i) ?? named(/^pack$|booster/i, /\bcase\b|box|bundle|blister|sleeved/i);
  if (slug === "booster-bundle") return named(/bundle/i);
  if (slug === "team-rockets-moltres-ex-ultra-premium-collection") return named(/moltres/i);
  if (slug === "mega-charizard-x-ex-ultra-premium-collection") return named(/charizard x ex ultra.premium/i);
  return undefined;
}

async function main() {
  const db = getDb();
  const gameRows = await db.select({ id: games.id, slug: games.slug }).from(games);
  const pokeId = gameRows.find((g) => g.slug === "pokemon")!.id;

  // 1. Load the new UPC from the data file (idempotent for everything else).
  const n = await loadSealedProducts(new Map([["pokemon", pokeId]]));
  console.log("loader upserted", n, "products");

  // 2. Every Pokémon product still missing art.
  const missing = await db.select({
    id: sealedProducts.id, slug: sealedProducts.slug, code: sets.code,
    lang: sets.language, ext: sets.externalIds,
  }).from(sealedProducts).innerJoin(sets, eq(sealedProducts.setId, sets.id))
    .where(and(eq(sets.gameId, pokeId), isNull(sealedProducts.imageUrl), sql`${sets.language} != 'ZH'`));

  const cache = new Map<string, ScryItem[]>();
  let filled = 0; const unfillable: string[] = [];
  for (const m of missing) {
    const expId = m.lang === "JP" ? await jpExpansionId(m.code) : (m.ext["pokemontcg_io"] ?? m.code);
    if (!expId) { unfillable.push(`${m.lang} ${m.code}/${m.slug} (no scrydex expansion)`); continue; }
    if (!cache.has(expId)) cache.set(expId, await scrySealed(expId));
    const item = pick(cache.get(expId)!, m.slug);
    const url = img(item);
    if (!url) { unfillable.push(`${m.lang} ${m.code}/${m.slug}`); continue; }
    await db.update(sealedProducts).set({ imageUrl: url, updatedAt: new Date() }).where(eq(sealedProducts.id, m.id));
    console.log(`ART ${m.lang} ${m.code.padEnd(9)} ${m.slug.padEnd(42)} <- ${item!.name}`);
    filled++;
  }

  // 3. Price the Mega UPC from PriceCharting (median of sane matches).
  const [mega] = await db.select({ id: sealedProducts.id }).from(sealedProducts).innerJoin(sets, eq(sealedProducts.setId, sets.id))
    .where(and(eq(sets.code, "me2"), eq(sets.language, "EN"), eq(sealedProducts.slug, "mega-charizard-x-ex-ultra-premium-collection")));
  if (mega) {
    const r = await fetch(`https://www.pricecharting.com/api/products?t=${process.env.PRICECHARTING_TOKEN}&q=${encodeURIComponent("pokemon mega charizard x ultra premium collection")}`);
    const hits = (((await r.json()) as { products?: Record<string, unknown>[] }).products ?? []) as Record<string, any>[];
    const mine = hits.filter((p) => /charizard x.*ultra.premium|ultra.premium.*charizard x/i.test(p["product-name"] ?? "") && !/\bcase\b|japanese/i.test(p["product-name"] ?? "") && /^pokemon/i.test(p["console-name"] ?? "") && Number(p["loose-price"] ?? 0) > 0);
    for (const p of mine) console.log(`  PC: $${(p["loose-price"]/100).toFixed(2)} [${p["console-name"]}] ${p["product-name"]}`);
    if (mine.length > 0) {
      const prices = mine.map((p) => Number(p["loose-price"])).sort((a, b) => a - b);
      const cents = prices[Math.floor((prices.length - 1) / 2)]!;
      const snap = { sealedProductId: mega.id, sourceId: "pricecharting_ebay", priceCents: cents, kind: "sealed" as const, capturedAt: new Date() };
      await db.insert(priceSnapshots).values([snap]);
      await db.insert(latestPrices).values([snap]).onConflictDoUpdate({
        target: [latestPrices.sealedProductId, latestPrices.sourceId, latestPrices.kind],
        targetWhere: sql`${latestPrices.sealedProductId} IS NOT NULL`,
        set: { priceCents: sql`excluded.price_cents`, capturedAt: sql`excluded.captured_at`, updatedAt: new Date() },
      });
      console.log(`MEGA priced $${(cents / 100).toFixed(2)}`);
    } else console.log("MEGA: no PriceCharting price yet (brand new) — will rank once priced");
  }

  // 4. ZH gem packs: do their chase cards carry images (the tile fallback)?
  const zh = await db.execute(sql`
    select s.code, count(*) filter (where c.image_url is not null and lp.price_cents >= 500) as chase_imgs
    from sets s join cards c on c.set_id = s.id
    left join latest_prices lp on lp.card_id = c.id
    where s.language = 'ZH' group by s.code order by s.code`);
  console.log("ZH chase-image coverage:", JSON.stringify([...zh]));

  console.log(`\nfilled ${filled}; unfillable: ${unfillable.length}`);
  for (const u of unfillable) console.log("  MISSING SOURCE:", u);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
