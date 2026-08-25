/**
 * Create every modellable standard Pokémon tin as a ranked product.
 *
 * Included: tins whose Scrydex description states the pack count. Own-set
 * tins ride the set's own table; assorted tins ("N Pokémon TCG booster
 * packs", sets unstated) are modelled as a uniform draw across the era's
 * ranked main sets released by then — same precedent as the assorted UPCs.
 * Excluded, with reasons logged: mini tins (7-card mini packs, no odds
 * exist), multi-tin bundles ("Set of 2/3"), and tins whose contents no
 * source states. NO tin-specific pull-rate study exists anywhere (checked
 * 2026-08-26); every tin uses its packs' own measured odds and says so.
 *
 * Entries are written into data/products/pokemon.json (so rebuilds keep
 * them), then loaded, art'd from Scrydex and priced from PriceCharting.
 */
import { readFile, writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { games, getDb, latestPrices, priceSnapshots, pullRateTables, sealedProducts, sets } from "@/lib/db";
import { loadSealedProducts } from "@/lib/jobs/refresh-catalog";

const H = { "X-Api-Key": process.env.TCGPLAYER_MIRROR_API_KEY!, "X-Team-ID": process.env.SCRYDEX_TEAM_ID!, accept: "application/json" };
const ERA = [/^swsh\d+$/, /^sv\d+$/, /^me\d+$/, /^sm\d+$/, /^xy\d+$/, /^bw\d+$/];

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

async function main() {
  const db = getDb();
  const [pk] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  const ranked = await db.select({ id: sets.id, code: sets.code, name: sets.name, ext: sets.externalIds, release: sets.releaseDate })
    .from(sets).innerJoin(pullRateTables, and(eq(pullRateTables.setId, sets.id), eq(pullRateTables.isActive, true)))
    .where(and(eq(sets.gameId, pk!.id), eq(sets.language, "EN")));

  const file = JSON.parse(await readFile("data/products/pokemon.json", "utf8"));
  const existing = new Set(file.products.map((p: { slug: string }) => p.slug));
  let added = 0;
  const artBySlug = new Map<string, string>();
  const pcQueryBySlug = new Map<string, string>();

  for (const s of ranked) {
    const expId = (s.ext as Record<string, string>)["pokemontcg_io"] ?? s.code;
    const r = await fetch(`https://api.scrydex.com/pokemon/v1/expansions/${encodeURIComponent(expId)}/sealed?page_size=100`, { headers: H });
    if (!r.ok) continue;
    const items = ((await r.json()).data ?? []) as { name?: string; description?: string; images?: { large?: string; medium?: string }[] }[];
    for (const i of items) {
      const name = i.name ?? "";
      if (!/\btin\b/i.test(name)) continue;
      if (/\bcase\b|display|bundle|set of \d/i.test(name)) continue;
      const d = String(i.description ?? "").replace(/\s+/g, " ");
      // Counts appear as digits ("4 Pokémon TCG booster packs") or words
      // ("comes with two booster packs" — the Mini Tin phrasing). Pokémon
      // mini tins hold 2 STANDARD boosters, so they model like any tin.
      const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };
      const m = /(\d+)\s+Pok[eé]mon TCG(?::\s*([^•]*?))?\s*booster packs?/i.exec(d);
      const w = m ? null : /\b(two|three|four|five|six)\s+booster packs?/i.exec(d);
      if (!m && !w) continue;
      const packs = m ? Number(m[1]) : WORDS[w![1]!.toLowerCase()]!;
      if (packs < 2 || packs > 8) continue;
      const statedSet = ((m ? m[2] : null) ?? "").trim();
      // Special sets (151, Paldean Fates, Prismatic…) have product-exclusive
      // packs: a tin under such a set can only contain that set's packs, even
      // when the blurb doesn't say so. Main-set tins with unstated packs are
      // genuinely assorted and get the era blend.
      const isSpecialSet = /pt\d/.test(s.code);
      const isOwn = isSpecialSet || statedSet.toLowerCase().includes(s.name.toLowerCase());
      const slug = slugify(name);
      if (existing.has(slug)) continue;

      let componentPacks: { setCode: string; count: number }[] = [];
      let note: string;
      const rateNote =
        "No tin-specific pull-rate study exists anywhere we could find (checked 2026-08-26) — " +
        "packs in tins come from the same printings, so the set's own measured pack odds apply. " +
        "The tin's promo card(s) are not modelled, so EV understates the tin's full contents.";
      if (isOwn) {
        note = `The publisher's listing states ${packs} ${s.name} booster packs. ${rateNote}`;
      } else {
        const era = ERA.find((re) => re.test(s.code));
        if (!era) continue;
        const eraSets = ranked.filter((x) => era.test(x.code) && (x.release ?? "") <= (s.release ?? "9999"));
        if (eraSets.length === 0) continue;
        componentPacks = eraSets.map((x) => ({ setCode: x.code, count: Math.round((packs / eraSets.length) * 10000) / 10000 }));
        note =
          `The publisher's listing states ${packs} Pokémon TCG booster packs without naming sets. ` +
          `EV models the assortment as a uniform draw across the ${eraSets.length} ranked main sets of this era ` +
          `released by then, each priced with its own odds; the real mix in any one tin will differ. ${rateNote}`;
      }

      file.products.push({
        setCode: s.code,
        name: `${name} (${packs} packs)`,
        slug,
        type: "tin",
        packsContained: packs,
        msrpCents: null,
        ...(componentPacks.length > 0 ? { componentPacks } : {}),
        contentsNote: note,
      });
      existing.add(slug);
      added++;
      const img = i.images?.[0]?.large ?? i.images?.[0]?.medium;
      if (img) artBySlug.set(slug, img);
      pcQueryBySlug.set(slug, `pokemon ${name}`);
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  await writeFile("data/products/pokemon.json", JSON.stringify(file, null, 2) + "\n");
  console.log(`data file: +${added} tins`);

  const n = await loadSealedProducts(new Map([["pokemon", pk!.id]]));
  console.log("loader upserted", n, "products");

  // art + prices
  let priced = 0, unpriced = 0;
  for (const [slug, img] of artBySlug) {
    await db.execute(sql`update sealed_products set image_url = ${img}, updated_at = now() where slug = ${slug} and image_url is null`);
  }
  for (const [slug, q] of pcQueryBySlug) {
    const [row] = await db.select({ id: sealedProducts.id, name: sealedProducts.name }).from(sealedProducts).where(eq(sealedProducts.slug, slug));
    if (!row) continue;
    const r = await fetch(`https://www.pricecharting.com/api/products?t=${process.env.PRICECHARTING_TOKEN}&q=${encodeURIComponent(q)}`);
    const hits = (((await r.json()) as { products?: Record<string, any>[] }).products ?? []);
    // The tin's distinguishing tokens (mascot etc.) must appear in the PC name.
    const distinct = row.name.toLowerCase().match(/tin\s*-\s*([^(]+)/)?.[1]?.trim().split(/\s+/).filter(w => w.length > 2) ?? [];
    const mine = hits.filter((p) => {
      const pn = String(p["product-name"] ?? "").toLowerCase();
      return /tin/.test(pn) && !/\bcase\b|japanese|set of/i.test(pn) &&
        /^pokemon/i.test(p["console-name"] ?? "") && Number(p["loose-price"] ?? 0) > 0 &&
        distinct.every((w) => pn.includes(w));
    });
    if (mine.length === 0) { unpriced++; console.log(`  no price: ${slug}`); continue; }
    const prices = mine.map((p) => Number(p["loose-price"])).sort((a, b) => a - b);
    const cents = prices[Math.floor((prices.length - 1) / 2)]!;
    const snap = { sealedProductId: row.id, sourceId: "pricecharting_ebay", priceCents: cents, kind: "sealed" as const, capturedAt: new Date() };
    await db.insert(priceSnapshots).values([snap]);
    await db.insert(latestPrices).values([snap]).onConflictDoUpdate({
      target: [latestPrices.sealedProductId, latestPrices.sourceId, latestPrices.kind],
      targetWhere: sql`${latestPrices.sealedProductId} IS NOT NULL`,
      set: { priceCents: sql`excluded.price_cents`, capturedAt: sql`excluded.captured_at`, updatedAt: new Date() },
    });
    priced++;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`priced ${priced}, unpriced ${unpriced}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
