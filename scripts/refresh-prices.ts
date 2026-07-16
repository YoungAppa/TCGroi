/**
 * CLI wrapper for the refresh-prices job (same code the daily cron calls).
 *
 *   npx tsx --env-file=.env.local scripts/refresh-prices.ts
 */
import { refreshPrices } from "@/lib/jobs/refresh-prices";

refreshPrices()
  .then((stats) => {
    console.log("refresh-prices complete:", stats);
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("refresh-prices FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
