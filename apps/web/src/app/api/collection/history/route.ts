import { NextResponse } from "next/server";

import { getCollectionHistory } from "@/lib/data/cards";

// Portfolio value over time. POST { holdings: [{cardId, qty}] }.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let holdings: unknown;
  try {
    ({ holdings } = await request.json());
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (!Array.isArray(holdings) || holdings.length > 2000) {
    return NextResponse.json({ error: "holdings must be a small array" }, { status: 400 });
  }
  const clean = holdings
    .filter(
      (h): h is { cardId: string; qty: number } =>
        !!h && typeof h.cardId === "string" && typeof h.qty === "number",
    )
    .map((h) => ({ cardId: h.cardId, qty: h.qty }));
  try {
    return NextResponse.json({ history: await getCollectionHistory(clean) });
  } catch {
    return NextResponse.json({ history: [] });
  }
}
