/** Art fixes: wrong me5 bundle, PC-edition ETBs (standard box art), Moltres UPC, JP S9. */
import { and, eq, isNull, sql } from "drizzle-orm";
import { games, getDb, sealedProducts, sets } from "@/lib/db";

const H = { "X-Api-Key": process.env.TCGPLAYER_MIRROR_API_KEY!, "X-Team-ID": process.env.SCRYDEX_TEAM_ID!, accept: "application/json" };
interface ScryItem { name?: string; images?: { large?: string; medium?: string }[] }
const img = (i?: ScryItem) => i?.images?.[0]?.large ?? i?.images?.[0]?.medium ?? null;

async function scrySealed(expId: string): Promise<ScryItem[]> {
  const r = await fetch(`https://api.scrydex.com/pokemon/v1/expansions/${encodeURIComponent(expId)}/sealed?page_size=100`, { headers: H });
  return r.ok ? (((await r.json()).data ?? []) as ScryItem[]) : [];
}
async function searchSealed(q: string): Promise<ScryItem[]> {
  const r = await fetch(`https://api.scrydex.com/pokemon/v1/sealed?q=${encodeURIComponent(q)}&page_size=25`, { headers: H });
  return r.ok ? (((await r.json()).data ?? []) as ScryItem[]) : [];
}

async function main() {
  const db = getDb();
  const [pk] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  const setArt = async (code: string, lang: "EN" | "JP", slug: string, url: string, label: string) => {
    const res = await db.update(sealedProducts).set({ imageUrl: url, updatedAt: new Date() })
      .from(sets as never) // drizzle update-from workaround below instead
      .where(sql`false`);
    void res;
  };

  // Plain SQL updates keep this simple and set-scoped.
  async function fill(code: string, lang: string, slug: string, url: string, label: string) {
    await db.execute(sql`
      update sealed_products sp set image_url = ${url}, updated_at = now()
      from sets s where sp.set_id = s.id and s.game_id = ${pk!.id}
        and s.code = ${code} and s.language = ${lang} and sp.slug = ${slug} `);
    console.log(`ART ${lang} ${code.padEnd(9)} ${slug.padEnd(42)} <- ${label}`);
  }

  // 1. me5 bundle: the real Booster Bundle, not the "Art Bundle (Set of 4)".
  const me5 = await scrySealed("me5");
  const bundle = me5.find((i) => /booster bundle/i.test(i.name ?? "") && !/art bundle|case/i.test(i.name ?? ""));
  if (img(bundle)) await fill("me5", "EN", "booster-bundle", img(bundle)!, bundle!.name!);

  // 2. PC-edition ETBs: same box as the standard ETB (different promo inside);
  //    Scrydex has no PC-variant listing, so the standard box art stands in.
  const pcEtbs = await db.select({ code: sets.code, ext: sets.externalIds })
    .from(sealedProducts).innerJoin(sets, eq(sealedProducts.setId, sets.id))
    .where(and(eq(sets.gameId, pk!.id), eq(sets.language, "EN"), isNull(sealedProducts.imageUrl),
      eq(sealedProducts.slug, "elite-trainer-box-pokemon-center")));
  for (const p of pcEtbs) {
    const items = await scrySealed((p.ext as Record<string,string>)["pokemontcg_io"] ?? p.code);
    const etb = items.find((i) => /elite trainer box/i.test(i.name ?? "") && !/case|plus/i.test(i.name ?? ""));
    if (img(etb)) await fill(p.code, "EN", "elite-trainer-box-pokemon-center", img(etb)!, `${etb!.name} (standard box art)`);
    else console.log(`still no source: ${p.code} PC ETB`);
  }

  // 3. Moltres UPC: lives outside sv10 in Scrydex — find it by name.
  const moltres = (await searchSealed("name:*moltres*")).find((i) => /ultra.premium/i.test(i.name ?? "") && !/case/i.test(i.name ?? ""));
  if (img(moltres)) await fill("sv10", "EN", "team-rockets-moltres-ex-ultra-premium-collection", img(moltres)!, moltres!.name!);

  // 4. JP S9 box (retry — transient miss last pass).
  const s9 = await scrySealed("swsh9_ja");
  const box = s9.find((i) => /booster box/i.test(i.name ?? ""));
  if (img(box)) await fill("S9", "JP", "booster-box", img(box)!, box!.name!);

  const left = await db.execute(sql`
    select s.language, s.code, sp.slug from sealed_products sp
    join sets s on s.id = sp.set_id
    where s.game_id = ${pk!.id} and s.language != 'ZH' and sp.image_url is null`);
  console.log("remaining Pokémon products without art:", JSON.stringify([...left]));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
