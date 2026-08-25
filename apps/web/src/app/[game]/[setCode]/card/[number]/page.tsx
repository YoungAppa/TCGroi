import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CardDetail } from "@/components/CardDetail";
import { getCardContext } from "@/lib/data";
import { formatCents } from "@packroi/ev/format";
import { median } from "@packroi/ev";

// ISR like every data page. Card pages are NOT prerendered (87k cards would
// swamp the build) — they render on first request and cache for an hour.
export const revalidate = 3600;

type Params = { game: string; setCode: string; number: string };

function rawMedianCents(card: { raw: Record<string, number> }): number | null {
  return median(Object.values(card.raw));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { game, setCode, number } = await params;
  const ctx = await getCardContext(game, setCode, decodeURIComponent(number));
  if (!ctx) return {};
  const price = rawMedianCents(ctx.card);
  const best = ctx.sources.find((s) => s.oneInPacks !== null);
  const title = `${ctx.card.name} #${ctx.card.number} (${ctx.setName})${price !== null ? ` — ${formatCents(price)}` : ""}${best?.oneInPacks ? `, 1 in ~${Math.round(best.oneInPacks).toLocaleString()} packs` : ""}`;
  const description = `Where to pull ${ctx.card.name} #${ctx.card.number}: every ${ctx.setName} product that can contain it, with per-product odds, prices, and grading data.`;
  const canonical = `/${ctx.gameSlug}/${ctx.setCode}/card/${encodeURIComponent(ctx.card.number)}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { type: "website", title, description, url: canonical, images: ctx.card.imageUrl ? [ctx.card.imageUrl] : undefined },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CardPage({ params }: { params: Promise<Params> }) {
  const { game, setCode, number } = await params;
  const ctx = await getCardContext(game, setCode, decodeURIComponent(number));
  if (!ctx) notFound();

  return (
    <div className="space-y-6">
      <nav className="text-xs uppercase tracking-wide text-muted">
        <Link href="/" className="hover:text-foreground">
          {ctx.gameName}
        </Link>{" "}
        · <span className="tabular">{ctx.setCode}</span> ·{" "}
        <span className="text-foreground">{ctx.setName}</span>
      </nav>
      <CardDetail ctx={ctx} />
    </div>
  );
}
