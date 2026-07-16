CREATE TYPE "public"."game_slug" AS ENUM('pokemon', 'one-piece', 'mtg');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('running', 'success', 'failure');--> statement-breakpoint
CREATE TYPE "public"."price_kind" AS ENUM('raw', 'psa9', 'psa10', 'sealed');--> statement-breakpoint
CREATE TYPE "public"."pull_rate_confidence" AS ENUM('high', 'medium', 'low', 'placeholder');--> statement-breakpoint
CREATE TYPE "public"."sealed_product_type" AS ENUM('booster_pack', 'booster_box', 'etb', 'bundle', 'display', 'case');--> statement-breakpoint
CREATE TYPE "public"."set_language" AS ENUM('EN', 'JP');--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"name" text NOT NULL,
	"number" text NOT NULL,
	"rarity" text NOT NULL,
	"variants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"image_url" text,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" "game_slug" NOT NULL,
	"display_name" text NOT NULL,
	"rarity_vocab" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"status" "job_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "latest_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid,
	"sealed_product_id" uuid,
	"source_id" text NOT NULL,
	"price_cents" integer NOT NULL,
	"kind" "price_kind" NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "latest_prices_entity_ck" CHECK (("latest_prices"."card_id" IS NULL) <> ("latest_prices"."sealed_product_id" IS NULL)),
	CONSTRAINT "latest_prices_kind_ck" CHECK (("latest_prices"."kind" = 'sealed') = ("latest_prices"."sealed_product_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid,
	"sealed_product_id" uuid,
	"source_id" text NOT NULL,
	"price_cents" integer NOT NULL,
	"kind" "price_kind" NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_snapshots_entity_ck" CHECK (("price_snapshots"."card_id" IS NULL) <> ("price_snapshots"."sealed_product_id" IS NULL)),
	CONSTRAINT "price_snapshots_kind_ck" CHECK (("price_snapshots"."kind" = 'sealed') = ("price_snapshots"."sealed_product_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "price_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"attribution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_rate_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"sample_size_packs" integer NOT NULL,
	"source_url" text NOT NULL,
	"source_note" text NOT NULL,
	"confidence" "pull_rate_confidence" NOT NULL,
	"slots" jsonb NOT NULL,
	"guaranteed_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"show_when_placeholder" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sealed_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"type" "sealed_product_type" NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"packs_contained" integer NOT NULL,
	"msrp_cents" integer,
	"guaranteed_card_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"release_date" date,
	"language" "set_language" DEFAULT 'EN' NOT NULL,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_prices" ADD CONSTRAINT "latest_prices_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_prices" ADD CONSTRAINT "latest_prices_sealed_product_id_sealed_products_id_fk" FOREIGN KEY ("sealed_product_id") REFERENCES "public"."sealed_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "latest_prices" ADD CONSTRAINT "latest_prices_source_id_price_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."price_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_sealed_product_id_sealed_products_id_fk" FOREIGN KEY ("sealed_product_id") REFERENCES "public"."sealed_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_source_id_price_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."price_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_rate_tables" ADD CONSTRAINT "pull_rate_tables_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD CONSTRAINT "sealed_products_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cards_set_number_uq" ON "cards" USING btree ("set_id","number");--> statement-breakpoint
CREATE INDEX "cards_set_rarity_idx" ON "cards" USING btree ("set_id","rarity");--> statement-breakpoint
CREATE INDEX "job_runs_job_started_idx" ON "job_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "latest_prices_card_uq" ON "latest_prices" USING btree ("card_id","source_id","kind") WHERE "latest_prices"."card_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "latest_prices_sealed_uq" ON "latest_prices" USING btree ("sealed_product_id","source_id","kind") WHERE "latest_prices"."sealed_product_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "price_snapshots_card_idx" ON "price_snapshots" USING btree ("card_id","source_id","kind","captured_at");--> statement-breakpoint
CREATE INDEX "price_snapshots_sealed_idx" ON "price_snapshots" USING btree ("sealed_product_id","source_id","kind","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_rate_set_version_uq" ON "pull_rate_tables" USING btree ("set_id","version");--> statement-breakpoint
CREATE INDEX "pull_rate_set_active_idx" ON "pull_rate_tables" USING btree ("set_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "sealed_products_set_slug_uq" ON "sealed_products" USING btree ("set_id","slug");--> statement-breakpoint
CREATE INDEX "sealed_products_set_idx" ON "sealed_products" USING btree ("set_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sets_game_code_lang_uq" ON "sets" USING btree ("game_id","code","language");--> statement-breakpoint
CREATE INDEX "sets_game_idx" ON "sets" USING btree ("game_id");