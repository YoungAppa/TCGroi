import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { rarityLabel } from "@/lib/catalog/rarities";
import { getSpeciesPage, type SpeciesCard } from "@/lib/data/species";
import { formatCents } from "@packroi/ev/format";

// ISR like every data page; species pages render on first request.
export const revalidate = 3600;

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://whatsthatroi.com";
const LANG_LABEL: Record<SpeciesCard["language"], string> = { EN: "English", JP: "Japanese (日本語)", ZH: "Chinese (中文)" };
const LANG_ORDER: SpeciesCard["language"][] = ["EN", "JP", "ZH"];

const cardHref = (c: SpeciesCard) => `/pokemon/${encodeURIComponent(c.setCode)}/card/${encodeURIComponent(c.number)}`;
const displayName = (c: SpeciesCard) => (c.nameEn ? `${c.name} (${c.nameEn})` : c.name);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const sp = await getSpeciesPage(slug);
  if (!sp) return {};
  const priced = sp.cards.filter((c) => c.priceCents !== null);
  const top = priced[0];
  const low = priced[priced.length - 1];
  const range = top && low ? ` Prices run from ${formatCents(low.priceCents!)} to ${formatCents(top.priceCents!)}.` : "";
  const topBit = top ? ` The most valuable is ${displayName(top)} #${top.number} from ${top.setName} at ${formatCents(top.priceCents!)}.` : "";
  return {
    title: `Every ${sp.nameEn} card — ${sp.cardCount} cards, prices & pull odds`,
    description: `${sp.nameEn} appears on ${sp.cardCount} cards across ${sp.setCount} sets in English, Japanese and Chinese.${range}${topBit} Each card links to its odds and the packs that pull it.`,
    alternates: { canonical: `${SITE}/pokedex/${sp.slug}` },
  };
}

/**
 * One Pokémon, every card. The list is the point — for SEO ("every Pikachu
 * card") and for the collector who wants to see the whole run of a species —
 * so it is rendered in full, richest first, per language, each row linking to
 * the card page with odds. Prices are the latest raw medians we track; cards
 * without one say so rather than showing a guess.
 */
export default async function SpeciesPageView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sp = await getSpeciesPage(slug);
  if (!sp) notFound();

  const priced = sp.cards.filter((c) => c.priceCents !== null);
  const top = priced[0];
  const low = priced[priced.length - 1];
  const showcase = priced.slice(0, 8);
  const byLang = new Map<SpeciesCard["language"], SpeciesCard[]>();
  for (const c of sp.cards) byLang.set(c.language, [...(byLang.get(c.language) ?? []), c]);
  const dex = `#${String(sp.id).padStart(4, "0")}`;

  const faq = [
    {
      q: `How many ${sp.nameEn} cards are there?`,
      a: `WhatsThatROI tracks ${sp.cardCount} ${sp.nameEn} cards across ${sp.setCount} sets: ${LANG_ORDER.filter((l) => byLang.has(l)).map((l) => `${byLang.get(l)!.length} ${LANG_LABEL[l].split(" ")[0]}`).join(", ")}.`,
    },
    top && {
      q: `What is the most expensive ${sp.nameEn} card?`,
      a: `The most valuable ${sp.nameEn} card we track is ${displayName(top)} #${top.number} from ${top.setName}, at ${formatCents(top.priceCents!)} raw (latest market median).`,
    },
    low && top && low !== top && {
      q: `What is the cheapest ${sp.nameEn} card?`,
      a: `The cheapest priced ${sp.nameEn} card is ${displayName(low)} #${low.number} from ${low.setName} at ${formatCents(low.priceCents!)}.`,
    },
  ].filter(Boolean) as { q: string; a: string }[];

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE },
        { "@type": "ListItem", position: 2, name: "Pokédex", item: `${SITE}/pokedex` },
        { "@type": "ListItem", position: 3, name: sp.nameEn, item: `${SITE}/pokedex/${sp.slug}` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `Most valuable ${sp.nameEn} cards`,
      itemListElement: showcase.map((c, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: `${displayName(c)} #${c.number} (${c.setName})`,
        url: `${SITE}${cardHref(c)}`,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ];

  return (
    <div className="space-y-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav className="text-xs text-muted" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-foreground">Home</Link> ›{" "}
        <Link href="/pokedex" className="hover:text-foreground">Pokédex</Link> ›{" "}
        <span className="text-foreground">{sp.nameEn}</span>
      </nav>

      <header className="flex flex-col gap-5 sm:flex-row sm:items-center">
        {sp.imageUrl && (
          <img src={sp.imageUrl} alt={sp.nameEn} className="h-36 w-36 shrink-0 object-contain" />
        )}
        <div className="min-w-0">
          <p className="tabular text-xs text-muted">
            {dex}
            {sp.generation ? ` · Generation ${sp.generation}` : ""}
            {sp.nameJa ? ` · ${sp.nameJa}` : ""}
            {sp.nameZh ? ` · ${sp.nameZh}` : ""}
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight">Every {sp.nameEn} card</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            {sp.nameEn} appears on <strong className="text-foreground">{sp.cardCount}</strong> cards across{" "}
            <strong className="text-foreground">{sp.setCount}</strong> sets
            {top && low ? (
              <>
                , priced from <strong className="text-foreground">{formatCents(low.priceCents!)}</strong> to{" "}
                <strong className="text-foreground">{formatCents(top.priceCents!)}</strong>
              </>
            ) : null}
            . Every card below links to its own page with the exact pull odds and the products that can open it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {LANG_ORDER.filter((l) => byLang.has(l)).map((l) => (
              <a key={l} href={`#${l.toLowerCase()}`} className="tabular rounded-full border border-border bg-surface px-2.5 py-1 text-muted hover:text-foreground">
                {LANG_LABEL[l]} · {byLang.get(l)!.length}
              </a>
            ))}
          </div>
        </div>
      </header>

      {showcase.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-xl font-bold">Most valuable {sp.nameEn} cards</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {showcase.map((c) => (
              <Link key={c.cardId} href={cardHref(c)} className="group rounded-lg border border-border bg-surface p-2 hover:border-accent/50">
                {c.imageUrl ? (
                  <img src={c.imageUrl} alt={`${c.name} ${c.number}`} loading="lazy" className="aspect-[5/7] w-full rounded-[4px] object-cover" />
                ) : (
                  <div className="aspect-[5/7] w-full rounded-[4px] bg-surface-raised" />
                )}
                <p className="mt-2 truncate text-xs font-medium text-foreground">{c.name}</p>
                <p className="truncate text-[11px] text-muted">
                  {c.setName} · #{c.number}
                </p>
                <p className="tabular text-sm font-semibold">{formatCents(c.priceCents!)}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {LANG_ORDER.filter((l) => byLang.has(l)).map((l) => {
        const list = byLang.get(l)!;
        return (
          <section key={l} id={l.toLowerCase()} className="space-y-3">
            <h2 className="font-display text-xl font-bold">
              {LANG_LABEL[l]} {sp.nameEn} cards{" "}
              <span className="tabular text-base font-normal text-muted">({list.length})</span>
            </h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2">Card</th>
                    <th className="px-3 py-2">Set</th>
                    <th className="px-3 py-2">No.</th>
                    <th className="px-3 py-2">Rarity</th>
                    <th className="px-3 py-2 text-right">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.cardId} className="border-t border-border hover:bg-surface">
                      <td className="px-3 py-1.5">
                        <Link href={cardHref(c)} className="flex items-center gap-2.5">
                          {c.imageUrl ? (
                            <img src={c.imageUrl} alt="" loading="lazy" className="h-10 w-7 shrink-0 rounded-[3px] object-cover object-top" />
                          ) : (
                            <span className="h-10 w-7 shrink-0 rounded-[3px] bg-surface-raised" />
                          )}
                          <span className="font-medium text-foreground">{displayName(c)}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-1.5 text-muted">
                        <Link href={`/pokemon/${encodeURIComponent(c.setCode)}`} className="hover:text-foreground">
                          {c.setName}
                        </Link>
                      </td>
                      <td className="tabular px-3 py-1.5 text-muted">{c.number}</td>
                      <td className="px-3 py-1.5 text-muted">{rarityLabel(c.rarity)}</td>
                      <td className="tabular px-3 py-1.5 text-right font-semibold">
                        {c.priceCents !== null ? formatCents(c.priceCents) : <span className="font-normal text-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <section className="space-y-3">
        <h2 className="font-display text-xl font-bold">{sp.nameEn} card FAQ</h2>
        <dl className="space-y-3 text-sm">
          {faq.map((f) => (
            <div key={f.q}>
              <dt className="font-medium text-foreground">{f.q}</dt>
              <dd className="mt-0.5 text-muted">{f.a}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted">
          Cards are matched to {sp.nameEn} by name (tag teams count for both Pokémon); trainer cards named after it
          are left out. Prices are the latest raw market medians we track; a dash means no tracked price yet.
        </p>
      </section>
    </div>
  );
}
