-- Pokédex layer: one row per species, plus a card<->species junction so a
-- species page can list every card of that Pokémon across sets and languages.
CREATE TABLE IF NOT EXISTS "pokemon_species" (
  "id" integer PRIMARY KEY,
  "slug" text NOT NULL UNIQUE,
  "name_en" text NOT NULL,
  "name_ja" text,
  "name_zh" text,
  "generation" integer,
  "image_url" text
);
CREATE TABLE IF NOT EXISTS "card_species" (
  "card_id" uuid NOT NULL REFERENCES "cards"("id") ON DELETE CASCADE,
  "species_id" integer NOT NULL REFERENCES "pokemon_species"("id") ON DELETE CASCADE,
  PRIMARY KEY ("card_id", "species_id")
);
CREATE INDEX IF NOT EXISTS "card_species_species_idx" ON "card_species" ("species_id");
