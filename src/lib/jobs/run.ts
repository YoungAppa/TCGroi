import { eq } from "drizzle-orm";

import { getDb, jobRuns } from "@/lib/db";

/**
 * Wraps a job with job_runs bookkeeping: a `running` row on entry, updated to
 * success/failure with stats on exit. Failures are recorded AND rethrown —
 * the cron caller decides retry policy; the admin page reads this table.
 */
export async function runJob<T extends Record<string, unknown>>(
  jobName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const db = getDb();

  const [row] = await db
    .insert(jobRuns)
    .values({ job: jobName, status: "running" })
    .returning({ id: jobRuns.id });
  if (!row) throw new Error("failed to create job_runs row");

  try {
    const stats = await fn();
    await db
      .update(jobRuns)
      .set({ status: "success", finishedAt: new Date(), stats })
      .where(eq(jobRuns.id, row.id));
    return stats;
  } catch (err) {
    await db
      .update(jobRuns)
      .set({
        status: "failure",
        finishedAt: new Date(),
        error: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
      })
      .where(eq(jobRuns.id, row.id));
    throw err;
  }
}
