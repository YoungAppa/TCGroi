import { NextResponse } from "next/server";

import { searchCards } from "@/lib/data/cards";

// Card search for the collection tracker. Queries our own DB only — no external
// call — so it's a fast dynamic route, not something to cache.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const game = searchParams.get("game") ?? undefined;
  if (q.trim().length < 2) return NextResponse.json({ results: [] });

  try {
    const results = await searchCards(q, { game: game || undefined });
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "search failed" }, { status: 500 });
  }
}
