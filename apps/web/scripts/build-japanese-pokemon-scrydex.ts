/**
 * Re-platform Japanese Pokémon onto Scrydex.
 *
 * The old TCGdex pipeline gave us a catalog with no prices and no usable
 * rarities — 7,591 of 8,159 JP cards sat at rarity "unknown", and the ranked
 * sets leaned on a value-band guess (a card worth $5-100 must be an ultra rare)
 * that was only ever a stopgap. Scrydex Growth carries 229 Japanese expansions
 * with a real `rarity_code` per card AND raw + graded prices, which removes the
 * guesswork entirely.
 *
 * What this does per Japanese expansion Scrydex knows about:
 *   - upserts the set (code = the Scrydex id minus its _ja suffix, upper-cased,
 *     which is how our existing JP codes are already written)
 *   - upserts every card with a rarity mapped from rarity_code, not inferred
 *   - writes raw prices
 *
 * Cards keep their identity of (set, number, treatment), so this UPDATES the
 * rows the TCGdex pass created rather than duplicating them: same set, same
 * collector number, now with a real rarity.
 *
 * Usage: tsx --env-file=.env.local scripts/build-japanese-pokemon-scrydex.ts [setCodePrefix]
 */
import { and, eq, sql } from "drizzle-orm";

import {
  cards,
  games,
  getDb,
  latestPrices,
  priceSnapshots,
  sets,
} from "@/lib/db";

const BASE = "https://api.scrydex.com";
const PAGE_SIZE = 100;

/**
 * Japanese rarity_code -> our normalized rarity.
 *
 * The Japanese game names its tiers differently from the English one, so this
 * is a mapping of MEANING, not of labels:
 *   RR  ダブルレア      Double Rare   — the ex tier, two black stars
 *   AR  アートレア      Art Rare      — full-art character illustration
 *   SR  スーパーレア     Super Rare    — full-art ex, English "ultra rare"
 *   SAR スペシャルアートレア Special Art Rare — English "special illustration rare"
 *   SSR 色違い超レア     Shiny Super Rare
 *   UR  ウルトラレア     Ultra Rare    — gold, English "hyper rare"
 *   MUR 超ウルトラレア    the Mega-era gold tier above UR
 * Anything unmapped is left for the caller to skip rather than guessed at.
 */
const JP_RARITY: Record<string, string> = {
  C: "common",
  U: "uncommon",
  R: "rare",
  RR: "double_rare",
  AR: "illustration_rare",
  SR: "ultra_rare",
  SAR: "special_illustration_rare",
  SSR: "shiny_ultra_rare",
  UR: "hyper_rare",
  MUR: "mega_hyper_rare",
  ACE: "ace_spec_rare",
  PROMO: "promo",
  "SHINY RARE": "shiny_rare",
  K: "shiny_rare",
  // --- Sword & Shield / Sun & Moon era codes (second pass) -----------------
  // RRR is the VMAX/VSTAR tier; English sets fold VMAX into their higher
  // bands, but JP tallies count it with RR as the guaranteed-multiple band,
  // so it lives with double_rare here and the pull tables treat them as one.
  RRR: "double_rare",
  // HR (rainbow) and the era's gold UR both map onto the hyper band, exactly
  // as the English catalog does.
  HR: "hyper_rare",
  // Character rares: CHR plays the illustration-rare role, CSR the special-
  // illustration role, a generation before those names existed.
  CHR: "illustration_rare",
  CSR: "special_illustration_rare",
  // Amazing Rare — a one-per-box-ish chase folded into the ultra band.
  A: "ultra_rare",
  // Mega Attack Rare (ME era), already in the vocabulary.
  MA: "mega_attack_rare",
  TR: "ultra_rare",
};

function credentials() {
  const key = process.env.TCGPLAYER_MIRROR_API_KEY;
  const teamId = process.env.SCRYDEX_TEAM_ID;
  if (!key || !teamId) {
    console.error("Scrydex credentials missing — set TCGPLAYER_MIRROR_API_KEY + SCRYDEX_TEAM_ID.");
    process.exit(1);
  }
  return { "X-Api-Key": key, "X-Team-ID": teamId, accept: "application/json" };
}

/** NM first — "raw card price" means near-mint everywhere else on the site. */
const CONDITION_ORDER = ["NM", "LP", "MP", "HP", "DM", "U"];

/**
 * The USD raw price, in dollars.
 *
 * Japanese cards carry BOTH a JPY and a USD entry for the same condition —
 * a common reads market 50 (JPY) and 0.09 (USD) — so the currency filter is
 * not optional here the way it nearly is for English. Taking whichever entry
 * came first read a 9-cent common as $50, a ~555x overstatement that would
 * have made every Japanese set look wildly +EV. Entries with no currency are
 * treated as USD, matching the English sets where the field is absent.
 */
function rawDollars(prices: Record<string, unknown>[] | undefined): number | null {
  if (!prices?.length) return null;
  const raws = prices.filter(
    (p) =>
      String(p.type ?? "raw").toLowerCase() === "raw" &&
      String(p.currency ?? "USD").toUpperCase() === "USD",
  );
  for (const cond of CONDITION_ORDER) {
    const e = raws.find((p) => p.condition === cond);
    const v = (e?.market ?? e?.low ?? e?.mid) as number | undefined;
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
}

async function getJson(url: string, headers: Record<string, string>) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  throw new Error(`gave up on ${url}`);
}

async function main() {
  const headers = credentials();
  const prefix = process.argv[2]?.toUpperCase();
  const db = getDb();

  const [game] = await db.select({ id: games.id }).from(games).where(eq(games.slug, "pokemon"));
  if (!game) throw new Error("pokemon game row missing — run db:seed");

  // Every Japanese expansion Scrydex knows about.
  const expansions: { id: string; name: string; release_date?: string; total?: number }[] = [];
  for (let page = 1; ; page++) {
    const b = await getJson(`${BASE}/pokemon/v1/expansions?page=${page}&page_size=${PAGE_SIZE}`, headers);
    const rows = b.data ?? [];
    expansions.push(...rows.filter((e: { language?: string }) => e.language === "Japanese"));
    if (!rows.length || page * (b.page_size ?? PAGE_SIZE) >= (b.total_count ?? 0)) break;
  }

  const targets = prefix
    ? expansions.filter((e) => e.id.replace(/_ja$/i, "").toUpperCase().startsWith(prefix))
    : expansions;
  console.log(`${expansions.length} Japanese expansions on Scrydex; ingesting ${targets.length}\n`);

  let setsDone = 0;
  let cardsDone = 0;
  let pricesDone = 0;
  let skippedRarity = 0;
  const failures: { set: string; error: string }[] = [];

  // Existing Japanese set codes, by lower-case form. Japanese codes are
  // mixed-case by convention ("SV4a", "SM11b", "neo1") while Scrydex ids are
  // lower ("sv4a_ja"), so upper-casing blindly MINTS A DUPLICATE SET beside the
  // real one — which is exactly what happened on the first run: 28 of them,
  // splitting a set's cards, products and pull table across two rows. Reuse the
  // existing casing whenever the set is already known.
  const existingCode = new Map<string, string>();
  for (const row of await db
    .select({ code: sets.code })
    .from(sets)
    .where(and(eq(sets.gameId, game.id), eq(sets.language, "JP")))) {
    existingCode.set(row.code.toLowerCase(), row.code);
  }

  for (const [i, exp] of targets.entries()) {
    const bare = exp.id.replace(/_ja$/i, "");
    const code = existingCode.get(bare.toLowerCase()) ?? bare.toUpperCase();
    try {
      const cardRows: Record<string, never>[] = [];
      for (let page = 1; ; page++) {
        const b = await getJson(
          `${BASE}/pokemon/v1/expansions/${encodeURIComponent(exp.id)}/cards?include=prices&page=${page}&page_size=${PAGE_SIZE}`,
          headers,
        );
        const rows = b.data ?? [];
        cardRows.push(...rows);
        if (!rows.length || page * (b.page_size ?? PAGE_SIZE) >= (b.total_count ?? 0)) break;
      }
      if (cardRows.length === 0) continue;

      // Upsert the set. Existing JP rows were created by the TCGdex pass under
      // this same code, so this attaches the Scrydex id to them rather than
      // creating a duplicate.
      const [setRow] = await db
        .insert(sets)
        .values({
          gameId: game.id,
          code,
          name: exp.name,
          language: "JP",
          // date column: ISO yyyy-mm-dd string, not a Date. Scrydex emits
          // "2024/10/18".
          releaseDate: exp.release_date ? exp.release_date.replace(/\//g, "-") : null,
          externalIds: { scrydex: exp.id },
        })
        .onConflictDoUpdate({
          target: [sets.gameId, sets.code, sets.language],
          set: {
            name: sql`excluded.name`,
            releaseDate: sql`excluded.release_date`,
            externalIds: sql`${sets.externalIds} || excluded.external_ids`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: sets.id });
      if (!setRow) continue;
      setsDone++;

      const toInsert: {
        setId: string;
        number: string;
        name: string;
        rarity: string;
        treatment: string;
        imageUrl: string | null;
        externalIds: Record<string, string>;
      }[] = [];
      const priceByNumber = new Map<string, number>();

      for (const c of cardRows as unknown as {
        id: string;
        name?: string;
        number?: string;
        rarity_code?: string;
        rarity?: string;
        images?: { type?: string; large?: string; medium?: string }[];
        variants?: { prices?: Record<string, unknown>[] }[];
      }[]) {
        const codeKey = String(c.rarity_code ?? c.rarity ?? "").toUpperCase().trim();
        const rarity = JP_RARITY[codeKey];
        // No guessing: a tier we can't name can't be priced into EV honestly.
        if (!rarity) {
          skippedRarity++;
          continue;
        }
        const number = String(c.number ?? c.id.split("-").pop() ?? "").trim();
        if (!number) continue;
        const img = c.images?.find((x) => x.type === "front") ?? c.images?.[0];

        toInsert.push({
          setId: setRow.id,
          number,
          name: c.name ?? c.id,
          rarity,
          treatment: "base",
          imageUrl: img?.large ?? img?.medium ?? null,
          externalIds: { scrydex: c.id },
        });

        let dollars: number | null = null;
        for (const v of c.variants ?? []) {
          dollars = rawDollars(v.prices);
          if (dollars !== null) break;
        }
        if (dollars !== null) priceByNumber.set(number, Math.round(dollars * 100));
      }

      for (let j = 0; j < toInsert.length; j += 500) {
        await db
          .insert(cards)
          .values(toInsert.slice(j, j + 500))
          .onConflictDoUpdate({
            target: [cards.setId, cards.number, cards.treatment],
            set: {
              name: sql`excluded.name`,
              rarity: sql`excluded.rarity`,
              imageUrl: sql`coalesce(excluded.image_url, ${cards.imageUrl})`,
              externalIds: sql`${cards.externalIds} || excluded.external_ids`,
              updatedAt: new Date(),
            },
          });
      }
      cardsDone += toInsert.length;

      // Prices, resolved back to the rows just written.
      const written = await db
        .select({ id: cards.id, number: cards.number })
        .from(cards)
        .where(and(eq(cards.setId, setRow.id), eq(cards.treatment, "base")));
      const priceRows = written.flatMap((w) => {
        const cents = priceByNumber.get(w.number);
        return cents === undefined
          ? []
          : [{
              cardId: w.id,
              sourceId: "tcgplayer_market",
              priceCents: cents,
              kind: "raw" as const,
              capturedAt: new Date(),
            }];
      });
      for (let j = 0; j < priceRows.length; j += 500) {
        const chunk = priceRows.slice(j, j + 500);
        await db.insert(priceSnapshots).values(chunk);
        await db
          .insert(latestPrices)
          .values(chunk)
          .onConflictDoUpdate({
            target: [latestPrices.cardId, latestPrices.sourceId, latestPrices.kind],
            targetWhere: sql`${latestPrices.cardId} IS NOT NULL`,
            set: {
              priceCents: sql`excluded.price_cents`,
              capturedAt: sql`excluded.captured_at`,
              updatedAt: new Date(),
            },
          });
      }
      pricesDone += priceRows.length;

      console.log(
        `[${i + 1}/${targets.length}] ${code.padEnd(10)} ${String(toInsert.length).padStart(4)} cards, ${String(priceRows.length).padStart(4)} priced  ${exp.name}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ set: code, error: msg });
      console.log(`[${i + 1}/${targets.length}] ${code.padEnd(10)} FAILED: ${msg.slice(0, 80)}`);
    }
  }

  console.log(
    `\nDone. ${setsDone} sets, ${cardsDone} cards, ${pricesDone} prices. ` +
      `${skippedRarity} cards skipped for an unmapped rarity. ${failures.length} failures.`,
  );
  for (const f of failures) console.log(`  ${f.set}: ${f.error.slice(0, 120)}`);
  process.exit(0);
}

main();
