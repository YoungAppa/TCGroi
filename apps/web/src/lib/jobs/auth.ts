import type { NextRequest } from "next/server";

/**
 * Gate for cron/admin endpoints: Vercel Cron's CRON_SECRET or our
 * ADMIN_SECRET, as a bearer token. Constant-shape comparison is not needed
 * here — both secrets are long and random, and the endpoint does nothing
 * user-differentiated.
 */
export function cronAuthorized(req: NextRequest): boolean {
  const header = req.headers.get("authorization");
  const secrets = [process.env.CRON_SECRET, process.env.ADMIN_SECRET].filter(Boolean);
  return secrets.some((s) => header === `Bearer ${s}`);
}
