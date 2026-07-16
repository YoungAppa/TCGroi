import { NextResponse, type NextRequest } from "next/server";

import { cronAuthorized } from "@/lib/jobs/auth";
import { refreshCatalog } from "@/lib/jobs/refresh-catalog";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Weekly catalog refresh: new sets/cards + pull-rate table reload. */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const stats = await refreshCatalog();
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
