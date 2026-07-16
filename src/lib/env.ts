import { z } from "zod";

/**
 * Server-side environment. The app MUST boot and render with only
 * DATABASE_URL + ADMIN_SECRET set. Every price source is optional; when its
 * config is absent the corresponding adapter reports enabled() === false and
 * the UI hides that source entirely.
 */
const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  ADMIN_SECRET: z.string().min(8, "ADMIN_SECRET must be at least 8 characters"),

  // --- Optional: tcgplayer_market mirror -----------------------------------
  // TCGplayer's own API is closed to new developers and their ToS forbids
  // scraping, so market prices are sourced via a third-party mirror. The
  // concrete provider is swappable behind the single tcgplayer_market adapter.
  //
  // Defaults to pokemontcg_io: it serves TCGplayer market prices free, with no
  // key, and its data was observed fresh (same-day). Its limitation is real
  // though — Pokémon only. justtcg/tcgapi/scrydex remain available for wider
  // coverage and are wired to the same adapter interface.
  TCGPLAYER_MIRROR_PROVIDER: z
    .enum(["pokemontcg_io", "justtcg", "tcgapi", "scrydex"])
    .default("pokemontcg_io"),
  TCGPLAYER_MIRROR_API_KEY: z.string().min(1).optional(),
  /** Optional. Raises pokemontcg.io's rate limit; never required. */
  POKEMONTCG_IO_KEY: z.string().min(1).optional(),

  // --- Optional: pricecharting_ebay ----------------------------------------
  // Paid subscription token. Absent => adapter disabled, graded mode hidden.
  PRICECHARTING_TOKEN: z.string().min(1).optional(),

  // --- Tunables -------------------------------------------------------------
  BULK_THRESHOLD_CENTS: z.coerce.number().int().nonnegative().default(50),

  // --- Optional: affiliate --------------------------------------------------
  // Link structure supports these but never requires them.
  AFFILIATE_TCGPLAYER_ID: z.string().min(1).optional(),
  AFFILIATE_EBAY_CAMPAIGN: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/**
 * Parses and caches process.env. Throws a readable aggregate error listing
 * every invalid key rather than failing on the first one.
 */
export function getEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** Test-only: drop the memoised env so a mutated process.env is re-read. */
export function resetEnvCache(): void {
  cached = null;
}
