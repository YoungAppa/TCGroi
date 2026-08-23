CREATE TABLE "card_populations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"company" text NOT NULL,
	"total" integer NOT NULL,
	"gem_count" integer NOT NULL,
	"grade9_count" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_populations" ADD CONSTRAINT "card_populations_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_populations_card_company_uq" ON "card_populations" USING btree ("card_id","company");