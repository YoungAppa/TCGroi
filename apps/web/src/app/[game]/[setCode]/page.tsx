import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "next/link";

import { SetDetail } from "@/components/SetDetail";
import { rarityLabel } from "@/lib/catalog/rarities";
import { getRankings, getSetProducts, getUnrankedSetCards } from "@/lib/data";
import { formatCents } from "@packroi/ev/format";
import { buildRankingsRows } from "@/lib/data/rankings-rows";

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
  if (first) {
    return {
      alternates: { canonical: `/${game}/${setCode}` },
      title: `${first.setName} (${setCode}) — sealed product EV & card prices`,
      description: `Every sealed product and card price for ${first.setName}. Community pull rates with confidence levels and citations.`,
    };
  }
  const fallback = await getUnrankedSetCards(game, setCode);
  if (!fallback) return {
    alternates: { canonical: `/${game}/${setCode}` },};
  return {
    title: `${fallback.setName} (${setCode}) — card list & prices`,
    description: `Every ${fallback.setName} card with live market prices. No sealed product is ranked for this set — no source publishes usable pull rates.`,
  };
}

export default async function SetPage({ params }: { params: Promise<Params> }) {
  const { game, setCode } = await params;
  const products = await getSetProducts(game, setCode);
  const first = products[0];
  if (!first) {
    // Sets with no ranked product (most Simplified-Chinese and many Japanese
    // sets — nobody publishes usable odds for them) still deserve a hub: the
    // card list with live prices, each linking to its card page. Card-page
    // breadcrumbs point here, so this must not 404.
    const fb = await getUnrankedSetCards(game, setCode);
    if (!fb) notFound();
    const priced = fb.cards.filter((c) => c.priceCents !== null).length;
    return (
      <div className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">
            {fb.gameName} · {fb.setCode}
          </p>
          <h1 className="font-display text-2xl font-bold tracking-tight">{fb.setName}</h1>
          <p className="mt-1 text-sm text-muted">
            {fb.cards.length} cards, {priced} priced. No sealed product is ranked for this
            set — no source publishes usable pull rates, and this site doesn&apos;t invent
            odds. Prices are live regardless.
          </p>
        </div>
        {fb.products.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">
              Sealed products{" "}
              <span className="text-xs font-normal text-muted">
                prices live · not ranked (no published pull rates)
              </span>
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {fb.products.map((pr) => (
                <div
                  key={pr.name}
                  className="rounded-xl border border-border bg-surface p-3"
                  title={pr.contentsNote ?? undefined}
                >
                  {pr.imageUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={pr.imageUrl} alt={pr.name} loading="lazy" className="mx-auto h-24 object-contain" />
                  )}
                  <div className="mt-2 truncate text-xs font-medium">{pr.name}</div>
                  <div className="tabular text-sm font-semibold">
                    {pr.priceCents !== null ? formatCents(pr.priceCents) : "—"}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {fb.cards.map((c) => (
            <Link
              key={c.number}
              href={`/${fb.gameSlug}/${fb.setCode}/card/${encodeURIComponent(c.number)}`}
              className="group flex flex-col overflow-hidden rounded-xl bg-surface ring-1 ring-white/5 transition hover:ring-accent/50"
            >
              <div className="relative aspect-[5/7] w-full overflow-hidden bg-surface-raised">
                {c.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={c.imageUrl} alt={c.name} loading="lazy" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center px-2 text-center text-xs text-muted">{c.name}</div>
                )}
                {c.priceCents !== null && (
                  <span className="tabular absolute right-1.5 top-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-emerald-300 backdrop-blur-sm">
                    {formatCents(c.priceCents)}
                  </span>
                )}
              </div>
              <div className="p-2">
                <div className="truncate text-xs font-medium">{c.name} <span className="text-muted">#{c.number}</span></div>
                <div className="text-[10px] text-muted">{rarityLabel(c.rarity)}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const { availableSources } = await getRankings();
  // EV precomputed per filter combination, so the page ships numbers instead of
  // every product's copy of the same card list.
  const { rows } = buildRankingsRows(
    products,
    availableSources.map((s) => s.id),
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">
          {first.gameName} · {first.setCode}
          {first.releaseDate ? ` · ${first.releaseDate}` : ""}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">{first.setName}</h1>
      </div>

      <SetDetail
        rows={rows}
        cards={first.cards}
        availableSources={availableSources}
      />
    </div>
  );
}
