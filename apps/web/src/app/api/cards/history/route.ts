import { NextResponse } from "next/server";

import { getCardHistory } from "@/lib/data/cards";

// Per-card price-history for the collection card detail. Our DB only.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    return NextResponse.json({ history: await getCardHistory(id) });
  } catch {
    return NextResponse.json({ history: [] });
  }
}
