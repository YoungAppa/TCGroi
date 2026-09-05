/**
 * Every Simplified-Chinese set tcg.mik.moe lists that the catalog lacks —
 * decks, gift boxes, battle-party packs, the special packs (对战派对 共梦 /
 * 耀梦, 游历专题包, 北上乡专题包) and the promo sets (SV-P, S-P, SM-P, 30thP,
 * MP) — created with their full card lists, mik CDN images and star grades.
 * Prices come from PriceCharting where a console exists for the set code, and
 * for promos from the "Pokemon Chinese Promo" console whose product names
 * carry "#184/S-P"-style numbers. Cards with no price stay unpriced.
 *
 * Reads /tmp/mik-sets.json + /tmp/mik/<code>.json (curl-prefetched; mik.moe
 * resets Node fetch) and the PriceCharting CSV saved by audit-pc-dump.ts.
 */
import { readFileSync, existsSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { cards, games, getDb, latestPrices, priceSnapshots, sets } from "@/lib/db";

const MIK = "https://tcg.mik.moe";
const CSV = process.argv[2]!;
const GRADE: Record<string, string> = {
  "●": "common", "◆": "uncommon", "★": "rare", "★★": "double_rare", "★★★": "cn_chase",
  C: "common", U: "uncommon", R: "rare", RR: "double_rare", AR: "illustration_rare", SR: "ultra_rare",
  SAR: "special_illustration_rare", UR: "hyper_rare", "无标记": "promo", "无": "promo",
};
const PROMO_CODE: Record<string, string> = { "SV-P": "SVP", "S-P": "SSP", "SM-P": "SMP" };
const norm = (n: string) => n.replace(/^0+(?=\d)/, "");

function splitRow(line: string): { console: string; product: string; cents: number | null } | null {
  const first = line.indexOf(",");
  if (first < 0) return null;
  let rest = line.slice(first + 1);
  let consoleName: string;
  if (rest.startsWith('"')) { const e = rest.indexOf('"', 1); consoleName = rest.slice(1, e); rest = rest.slice(e + 2); }
  else { const e = rest.indexOf(","); consoleName = rest.slice(0, e); rest = rest.slice(e + 1); }
  let product: string;
  if (rest.startsWith('"')) { const e = rest.indexOf('"', 1); product = rest.slice(1, e); rest = rest.slice(e + 2); }
  else { const e = rest.indexOf(","); product = rest.slice(0, e); rest = rest.slice(e + 1); }
  const dollars = Number(rest.split(",")[0]!.replace(/[$"]/g, ""));
  return { console: consoleName, product, cents: Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : null };
}

async function main() {
  const db = getDb();
  const [pk] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  const list: { setId: string; name: string; setCode: string; releaseDate?: string; cardsNum?: number }[] = (() => {
    const j = JSON.parse(readFileSync("/tmp/mik-sets.json", "utf8"));
    const d = j.data ?? j;
    if (Array.isArray(d)) return d;
    const inner = d.list ?? d.products ?? Object.values(d).find((v) => Array.isArray(v));
    if (!Array.isArray(inner)) throw new Error(`mik-sets.json: no array found (keys ${Object.keys(d).join(",")})`);
    return inner;
  })();
  const existing = await db.select({ id: sets.id, code: sets.code, ext: sets.externalIds }).from(sets)
    .where(and(eq(sets.gameId, pk!.id), eq(sets.language, "ZH")));
  const known = new Set<string>();
  for (const s of existing) { known.add(s.code.toLowerCase()); const m = (s.ext as any)?.mik; if (m) known.add(String(m).toLowerCase()); }

  // PriceCharting rows by console → number → cents (and promo rows by promo set code).
  const pcBySet = new Map<string, Map<string, number>>();
  for (const line of readFileSync(CSV, "utf8").split("\n").slice(1)) {
    const r = splitRow(line);
    if (!r || r.cents === null || !r.console.startsWith("Pokemon Chinese ")) continue;
    const suffix = r.console.slice("Pokemon Chinese ".length).trim();
    if (suffix === "Promo") {
      const m = /#\s*(\d+)\s*\/\s*(SV-P|S-P|SM-P)\b/i.exec(r.product);
      if (!m) continue;
      const code = PROMO_CODE[m[2]!.toUpperCase()]!;
      if (!pcBySet.has(code)) pcBySet.set(code, new Map());
      const bucket = pcBySet.get(code)!;
      const n = norm(m[1]!);
      bucket.set(n, Math.max(bucket.get(n) ?? 0, r.cents));
    } else {
      const m = /#\s*([A-Za-z0-9]+)\s*$/.exec(r.product.replace(/\s*\[[^\]]*\]\s*/g, " ").trim());
      if (!m) continue;
      const key = suffix.toLowerCase();
      if (!pcBySet.has(key)) pcBySet.set(key, new Map());
      const bucket = pcBySet.get(key)!;
      const n = norm(m[1]!);
      bucket.set(n, Math.max(bucket.get(n) ?? 0, r.cents));
    }
  }

  let setsMade = 0, cardsMade = 0, priced = 0;
  for (const m of list) {
    const code = m.setCode;
    if (known.has(code.toLowerCase()) || known.has(String(m.setId).toLowerCase())) continue;
    const file = `/tmp/mik/${code}.json`;
    if (!existsSync(file)) { console.log(`  ${code}: no cached card file`); continue; }
    const j = JSON.parse(readFileSync(file, "utf8"));
    const mikCards: { cardIndex: string; cardName: string; rarity: string }[] = (j.data ?? j).cards ?? [];
    if (mikCards.length === 0) { console.log(`  ${code}: 0 cards`); continue; }
    const release = m.releaseDate && !m.releaseDate.startsWith("0001") ? m.releaseDate.slice(0, 10) : null;
    const [setRow] = await db.insert(sets).values({
      gameId: pk!.id, code, name: m.name, language: "ZH", releaseDate: release,
      externalIds: { mik: String(m.setId) },
    }).onConflictDoNothing().returning({ id: sets.id });
    if (!setRow) { console.log(`  ${code}: set insert conflicted, skipped`); continue; }
    setsMade++;
    const rows = mikCards.map((c) => ({
      setId: setRow.id, number: norm(c.cardIndex), name: c.cardName,
      rarity: GRADE[c.rarity] ?? (c.rarity.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "unknown"),
      treatment: "base", imageUrl: `${MIK}/static/img/${m.setId}/${c.cardIndex}.png`,
      externalIds: { mik_rarity: c.rarity },
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await db.insert(cards).values(rows.slice(i, i + 500)).onConflictDoNothing();
    }
    cardsMade += rows.length;

    const prices = pcBySet.get(code) ?? pcBySet.get(code.toLowerCase());
    if (prices && prices.size) {
      const written = await db.select({ id: cards.id, number: cards.number }).from(cards).where(eq(cards.setId, setRow.id));
      const pr = written.flatMap((w) => {
        const cents = prices.get(norm(w.number));
        return cents ? [{ cardId: w.id, sourceId: "pricecharting_ebay", priceCents: cents, kind: "raw" as const, capturedAt: new Date() }] : [];
      });
      for (let i = 0; i < pr.length; i += 500) {
        const chunk = pr.slice(i, i + 500);
        await db.insert(priceSnapshots).values(chunk);
        await db.insert(latestPrices).values(chunk).onConflictDoUpdate({
          target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind],
          targetWhere: sql`card_id is not null`,
          set: { priceCents: sql`excluded.price_cents`, capturedAt: sql`excluded.captured_at`, updatedAt: new Date() },
        });
      }
      priced += pr.length;
      // Let the daily price job keep them fresh through the same console.
      await db.update(sets).set({ externalIds: sql`external_ids || ${JSON.stringify({ pricecharting: code })}::jsonb` }).where(eq(sets.id, setRow.id));
    }
    console.log(`  + ${code} ${m.name}: ${rows.length} cards, ${prices?.size ? `${prices.size} PC prices` : "no PC console"}`);
  }
  console.log(`\nZH missing sets: ${setsMade} sets, ${cardsMade} cards, ${priced} priced`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
