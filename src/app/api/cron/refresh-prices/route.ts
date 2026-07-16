import { NextResponse, type NextRequest } from "next/server";

import { cronAuthorized } from "@/lib/jobs/auth";
import { refreshPrices } from "@/lib/jobs/refresh-prices";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Daily price refresh. Invoked by Vercel Cron (Authorization: Bearer
 * CRON_SECRET) or manually from /admin with the admin secret.
 *
 * This is the ONLY doorway through which external price APIs are ever called
 * in production — never from a page.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const stats = await refreshPrices();
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    // The failure is already recorded in job_runs; surface it to cron logs.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
