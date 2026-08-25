/**
 * Magic sealed art via MTGJSON -> TCGplayer image CDN.
 *
 * MTGJSON's per-set sealedProduct lists carry tcgplayerProductId for each real
 * product; TCGplayer's image CDN serves the packshot for any product id
 * publicly. That pair is the only working image source for Magic sealed
 * (Scryfall has no sealed, Scrydex no Magic, PriceCharting no images).
 *
 * Matching is by category + subtype: our "-collector" sets take the collector
 * booster box/pack; plain sets prefer play > draft > set > default — the same
 * order our EV models them. Every image URL is HEAD-checked before writing.
 */
import { eq } from "drizzle-orm";
import { games, getDb, sealedProducts, sets } from "@/lib/db";

const IMG = (id: string) => `https://product-images.tcgplayer.com/fit-in/437x437/${id}.jpg`;

interface SealedEntry { name?: string; category?: string; subtype?: string; identifiers?: { tcgplayerProductId?: string } }

const cache = new Map<string, SealedEntry[]>();
async function mtgjsonSealed(code: string): Promise<SealedEntry[]> {
  if (cache.has(code)) return cache.get(code)!;
  const r = await fetch(`https://mtgjson.com/api/v5/${code.toUpperCase()}.json`);
  const list: SealedEntry[] = r.ok ? (((await r.json()).data?.sealedProduct ?? []) as SealedEntry[]) : [];
  cache.set(code, list);
  return list;
}

const BOX_SUBTYPE_ORDER = ["play", "draft", "set", "default"];

function pick(list: SealedEntry[], slug: string): SealedEntry | undefined {
  const want = (cat: string, subs: string[]) =>
    subs.map((sub) => list.find((p) => p.category === cat && (p.subtype ?? "default") === sub && p.identifiers?.tcgplayerProductId))
      .find(Boolean);
  if (slug === "collector-booster-box") return want("booster_box", ["collector"]);
  if (slug === "collector-booster-pack") return want("booster_pack", ["collector"]);
  if (slug === "play-booster-box" || slug === "booster-box") return want("booster_box", BOX_SUBTYPE_ORDER);
  return undefined;
}

async function main() {
  const db = getDb();
  const [mtg] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "mtg"));
  const rows = await db.select({ id: sealedProducts.id, code: sets.code, slug: sealedProducts.slug, img: sealedProducts.imageUrl })
    .from(sealedProducts).innerJoin(sets, eq(sealedProducts.setId, sets.id)).where(eq(sets.gameId, mtg!.id));

  let filled = 0; const misses: string[] = [];
  for (const r of rows) {
    const base = r.code.replace(/-collector$/, "");
    const item = pick(await mtgjsonSealed(base), r.slug);
    const id = item?.identifiers?.tcgplayerProductId;
    if (!id) { misses.push(`${r.code}/${r.slug} (no MTGJSON match)`); continue; }
    const url = IMG(id);
    const head = await fetch(url, { method: "HEAD" });
    if (!head.ok) { misses.push(`${r.code}/${r.slug} (image ${head.status})`); continue; }
    await db.update(sealedProducts).set({ imageUrl: url, updatedAt: new Date() }).where(eq(sealedProducts.id, r.id));
    filled++;
    if (filled % 20 === 0) console.log(`  ...${filled} filled`);
  }
  console.log(`filled ${filled}/${rows.length}`);
  for (const m of misses) console.log("  MISS:", m);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
