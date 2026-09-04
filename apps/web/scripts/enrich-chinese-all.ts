/**
 * Full Simplified-Chinese catalog enrichment from tcg.mik.moe — the general
 * version of enrich-chinese-gempacks.ts, covering every OTHER ZH set.
 *
 * Before this, only the five Gem Packs had Chinese names, images and real
 * rarities; the other ~74 ZH sets displayed their PriceCharting artifacts:
 * English card names, rarity "unknown", raw codes ("CSV5C") as set names, and
 * zero images. mik.moe carries the full official catalog, so each matched set
 * gets:
 *   - its real Chinese set name (黑晶炽诚, not CSV5C) — set codes still show
 *   - Chinese card names (variant treatments stay on the treatment column)
 *   - card images from mik's CDN
 *   - real rarities mapped onto the site's existing slugs (C/U/R/RR/AR/SR/
 *     SAR/UR -> common/…/hyper_rare); the raw grade is kept in
 *     external_ids->mik_rarity
 *   - the cards PriceCharting's price floor dropped (inserted unpriced)
 *
 * Gem Packs are SKIPPED — already enriched, and their cn_chase/display_only
 * tags must not be touched. Non-destructive and idempotent everywhere else:
 * images only fill NULLs, rarities only replace "unknown".
 *
 *   npx tsx --env-file=.env.local scripts/enrich-chinese-all.ts
 */
import { readFile } from "node:fs/promises";

import { and, eq, sql } from "drizzle-orm";

import { cards, games, getDb, sets } from "@/lib/db";

const MIK = "https://tcg.mik.moe";

/** mik grade -> our rarity slug. Unlisted grades fall back to a slugified
 *  lowercase of the grade itself (display-only sets; label prettifies it). */
const GRADE: Record<string, string> = {
  C: "common",
  U: "uncommon",
  R: "rare",
  RR: "double_rare",
  RRR: "triple_rare",
  AR: "illustration_rare",
  SR: "ultra_rare",
  SAR: "special_illustration_rare",
  UR: "hyper_rare",
  HR: "hyper_rare",
  K: "radiant_rare",
  A: "amazing_rare",
  CHR: "character_rare",
  CSR: "character_super_rare",
  S: "shiny_rare",
  SSR: "shiny_super_rare",
  PR: "prism_star",
  TR: "trainer_rare",
  P: "promo",
};

/** Our set code for a mik setId: lowercase, "." -> "-". */
const ourCode = (mikId: string) => mikId.toLowerCase().replace(/\./g, "-");

/** Manual bridges where PriceCharting console names became our codes. */
const MANUAL: Record<string, string> = {
  "151-collect": "151C",
  "start-deck-100": "CS4DaC",
};

const norm = (n: string) => n.replace(/^0+(?=\d)/, "");

interface MikSet { setId: string; name: string; cardsNum: number }
interface MikCard { cardIndex: string; cardName: string; rarity: string }

async function mikList(): Promise<MikSet[]> {
  const d = JSON.parse(await readFile("/tmp/mik-sets.json", "utf8"));
  return d.data.list as MikSet[];
}
async function mikDetail(setId: string): Promise<{ name: string; cards: MikCard[] }> {
  const d = JSON.parse(await readFile(`/tmp/mik/${setId.replace(/\//g, "_")}.json`, "utf8"));
  return d.data as { name: string; cards: MikCard[] };
}

async function main() {
  const db = getDb();
  const [pk] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  const zhSets = await db
    .select({ id: sets.id, code: sets.code, name: sets.name })
    .from(sets)
    .where(and(eq(sets.gameId, pk!.id), eq(sets.language, "ZH")));

  const mikSets = await mikList();
  const mikByOurCode = new Map<string, MikSet>();
  for (const m of mikSets) mikByOurCode.set(ourCode(m.setId), m);
  for (const [ours, mikId] of Object.entries(MANUAL)) {
    const m = mikSets.find((x) => x.setId === mikId);
    if (m) mikByOurCode.set(ours, m);
  }

  let setsDone = 0, renamed = 0, cardsUpdated = 0, cardsInserted = 0, imagesSet = 0;
  const unmatched: string[] = [];

  for (const s of zhSets) {
    if (/^gem-pack/.test(s.code)) continue; // already enriched; tags protected
    const mik = mikByOurCode.get(s.code);
    if (!mik) { unmatched.push(`${s.code} (${s.name})`); continue; }

    const detail = await mikDetail(mik.setId);
    const byNum = new Map<string, MikCard>();
    for (const c of detail.cards) byNum.set(norm(c.cardIndex), c);

    // Set name -> real Chinese name, code preserved separately.
    if (s.name !== detail.name) {
      await db.update(sets).set({
        name: detail.name,
        externalIds: sql`external_ids || ${JSON.stringify({ mik: mik.setId })}::jsonb`,
        updatedAt: new Date(),
      }).where(eq(sets.id, s.id));
      renamed++;
    }

    const ours = await db.select({ id: cards.id, number: cards.number, rarity: cards.rarity, imageUrl: cards.imageUrl })
      .from(cards).where(eq(cards.setId, s.id));
    const seen = new Set<string>();
    for (const c of ours) {
      const m = byNum.get(norm(c.number));
      if (!m) continue;
      seen.add(norm(c.number));
      const slug = GRADE[m.rarity] ?? m.rarity.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const img = `${MIK}/static/img/${mik.setId}/${m.cardIndex}.png`;
      await db.update(cards).set({
        name: m.cardName,
        rarity: c.rarity === "unknown" ? slug : c.rarity,
        imageUrl: c.imageUrl ?? img,
        externalIds: sql`external_ids || ${JSON.stringify({ mik_rarity: m.rarity })}::jsonb`,
        updatedAt: new Date(),
      }).where(eq(cards.id, c.id));
      cardsUpdated++;
      if (!c.imageUrl) imagesSet++;
    }

    // Cards mik has that PriceCharting's floor dropped — inserted unpriced.
    const missing = detail.cards.filter((m) => !seen.has(norm(m.cardIndex)));
    if (missing.length > 0) {
      await db.insert(cards).values(missing.map((m) => ({
        setId: s.id,
        name: m.cardName,
        number: norm(m.cardIndex),
        rarity: GRADE[m.rarity] ?? m.rarity.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        treatment: "base",
        imageUrl: `${MIK}/static/img/${mik.setId}/${m.cardIndex}.png`,
        externalIds: { mik_rarity: m.rarity },
      }))).onConflictDoNothing();
      cardsInserted += missing.length;
      imagesSet += missing.length;
    }

    setsDone++;
    if (setsDone % 15 === 0) console.log(`  ...${setsDone} sets`);
  }

  console.log(`sets enriched: ${setsDone} (${renamed} renamed) | cards updated: ${cardsUpdated}, inserted: ${cardsInserted}, images set: ${imagesSet}`);
  console.log(`unmatched (${unmatched.length}):`, unmatched.join(", "));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
