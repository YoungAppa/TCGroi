/**
 * CLI wrapper for the refresh-graded job (same code the daily cron calls).
 *
 *   npx tsx --env-file=.env.local scripts/refresh-graded.ts
 *   GRADED_CARDS=30 GRADED_CREDIT_CAP=60 GRADED_MIN_RAW=2500 npx tsx ... refresh-graded.ts
 *
 * Fetches PSA 10 / PSA 9 prices for the highest-value Pokémon chase cards not
 * already graded within GRADED_REFRESH_DAYS, stopping at a card or credit cap.
 * Credit-metered (free tier 100/day, ~2 per card), so keep the caps modest.
 */
import { refreshGraded } from "@/lib/jobs/refresh-graded";

const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

refreshGraded({
  minRawCents: num(process.env.GRADED_MIN_RAW),
  maxCards: num(process.env.GRADED_CARDS),
  creditCap: num(process.env.GRADED_CREDIT_CAP),
  refreshDays: num(process.env.GRADED_REFRESH_DAYS),
})
  .then((stats) => {
    console.log("refresh-graded complete:", stats);
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("refresh-graded FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
