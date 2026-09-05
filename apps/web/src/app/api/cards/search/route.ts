import { NextResponse } from "next/server";

import { searchCards } from "@/lib/data/cards";
import { searchSpecies } from "@/lib/data/species";

// Card search for the search box. Queries our own DB only — no external
// call — so it's a fast dynamic route, not something to cache.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const game = searchParams.get("game") ?? undefined;
  if (q.trim().length < 2) return NextResponse.json({ results: [], species: [] });

  try {
    // Species hits (Pikachu -> every Pikachu card) ride along whenever the
    // search isn't scoped to another game.
    const wantSpecies = !game || game === "all" || game === "pokemon";
    const [results, species] = await Promise.all([
      searchCards(q, { game: game && game !== "all" ? game : undefined }),
      wantSpecies ? searchSpecies(q) : Promise.resolve([]),
    ]);
    return NextResponse.json({ results, species });
  } catch {
    return NextResponse.json({ error: "search failed" }, { status: 500 });
  }
}
