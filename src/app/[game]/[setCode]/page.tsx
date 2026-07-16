import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SetDetail } from "@/components/SetDetail";
import { getRankings, getSetProducts } from "@/lib/data";

export const revalidate = 3600;

type Params = { game: string; setCode: string };

export async function generateStaticParams(): Promise<Params[]> {
  const { products } = await getRankings();
  const seen = new Set<string>();
  const out: Params[] = [];
  for (const p of products) {
    const key = `${p.gameSlug}/${p.setCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ game: p.gameSlug, setCode: p.setCode });
  }
  return out;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { game, setCode } = await params;
  const products = await getSetProducts(game, setCode);
  const first = products[0];
  if (!first) return {};
  return {
    title: `${first.setName} (${setCode}) — sealed product EV & card prices`,
    description: `Every sealed product and card price for ${first.setName}. Community pull rates with confidence levels and citations.`,
  };
}

export default async function SetPage({ params }: { params: Promise<Params> }) {
  const { game, setCode } = await params;
  const products = await getSetProducts(game, setCode);
  const first = products[0];
  if (!first) notFound();

  const { availableSources } = await getRankings();

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">
          {first.gameName} · {first.setCode}
          {first.releaseDate ? ` · ${first.releaseDate}` : ""}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">{first.setName}</h1>
      </div>

      <SetDetail products={products} availableSources={availableSources} />
    </div>
  );
}
