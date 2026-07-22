import { NextResponse } from "next/server";

import { valueCards } from "@/lib/data/cards";

// Re-value a saved collection: POST { ids: string[] } -> { prices: {id: cents} }.
// The collection lives in the browser (localStorage); this just refreshes the
// current worth of whatever card ids it holds.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let ids: unknown;
  try {
    ({ ids } = await request.json());
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) {
    return NextResponse.json({ error: "ids must be a string array" }, { status: 400 });
  }
  if (ids.length > 2000) {
    return NextResponse.json({ error: "too many ids" }, { status: 413 });
  }

  try {
    const map = await valueCards(ids as string[]);
    return NextResponse.json({ prices: Object.fromEntries(map) });
  } catch {
    return NextResponse.json({ error: "valuation failed" }, { status: 500 });
  }
}
