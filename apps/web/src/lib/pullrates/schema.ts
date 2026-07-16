import { z } from "zod";

import { isKnownRarity, RARITY_VOCAB, type KnownGameSlug } from "@/lib/catalog/rarities";

/**
 * Schema for /data/pullrates/{game}/{setCode}.json.
 *
 * Pokémon and One Piece publishers do not publish official odds. Everything in
 * these files is community-aggregated estimate, and the schema is built to
 * make that impossible to forget: `sourceUrl`, `sourceNote`, `sampleSizePacks`
 * and `confidence` are all required, and `confidence: "placeholder"` forces
 * the numbers out of public rankings.
 */

export const confidenceSchema = z.enum(["high", "medium", "low", "placeholder"]);
export type Confidence = z.infer<typeof confidenceSchema>;

const slotSchema = z.object({
  rarity: z.string().min(1),
  /**
   * Expected count of this rarity per pack, as a probability. Values > 1 are
   * legal in principle (two per pack) but are far more often a data-entry
   * error, so they're rejected — a guaranteedSlot is the right way to say
   * "every pack has one".
   */
  perPackProbability: z.number().min(0).max(1),
});

const guaranteedSlotSchema = z.object({
  label: z.string().min(1),
  rarity: z.string().min(1),
  countPerPack: z.number().int().positive(),
});

const boxGuaranteeSchema = z.object({
  label: z.string().min(1),
  rarity: z.string().min(1),
  count: z.number().int().positive(),
  /**
   * See BoxGuarantee in lib/ev/types. "floor" is almost always right for
   * community-observed rates, which already include the guaranteed card;
   * "additive" double-counts it. No default — the data must decide, because
   * guessing wrong inflates EV on exactly the products that have guarantees.
   */
  mode: z.enum(["additive", "floor"]),
});

/**
 * A second source's numbers for the same set.
 *
 * Community pull-rate sources routinely disagree — Surging Sparks SIR is
 * reported as 1-in-71 by a documented 500-pack opening and 1-in-87 by
 * ThePriceDex, a ~20% spread. Silently picking a winner would fake a precision
 * nobody has. Recording the rival estimate lets the product page show the
 * spread, which is a more honest answer than any single number.
 *
 * These never enter the EV math — `slots` above is the number used. This is
 * disclosure, not a second opinion the engine averages in.
 */
const alternateEstimateSchema = z.object({
  sourceUrl: z.string().url(),
  note: z.string().min(1),
  sampleSizePacks: z.number().int().nonnegative().nullable(),
  /** Only the tiers this source disagrees on need listing. */
  slots: z.array(slotSchema).min(1),
});

export type AlternateEstimate = z.infer<typeof alternateEstimateSchema>;

export const pullRateFileSchema = z
  .object({
    $schema: z.string().optional(),
    game: z.enum(["pokemon", "one-piece", "mtg"]),
    setCode: z.string().min(1),
    version: z.number().int().positive(),
    /**
     * Packs the community actually opened to produce these numbers.
     *
     * Three distinct states, and conflating them would be a lie:
     *   number > 0  the source published its sample size
     *   null        a real community estimate whose sample size was NOT
     *               disclosed (common — most sites publish rates, not N)
     *   0           placeholder; no packs were opened because nobody measured
     *
     * null is deliberately not coerced to 0: "we don't know how solid this is"
     * is different information from "this is invented", and the UI shows them
     * differently.
     */
    sampleSizePacks: z.number().int().nonnegative().nullable(),
    sourceUrl: z.string().url(),
    sourceNote: z.string().min(1),
    confidence: confidenceSchema,
    /** The rates the EV engine actually uses. */
    slots: z.array(slotSchema),
    /** Rival published estimates, shown to the user. Never used in the math. */
    alternateEstimates: z.array(alternateEstimateSchema).default([]),
    guaranteedSlots: z.array(guaranteedSlotSchema).default([]),
    boxGuarantees: z.array(boxGuaranteeSchema).default([]),
    /** Placeholder tables stay out of public rankings unless forced on. */
    showWhenPlaceholder: z.boolean().default(false),
  })
  .superRefine((file, ctx) => {
    // --- rarity slugs must exist in the game's vocabulary --------------------
    // A typo here is silent: the EV engine finds no cards for the tier and
    // contributes 0, which looks like a cheap set rather than a broken file.
    const checkRarity = (rarity: string, path: (string | number)[]) => {
      if (!isKnownRarity(file.game, rarity)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `Unknown rarity "${rarity}" for ${file.game}. Known: ${RARITY_VOCAB[file.game as KnownGameSlug].join(", ")}`,
        });
      }
    };

    file.slots.forEach((s, i) => checkRarity(s.rarity, ["slots", i, "rarity"]));
    file.guaranteedSlots.forEach((s, i) =>
      checkRarity(s.rarity, ["guaranteedSlots", i, "rarity"]),
    );
    file.boxGuarantees.forEach((g, i) =>
      checkRarity(g.rarity, ["boxGuarantees", i, "rarity"]),
    );
    file.alternateEstimates.forEach((a, ai) =>
      a.slots.forEach((s, si) =>
        checkRarity(s.rarity, ["alternateEstimates", ai, "slots", si, "rarity"]),
      ),
    );

    // An alternate estimate must contest a tier the primary actually claims,
    // otherwise there is nothing to compare it against and it renders as a
    // dangling number.
    const primaryTiers = new Set(file.slots.map((s) => s.rarity));
    file.alternateEstimates.forEach((a, ai) =>
      a.slots.forEach((s, si) => {
        if (!primaryTiers.has(s.rarity)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["alternateEstimates", ai, "slots", si, "rarity"],
            message: `Alternate estimate covers "${s.rarity}", which the primary slots do not list — there is nothing to compare it to.`,
          });
        }
      }),
    );

    // --- no duplicate tiers -------------------------------------------------
    // Two slots for one rarity would double-count that tier in EV.
    const seen = new Set<string>();
    file.slots.forEach((s, i) => {
      if (seen.has(s.rarity)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slots", i, "rarity"],
          message: `Duplicate slot for rarity "${s.rarity}" — its EV would be counted twice.`,
        });
      }
      seen.add(s.rarity);
    });

    // --- honesty guards -----------------------------------------------------
    const n = file.sampleSizePacks;

    // A placeholder must not masquerade as sourced data.
    if (file.confidence === "placeholder") {
      if (n !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sampleSizePacks"],
          message:
            "A placeholder table must report sampleSizePacks: 0 — no packs were opened for it.",
        });
      }
    } else if (n === 0) {
      // 0 means "nobody opened anything", which is a placeholder by definition.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sampleSizePacks"],
        message:
          'sampleSizePacks: 0 means no packs were opened — set confidence to "placeholder", or use null if the source simply did not disclose its sample size.',
      });
    }

    // high/medium are claims about precision, so they require a KNOWN sample.
    // An undisclosed sample size caps a table at "low" however plausible its
    // numbers look — we cannot verify what we were not told.
    if (file.confidence === "high" || file.confidence === "medium") {
      if (n === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["confidence"],
          message: `confidence "${file.confidence}" requires a disclosed sampleSizePacks. The source did not publish one, so this table is "low" at best.`,
        });
      } else {
        const min = file.confidence === "high" ? 500 : 100;
        if (n < min) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["confidence"],
            message: `confidence "${file.confidence}" requires sampleSizePacks >= ${min} (got ${n}).`,
          });
        }
      }
    }

    // --- plausibility -------------------------------------------------------
    // Not a hard truth, but a table whose hit tiers sum above 1 per pack is
    // describing a pack that is entirely hits. Almost always a units error
    // (percentages entered as probabilities).
    const total = file.slots.reduce((sum, s) => sum + s.perPackProbability, 0);
    if (total > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slots"],
        message: `Slot probabilities sum to ${total.toFixed(3)} per pack. Values are probabilities (0-1), not percentages — 20% is 0.2, not 20.`,
      });
    }
  });

export type PullRateFile = z.infer<typeof pullRateFileSchema>;

/** Parses a file's contents, throwing a readable aggregate error. */
export function parsePullRateFile(raw: unknown, filename: string): PullRateFile {
  const parsed = pullRateFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid pull-rate file ${filename}:\n${issues}`);
  }
  return parsed.data;
}
