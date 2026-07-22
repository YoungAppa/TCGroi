import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Game-agnostic by construction: adding MTG later is a data change, not code. */
export const gameSlug = pgEnum("game_slug", ["pokemon", "one-piece", "mtg"]);

export const setLanguage = pgEnum("set_language", ["EN", "JP", "ZH"]);

export const sealedProductType = pgEnum("sealed_product_type", [
  "booster_pack",
  "booster_box",
  "etb",
  "bundle",
  "display",
  "case",
]);

/** Publishers do not publish official odds; every table is an estimate. */
export const pullRateConfidence = pgEnum("pull_rate_confidence", [
  "high",
  "medium",
  "low",
  "placeholder",
]);

export const priceKind = pgEnum("price_kind", ["raw", "psa9", "psa10", "sealed"]);

export const jobStatus = pgEnum("job_status", ["running", "success", "failure"]);

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const games = pgTable("games", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: gameSlug("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  /**
   * Rarity vocabulary is per game (Pokemon: illustration_rare/ultra_rare/...;
   * One Piece: sr/sec/alt_art/manga_rare/sp). Stored as data so a new game
   * needs no code change. Ordered least -> most rare for display.
   */
  rarityVocab: jsonb("rarity_vocab").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sets = pgTable(
  "sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    /** Publisher set code, e.g. "SV08" (Surging Sparks) or "OP-09". */
    code: text("code").notNull(),
    name: text("name").notNull(),
    releaseDate: date("release_date"),
    language: setLanguage("language").notNull().default("EN"),
    /** Set logo from the catalog provider — used as product imagery. */
    logoUrl: text("logo_url"),
    /** Per-catalog-source IDs, e.g. { tcgdex: "sv08", pokemontcg_io: "sv8" }. */
    externalIds: jsonb("external_ids")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A set code is only unique within a game+language: OP-01 EN and OP-01 JP
    // are genuinely different products with different pull rates.
    uniqueIndex("sets_game_code_lang_uq").on(t.gameId, t.code, t.language),
    index("sets_game_idx").on(t.gameId),
  ],
);

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id")
      .notNull()
      .references(() => sets.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Collector number as printed, e.g. "191/191". Text: not always numeric. */
    number: text("number").notNull(),
    /** Must be a member of the parent game's rarityVocab. */
    rarity: text("rarity").notNull(),
    /**
     * Printing treatment. Part of a card's identity, NOT decoration.
     *
     * A collector number does not identify a card on its own. One Piece OP-09
     * prints OP09-118 three times — base Secret Rare ($36), Alternate Art
     * ($100), and Manga ($5,500) — and those are different cards with
     * different odds and a 150x price spread. Keying on number alone would
     * reject two of the three and delete the chase cards from EV.
     *
     * "base" for an ordinary printing.
     */
    treatment: text("treatment").notNull().default("base"),
    /** Variant flags, e.g. { firstEdition: false }. */
    variants: jsonb("variants")
      .$type<Record<string, boolean>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    imageUrl: text("image_url"),
    externalIds: jsonb("external_ids")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Identity is (set, number, treatment) — see the treatment column.
    uniqueIndex("cards_set_number_treatment_uq").on(t.setId, t.number, t.treatment),
    index("cards_set_rarity_idx").on(t.setId, t.rarity),
  ],
);

export const sealedProducts = pgTable(
  "sealed_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id")
      .notNull()
      .references(() => sets.id, { onDelete: "cascade" }),
    type: sealedProductType("type").notNull(),
    name: text("name").notNull(),
    /** URL segment: /{game}/{setCode}/{slug}. Unique within a set. */
    slug: text("slug").notNull(),
    /** Product (box/pack) photo from the catalog source; falls back to the set
     *  logo where absent. */
    imageUrl: text("image_url"),
    /** Packs inside. EV(product) = EV(pack) * packsContained + extras. */
    packsContained: integer("packs_contained").notNull(),
    msrpCents: integer("msrp_cents"),
    /**
     * Hand-tracked current market (street/scalper) price, with provenance.
     * A stopgap until a sealed-capable price source (PriceCharting) supplies
     * live data — the payload prefers source prices over this whenever they
     * exist. Kept out of latest_prices deliberately: manual entries are not
     * snapshots from a source and must never masquerade as one.
     */
    manualMarketCents: integer("manual_market_cents"),
    manualMarketAsOf: date("manual_market_as_of"),
    manualMarketSource: text("manual_market_source"),
    /** Unmodelled contents (metal cards, accessories) disclosed to the user. */
    contentsNote: text("contents_note"),
    /**
     * Guaranteed non-pack contents, e.g. an ETB promo card. Referenced by the
     * EV engine as fixed add-on value.
     */
    guaranteedCardIds: jsonb("guaranteed_card_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    externalIds: jsonb("external_ids")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sealed_products_set_slug_uq").on(t.setId, t.slug),
    index("sealed_products_set_idx").on(t.setId),
  ],
);

// ---------------------------------------------------------------------------
// Pull rates
// ---------------------------------------------------------------------------

/**
 * Versioned, community-sourced odds. Never official. The UI is required to
 * render `confidence` and `sourceUrl` anywhere these numbers surface.
 */
export const pullRateTables = pgTable(
  "pull_rate_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id")
      .notNull()
      .references(() => sets.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    sampleSizePacks: integer("sample_size_packs").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceNote: text("source_note").notNull(),
    confidence: pullRateConfidence("confidence").notNull(),
    /** [{ rarity, perPackProbability }] — probability per pack, per tier. */
    slots: jsonb("slots")
      .$type<{ rarity: string; perPackProbability: number }[]>()
      .notNull(),
    /** Reverse-holo slots, god-pack rules — deterministic per-pack extras. */
    guaranteedSlots: jsonb("guaranteed_slots")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** One Piece "SR or better per box" etc. — see BoxGuarantee in lib/ev. */
    boxGuarantees: jsonb("box_guarantees")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /**
     * Rival published estimates, for the sources-disagree panel. Display
     * data only — never enters the EV math.
     */
    alternateEstimates: jsonb("alternate_estimates")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Placeholder tables are hidden from public rankings by default. */
    showWhenPlaceholder: boolean("show_when_placeholder").notNull().default(false),
    /** Exactly one version per set is live at a time. */
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pull_rate_set_version_uq").on(t.setId, t.version),
    index("pull_rate_set_active_idx").on(t.setId, t.isActive),
  ],
);

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export const priceSources = pgTable("price_sources", {
  /** Stable adapter id, e.g. "tcgplayer_market". Not a uuid: referenced by code. */
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  /** Attribution string each provider's terms require us to display. */
  attribution: text("attribution"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Append-only price history. Never updated or deleted; LatestPrice is the
 * fast-read projection over this.
 */
export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id").references(() => cards.id, { onDelete: "cascade" }),
    sealedProductId: uuid("sealed_product_id").references(() => sealedProducts.id, {
      onDelete: "cascade",
    }),
    sourceId: text("source_id")
      .notNull()
      .references(() => priceSources.id, { onDelete: "cascade" }),
    /** Integer pennies throughout. No floats anywhere in the money path. */
    priceCents: integer("price_cents").notNull(),
    kind: priceKind("kind").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("price_snapshots_card_idx").on(t.cardId, t.sourceId, t.kind, t.capturedAt),
    index("price_snapshots_sealed_idx").on(
      t.sealedProductId,
      t.sourceId,
      t.kind,
      t.capturedAt,
    ),
    // A snapshot prices exactly one entity — never both, never neither.
    check(
      "price_snapshots_entity_ck",
      sql`(${t.cardId} IS NULL) <> (${t.sealedProductId} IS NULL)`,
    ),
    // Sealed products cannot be graded; only cards can.
    check(
      "price_snapshots_kind_ck",
      sql`(${t.kind} = 'sealed') = (${t.sealedProductId} IS NOT NULL)`,
    ),
  ],
);

/**
 * Materialised current price per entity per source per kind. Page reads hit
 * this table only — no external API call ever happens in a request path.
 */
export const latestPrices = pgTable(
  "latest_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id").references(() => cards.id, { onDelete: "cascade" }),
    sealedProductId: uuid("sealed_product_id").references(() => sealedProducts.id, {
      onDelete: "cascade",
    }),
    sourceId: text("source_id")
      .notNull()
      .references(() => priceSources.id, { onDelete: "cascade" }),
    priceCents: integer("price_cents").notNull(),
    kind: priceKind("kind").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Partial unique indexes: one row per (entity, source, kind). Two indexes
    // rather than one because a NULL entity column never collides in Postgres.
    uniqueIndex("latest_prices_card_uq")
      .on(t.cardId, t.sourceId, t.kind)
      .where(sql`${t.cardId} IS NOT NULL`),
    uniqueIndex("latest_prices_sealed_uq")
      .on(t.sealedProductId, t.sourceId, t.kind)
      .where(sql`${t.sealedProductId} IS NOT NULL`),
    check(
      "latest_prices_entity_ck",
      sql`(${t.cardId} IS NULL) <> (${t.sealedProductId} IS NULL)`,
    ),
    check(
      "latest_prices_kind_ck",
      sql`(${t.kind} = 'sealed') = (${t.sealedProductId} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

/** Every cron run lands here; failures surface in /admin. */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    status: jobStatus("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    /** Free-form counters, e.g. { sourcesRun: 2, snapshotsWritten: 1423 }. */
    stats: jsonb("stats")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [index("job_runs_job_started_idx").on(t.job, t.startedAt)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const gamesRelations = relations(games, ({ many }) => ({
  sets: many(sets),
}));

export const setsRelations = relations(sets, ({ one, many }) => ({
  game: one(games, { fields: [sets.gameId], references: [games.id] }),
  cards: many(cards),
  sealedProducts: many(sealedProducts),
  pullRateTables: many(pullRateTables),
}));

export const cardsRelations = relations(cards, ({ one, many }) => ({
  set: one(sets, { fields: [cards.setId], references: [sets.id] }),
  priceSnapshots: many(priceSnapshots),
  latestPrices: many(latestPrices),
}));

export const sealedProductsRelations = relations(sealedProducts, ({ one, many }) => ({
  set: one(sets, { fields: [sealedProducts.setId], references: [sets.id] }),
  priceSnapshots: many(priceSnapshots),
  latestPrices: many(latestPrices),
}));

export const pullRateTablesRelations = relations(pullRateTables, ({ one }) => ({
  set: one(sets, { fields: [pullRateTables.setId], references: [sets.id] }),
}));

export const priceSourcesRelations = relations(priceSources, ({ many }) => ({
  priceSnapshots: many(priceSnapshots),
  latestPrices: many(latestPrices),
}));

export const priceSnapshotsRelations = relations(priceSnapshots, ({ one }) => ({
  card: one(cards, { fields: [priceSnapshots.cardId], references: [cards.id] }),
  sealedProduct: one(sealedProducts, {
    fields: [priceSnapshots.sealedProductId],
    references: [sealedProducts.id],
  }),
  source: one(priceSources, {
    fields: [priceSnapshots.sourceId],
    references: [priceSources.id],
  }),
}));

export const latestPricesRelations = relations(latestPrices, ({ one }) => ({
  card: one(cards, { fields: [latestPrices.cardId], references: [cards.id] }),
  sealedProduct: one(sealedProducts, {
    fields: [latestPrices.sealedProductId],
    references: [sealedProducts.id],
  }),
  source: one(priceSources, {
    fields: [latestPrices.sourceId],
    references: [priceSources.id],
  }),
}));
