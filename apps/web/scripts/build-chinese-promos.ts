/**
 * Simplified-Chinese promo sets (SV-P, S-P, SM-P, 30th anniversary) from
 * tcg.mik.moe's promo files, priced from PriceCharting's "Pokemon Chinese
 * Promo" console whose product names carry the promo number ("#184/S-P").
 * The Chinese 151 Mew-style promos live here — cards that belong to no
 * expansion but are real, imaged and (where PC tracks them) priced.
 */
import { readFileSync, existsSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { cards, games, getDb, latestPrices, priceSnapshots, sets } from "@/lib/db";

const MIK = "https://tcg.mik.moe";
const CSV = process.argv[2]!;
const PROMOS: { code: string; name: string; pc: string | null }[] = [
  { code: "SVP", name: "朱&紫 促销卡 (SV-P)", pc: "SV-P" },
  { code: "SSP", name: "剑&盾 促销卡 (S-P)", pc: "S-P" },
  { code: "SMP", name: "太阳&月亮 促销卡 (SM-P)", pc: "SM-P" },
  { code: "30thP", name: "30周年 促销卡", pc: null },
];
const norm = (n: string) => n.replace(/^0+(?=\d)/, "");
function splitRow(line: string) {
  const first = line.indexOf(","); if (first < 0) return null;
  let rest = line.slice(first + 1);
  const take = () => { let v: string; if (rest.startsWith('"')) { const e = rest.indexOf('"', 1); v = rest.slice(1, e); rest = rest.slice(e + 2); } else { const e = rest.indexOf(","); v = rest.slice(0, e); rest = rest.slice(e + 1); } return v; };
  const c = take(); const p = take(); const dollars = Number(rest.split(",")[0]!.replace(/[$"]/g, ""));
  return { console: c, product: p, cents: Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null };
}
async function main() {
  const db = getDb();
  const [pk] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  const prices = new Map<string, Map<string, { cents: number; en: string }>>();
  for (const line of readFileSync(CSV, "utf8").split("\n").slice(1)) {
    const r = splitRow(line);
    if (!r || r.cents === null || r.console !== "Pokemon Chinese Promo") continue;
    const m = /^(.*?)\s*(?:\[[^\]]*\]\s*)?#\s*(\d+)\s*\/\s*(SV-P|S-P|SM-P)\b/i.exec(r.product.trim());
    if (!m) continue;
    const bucket = prices.get(m[3]!.toUpperCase()) ?? new Map();
    prices.set(m[3]!.toUpperCase(), bucket);
    const n = norm(m[2]!); const ex = bucket.get(n);
    if (!ex || r.cents > ex.cents) bucket.set(n, { cents: r.cents, en: m[1]!.trim() });
  }
  for (const p of PROMOS) {
    const file = `/tmp/mik/${p.code}.json`;
    if (!existsSync(file)) { console.log(`  ${p.code}: no cached file`); continue; }
    const j = JSON.parse(readFileSync(file, "utf8"));
    const mikCards: { cardIndex: string; cardName: string; rarity: string }[] = (j.data ?? j).cards ?? [];
    const [setRow] = await db.insert(sets).values({ gameId: pk!.id, code: p.code, name: p.name, language: "ZH", externalIds: { mik: p.code, ...(p.pc ? { pricecharting: "Promo" } : {}) } })
      .onConflictDoUpdate({ target: [sets.gameId, sets.code, sets.language], set: { externalIds: sql`${sets.externalIds} || excluded.external_ids`, updatedAt: new Date() } })
      .returning({ id: sets.id });
    const pr = p.pc ? prices.get(p.pc) : undefined;
    const rows = mikCards.map((c) => ({
      setId: setRow!.id, number: norm(c.cardIndex), name: c.cardName, rarity: "promo", treatment: "base",
      imageUrl: `${MIK}/static/img/${p.code}/${c.cardIndex}.png`,
      externalIds: { mik_rarity: c.rarity, ...(pr?.get(norm(c.cardIndex))?.en ? { name_en: pr.get(norm(c.cardIndex))!.en } : {}) },
    }));
    for (let i = 0; i < rows.length; i += 500) await db.insert(cards).values(rows.slice(i, i + 500)).onConflictDoNothing();
    let priced = 0;
    if (pr) {
      const written = await db.select({ id: cards.id, number: cards.number }).from(cards).where(and(eq(cards.setId, setRow!.id), eq(cards.treatment, "base")));
      const snaps = written.flatMap((w) => { const v = pr.get(norm(w.number)); return v ? [{ cardId: w.id, sourceId: "pricecharting_ebay", priceCents: v.cents, kind: "raw" as const, capturedAt: new Date() }] : []; });
      for (let i = 0; i < snaps.length; i += 500) {
        const chunk = snaps.slice(i, i + 500);
        await db.insert(priceSnapshots).values(chunk);
        await db.insert(latestPrices).values(chunk).onConflictDoUpdate({ target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind], targetWhere: sql`card_id is not null`, set: { priceCents: sql`excluded.price_cents`, capturedAt: sql`excluded.captured_at`, updatedAt: new Date() } });
      }
      priced = snaps.length;
    }
    console.log(`  + ${p.code} ${p.name}: ${rows.length} cards, ${priced} priced (PC has ${pr?.size ?? 0} ${p.pc ?? ""} rows)`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
