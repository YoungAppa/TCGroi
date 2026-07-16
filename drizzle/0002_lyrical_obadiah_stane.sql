ALTER TABLE "sealed_products" ADD COLUMN "manual_market_cents" integer;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "manual_market_as_of" date;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "manual_market_source" text;--> statement-breakpoint
ALTER TABLE "sealed_products" ADD COLUMN "contents_note" text;--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "logo_url" text;