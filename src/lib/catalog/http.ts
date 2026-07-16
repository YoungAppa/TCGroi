import { z } from "zod";

import { CatalogError } from "./types";

/**
 * Shared fetch for catalog + price providers.
 *
 * Every external response is Zod-parsed before it reaches our code: these are
 * free community APIs that can and do change shape, and a silent undefined
 * propagating into a rarity or a price becomes a wrong number on a public page
 * rather than a crash.
 *
 * Only ever called from cron jobs and scripts — never from a request path.
 */
export async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
  opts: {
    provider: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    retries?: number;
  },
): Promise<T> {
  const { provider, headers = {}, timeoutMs = 30_000, retries = 2 } = opts;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff. These are free tiers doing us a favour; hammering
      // them on failure is how we lose access.
      await sleep(500 * 2 ** (attempt - 1));
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { accept: "application/json", ...headers },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 429) {
        // Respect Retry-After when offered; otherwise fall through to backoff.
        const retryAfter = Number(res.headers.get("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          await sleep(Math.min(retryAfter * 1000, 60_000));
        }
        lastErr = new CatalogError(`rate limited (429) on ${url}`, provider);
        continue;
      }

      if (!res.ok) {
        lastErr = new CatalogError(`HTTP ${res.status} on ${url}`, provider);
        // 4xx other than 429 won't fix themselves — fail fast.
        if (res.status < 500) throw lastErr;
        continue;
      }

      const json: unknown = await res.json();
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        // A shape change is a bug to fix, not a transient fault: don't retry.
        throw new CatalogError(
          `response did not match the expected shape for ${url}: ${parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
          provider,
          { cause: parsed.error },
        );
      }
      return parsed.data;
    } catch (err) {
      if (err instanceof CatalogError && !/rate limited|HTTP 5/.test(err.message)) {
        throw err;
      }
      lastErr = err;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new CatalogError(`failed after ${retries + 1} attempts: ${url}`, provider);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
