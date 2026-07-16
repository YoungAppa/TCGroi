/**
 * CLI wrapper for the refresh-catalog job (same code the weekly cron calls).
 *
 *   npx tsx --env-file=.env.local scripts/refresh-catalog.ts
 */
import { refreshCatalog } from "@/lib/jobs/refresh-catalog";

refreshCatalog()
  .then((stats) => {
    console.log("refresh-catalog complete:", stats);
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("refresh-catalog FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
