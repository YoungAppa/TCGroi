import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { OptcgApiAdapter } from "@/lib/catalog/providers/optcgapi";
import { PokemonTcgIoAdapter } from "@/lib/catalog/providers/pokemontcgio";
import { ScrydexCatalogAdapter } from "@/lib/catalog/providers/scrydex";
import type { CatalogAdapter, CatalogSet } from "@/lib/catalog/types";
import { fetchScrydexSealedImages } from "@/lib/prices/providers/scrydex-prices";
import { cards, games, getDb, pullRateTables, sealedProducts, sets } from "@/lib/db";
import { loadAllPullRates } from "@/lib/pullrates/load";

import { runJob } from "./run";

/**
 * refresh-catalog: sets + cards from the catalog adapters into the DB, then
 * pull-rate files into pull_rate_tables.
 *
 * Idempotent: everything is an upsert keyed on the natural identity —
 * (game, code, language) for sets, (set, number, treatment) for cards,
 * (set, version) for pull-rate tables. Run it twice, get the same DB.
 *
 * Scope: Pokémon ingests only sets that have a pull-rate file (a set without
 * one can't rank, and pokemontcg.io has 173 sets we'd burn quota on); One
 * Piece ingests everything its adapter enumerates, because the set list is
 * short and OP sets cross-reference cards from earlier sets.
 */
export async function refreshCatalog() {
  return runJob("refresh-catalog", async () => {
    const db = getDb();
    const loaded = await loadAllPullRates();

    const gameRows = await db.select().from(games);
    const gameIdBySlug = new Map(gameRows.map((g) => [g.slug, g.id]));

    // One Piece catalog comes from Scrydex (licensed, per-printing variants)
    // when its credentials exist, falling back to optcgapi otherwise — so the
    // app still ingests OP with no Scrydex key, just with optcgapi's coarser,
    // sometimes-mislabelled printings.
    const scrydexCatalog = new ScrydexCatalogAdapter();
    const oneP: CatalogAdapter = scrydexCatalog.enabled()
      ? scrydexCatalog
      : new OptcgApiAdapter();
    const adapters: CatalogAdapter[] = [new PokemonTcgIoAdapter(), oneP];

    // Optional ops scoping (env). Neither is set by the cron — a full run
    // ingests everything — but a manual run can narrow the work:
    //   CATALOG_GAMES=pokemon        skip whole adapters (e.g. the flaky One
    //                                Piece API) before any of their calls.
    //   CATALOG_SETS=sv2,sv3         ingest only these set codes; pull-rate
    //                                tables + products still load for all sets.
    const onlyGames = envSet("CATALOG_GAMES");
    const onlySets = envSet("CATALOG_SETS");

    let setsUpserted = 0;
    let cardsUpserted = 0;

    for (const adapter of adapters) {
      if (onlyGames && !onlyGames.has(adapter.gameSlug)) continue;

      const gameId = gameIdBySlug.get(adapter.gameSlug);
      if (!gameId) throw new Error(`game ${adapter.gameSlug} not seeded`);

      const wantedCodes =
        adapter.gameSlug === "pokemon"
          ? new Set([
              ...loaded.filter((l) => l.file.game === "pokemon").map((l) => l.file.setCode),
              // Black Star Promos: never has a pull-rate table, but products'
              // guaranteed promo cards live here and need catalog + prices.
              "svp",
            ])
          : null; // null = all

      const allSets = await adapter.fetchSets();
      const targetSets = allSets.filter(
        (s) => (!wantedCodes || wantedCodes.has(s.code)) && (!onlySets || onlySets.has(s.code)),
      );

      for (const cs of targetSets) {
        const setId = await upsertSet(gameId, cs);
        setsUpserted++;

        const fetched = await adapter.fetchCards(cs);
        for (const c of fetched) {
          await db
            .insert(cards)
            .values({
              setId,
              name: c.name,
              number: c.number,
              rarity: c.rarity,
              treatment: c.treatment,
              imageUrl: c.imageUrl,
              externalIds: c.externalIds,
            })
            .onConflictDoUpdate({
              target: [cards.setId, cards.number, cards.treatment],
              set: {
                name: c.name,
                rarity: c.rarity,
                imageUrl: c.imageUrl,
                // merge, not replace: another provider's ids must survive
                externalIds: sql`${cards.externalIds} || ${JSON.stringify(c.externalIds)}::jsonb`,
                updatedAt: new Date(),
              },
            });
          cardsUpserted++;
        }

        // When Scrydex is the source of truth for a One Piece set, drop rows a
        // prior source (optcgapi) left that Scrydex does not produce — the
        // mislabelled/duplicate printings the migration exists to fix. Gated on
        // a non-empty fetch so a failed page can never wipe a set's cards; the
        // upsert above merged 'scrydex' into every row Scrydex still produces,
        // so anything without that key is stale. Cascades to its prices.
        if (adapter.providerId === "scrydex" && fetched.length > 0) {
          await db
            .delete(cards)
            .where(
              and(eq(cards.setId, setId), sql`NOT jsonb_exists(${cards.externalIds}, 'scrydex')`),
            );
        }
      }
    }

    const tablesLoaded = await loadPullRateTables(gameIdBySlug, loaded);
    const productsLoaded = await loadSealedProducts(gameIdBySlug);
    const sealedImages = await refreshSealedImages(gameIdBySlug);

    return { setsUpserted, cardsUpserted, tablesLoaded, productsLoaded, sealedImages };
  });
}

/**
 * Fill sealed_products.image_url with Scrydex product photos, both games. The
 * price provider already matches Scrydex sealed SKUs to our product types;
 * this reuses that to store the box/pack/ETB/UPC image, falling back to the
 * set logo in the UI where absent. Only sets that actually have sealed
 * products are queried; a per-set failure (e.g. an expansion Scrydex doesn't
 * carry) skips that set rather than aborting the job. No-op without creds.
 */
export async function refreshSealedImages(gameIdBySlug: Map<string, string>): Promise<number> {
  const db = getDb();
  if (!new ScrydexCatalogAdapter().enabled()) return 0;

  // Only sets with sealed products — svp and other promo sets have none.
  const setRows = await db
    .selectDistinct({ id: sets.id, code: sets.code, externalIds: sets.externalIds })
    .from(sets)
    .innerJoin(sealedProducts, eq(sealedProducts.setId, sets.id));

  let updated = 0;
  for (const s of setRows) {
    const catalogSet: CatalogSet = {
      code: s.code,
      name: s.code,
      releaseDate: null,
      language: "EN",
      expectedCardCount: null,
      externalIds: s.externalIds,
    };
    try {
      const images = await fetchScrydexSealedImages(catalogSet);
      for (const [type, url] of images) {
        const rows = await db
          .update(sealedProducts)
          .set({ imageUrl: url, updatedAt: new Date() })
          .where(and(eq(sealedProducts.setId, s.id), eq(sealedProducts.type, type as never)))
          .returning({ id: sealedProducts.id });
        updated += rows.length;
      }
    } catch (err) {
      console.warn(
        `[sealed-images] ${s.code}: ${err instanceof Error ? err.message : String(err)} — skipped`,
      );
    }
  }
  return updated;
}

/**
 * Load pull-rate files into pull_rate_tables for sets already present in the
 * DB. Extracted from refreshCatalog so a data-file change can be applied
 * without re-hitting the catalog APIs — see scripts/load-data.ts. A set with no
 * ingested row is skipped (e.g. a placeholder for a not-yet-released set).
 */
export async function loadPullRateTables(
  gameIdBySlug: Map<string, string>,
  preloaded?: Awaited<ReturnType<typeof loadAllPullRates>>,
): Promise<number> {
  const db = getDb();
  const loaded = preloaded ?? (await loadAllPullRates());
  let tablesLoaded = 0;
  for (const { file } of loaded) {
    const gameId = gameIdBySlug.get(file.game);
    if (!gameId) continue;

    const [setRow] = await db
      .select({ id: sets.id })
      .from(sets)
      .where(and(eq(sets.gameId, gameId), eq(sets.code, file.setCode)));
    if (!setRow) continue; // set not ingested (e.g. placeholder for a future set)

    await db
      .insert(pullRateTables)
      .values({
        setId: setRow.id,
        version: file.version,
        // DB column is NOT NULL; 0 encodes "undisclosed or placeholder" and
        // the file's null/0 distinction is preserved in confidence + note.
        sampleSizePacks: file.sampleSizePacks ?? 0,
        sourceUrl: file.sourceUrl,
        sourceNote: file.sourceNote,
        confidence: file.confidence,
        slots: file.slots,
        guaranteedSlots: file.guaranteedSlots,
        boxGuarantees: file.boxGuarantees,
        alternateEstimates: file.alternateEstimates,
        showWhenPlaceholder: file.showWhenPlaceholder,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [pullRateTables.setId, pullRateTables.version],
        set: {
          sampleSizePacks: file.sampleSizePacks ?? 0,
          sourceUrl: file.sourceUrl,
          sourceNote: file.sourceNote,
          confidence: file.confidence,
          slots: file.slots,
          guaranteedSlots: file.guaranteedSlots,
          boxGuarantees: file.boxGuarantees,
          alternateEstimates: file.alternateEstimates,
          showWhenPlaceholder: file.showWhenPlaceholder,
          isActive: true,
        },
      });

    // Exactly one active version per set.
    await db
      .update(pullRateTables)
      .set({ isActive: false })
      .where(
        and(eq(pullRateTables.setId, setRow.id), ne(pullRateTables.version, file.version)),
      );
    tablesLoaded++;
  }
  return tablesLoaded;
}

/** Parse a comma-separated env var into a Set, or null when unset/empty. */
function envSet(name: string): Set<string> | null {
  const raw = process.env[name];
  if (!raw) return null;
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? new Set(items) : null;
}

const productFileSchema = z.object({
  products: z.array(
    z.object({
      setCode: z.string().min(1),
      name: z.string().min(1),
      slug: z.string().min(1),
      type: z.enum(["booster_pack", "booster_box", "etb", "bundle", "display", "case"]),
      packsContained: z.number().int().positive(),
      msrpCents: z.number().int().positive().nullable(),
      // Hand-tracked market price: all three fields travel together.
      marketCents: z.number().int().positive().optional(),
      marketAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      marketSource: z.string().min(1).optional(),
      /** Guaranteed non-pack cards, by catalog-provider external id. */
      promos: z
        .array(z.object({ externalId: z.string().min(1), note: z.string().optional() }))
        .default([]),
      contentsNote: z.string().optional(),
    }),
  ),
});

/**
 * Sealed products from data/products/{game}.json. Hand-maintained: catalog
 * APIs index singles only, so products are our data, like pull rates.
 */
export async function loadSealedProducts(gameIdBySlug: Map<string, string>): Promise<number> {
  const db = getDb();
  let loaded = 0;

  for (const [slug, gameId] of gameIdBySlug) {
    let raw: string;
    try {
      raw = await readFile(join(process.cwd(), "data", "products", `${slug}.json`), "utf8");
    } catch {
      continue; // No product file for this game yet — fine.
    }

    const file = productFileSchema.parse(JSON.parse(raw));
    for (const p of file.products) {
      const [setRow] = await db
        .select({ id: sets.id })
        .from(sets)
        .where(and(eq(sets.gameId, gameId), eq(sets.code, p.setCode)));
      if (!setRow) {
        throw new Error(
          `data/products/${slug}.json: set ${p.setCode} is not ingested — run catalog ingest first or fix the code.`,
        );
      }

      // A market price without provenance is just a rumour — refuse it.
      if (p.marketCents !== undefined && (!p.marketAsOf || !p.marketSource)) {
        throw new Error(
          `data/products/${slug}.json: ${p.setCode}/${p.slug} has marketCents without marketAsOf + marketSource.`,
        );
      }

      // Resolve promo external ids -> our card UUIDs. Loud on a miss: a
      // guaranteed card silently absent understates the product's EV.
      const guaranteedCardIds: string[] = [];
      for (const promo of p.promos) {
        const [cardRow] = await db
          .select({ id: cards.id })
          .from(cards)
          .where(
            sql`${cards.externalIds} @> ${JSON.stringify({ pokemontcg_io: promo.externalId })}::jsonb`,
          );
        if (!cardRow) {
          throw new Error(
            `data/products/${slug}.json: promo ${promo.externalId} (${promo.note ?? "?"}) not found in the catalog — is its set ingested?`,
          );
        }
        guaranteedCardIds.push(cardRow.id);
      }

      await db
        .insert(sealedProducts)
        .values({
          setId: setRow.id,
          type: p.type,
          name: p.name,
          slug: p.slug,
          packsContained: p.packsContained,
          msrpCents: p.msrpCents,
          manualMarketCents: p.marketCents ?? null,
          manualMarketAsOf: p.marketAsOf ?? null,
          manualMarketSource: p.marketSource ?? null,
          contentsNote: p.contentsNote ?? null,
          guaranteedCardIds,
        })
        .onConflictDoUpdate({
          target: [sealedProducts.setId, sealedProducts.slug],
          set: {
            type: p.type,
            name: p.name,
            packsContained: p.packsContained,
            msrpCents: p.msrpCents,
            manualMarketCents: p.marketCents ?? null,
            manualMarketAsOf: p.marketAsOf ?? null,
            manualMarketSource: p.marketSource ?? null,
            contentsNote: p.contentsNote ?? null,
            guaranteedCardIds,
            updatedAt: new Date(),
          },
        });
      loaded++;
    }
  }

  return loaded;
}

async function upsertSet(gameId: string, cs: CatalogSet): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(sets)
    .values({
      gameId,
      code: cs.code,
      name: cs.name,
      releaseDate: cs.releaseDate,
      language: cs.language,
      logoUrl: cs.logoUrl ?? null,
      externalIds: cs.externalIds,
    })
    .onConflictDoUpdate({
      target: [sets.gameId, sets.code, sets.language],
      set: {
        name: cs.name,
        releaseDate: cs.releaseDate,
        logoUrl: cs.logoUrl ?? null,
        externalIds: sql`${sets.externalIds} || ${JSON.stringify(cs.externalIds)}::jsonb`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: sets.id });

  if (!row) throw new Error(`upsert returned no row for set ${cs.code}`);
  return row.id;
}
