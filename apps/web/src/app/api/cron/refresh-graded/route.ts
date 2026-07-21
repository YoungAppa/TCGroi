import { NextResponse, type NextRequest } from "next/server";

import { cronAuthorized } from "@/lib/jobs/auth";
import { refreshGraded } from "@/lib/jobs/refresh-graded";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Daily graded-price top-up. Fetches PSA 10/9 prices for a budget-limited batch
 * of the highest-value Pokémon chase cards (PokemonPriceTracker is credit
 * metered), so successive days fill and refresh the whole chase set. No-ops when
 * POKEPRICE_TOKEN is unset. Auth as the other crons (Bearer CRON_SECRET, or the
 * admin secret from /admin).
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const stats = await refreshGraded();
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
