import { RankingsHero, type HeroCard } from "@/components/RankingsHero";
import { RankingsTable } from "@/components/RankingsTable";
import { getRankings } from "@/lib/data";
import { computeProduct } from "@/lib/data/compute";
import { DEFAULT_FILTER_STATE } from "@packroi/ev/url-state";

// ISR: rebuilt hourly from the DB the cron jobs write into. Never fetches
// externally at request time.
export const revalidate = 3600;

export default async function HomePage() {
  const { products, availableSources } = await getRankings();
  const sourceIds = availableSources.map((s) => s.id);

  // Everything the hero states is computed from the same engine that drives the
  // table below, under the page's default filters — so the hero can never
  // contradict the rankings a reader scrolls to.
  const computed = products.map((p) => ({
    payload: p,
    c: computeProduct(p, DEFAULT_FILTER_STATE, sourceIds),
  }));

  const losingCount = computed.filter((r) => r.c.roiMarket !== null && r.c.roiMarket < 0).length;
  const rankedCount = computed.filter((r) => r.c.roiMarket !== null).length;

  // The hero's fan is the three most valuable chase cards we price anywhere,
  // deduped by card so one set's alt-art run can't fill all three slots with
  // near-identical art. Their odds ride along from the same chase table.
  const heroCards: HeroCard[] = [];
  const seenCards = new Set<string>();
  const seenSets = new Set<string>();
  // Scrydex serves SAMPLE-watermarked art for One Piece, and a watermark across
  // the hero is not a look we can ship. English Pokémon art comes from
  // pokemontcg.io clean, and is also the site's best-evidenced corner — so the
  // fan draws from there, falling back to anything priced if that pool is empty.
  const heroPool = computed.filter(
    (r) => r.payload.gameSlug === "pokemon" && r.payload.setLanguage === "EN",
  );
  const allChase = (heroPool.length > 0 ? heroPool : computed)
    .flatMap((r) =>
      r.c.ev.chase.slice(0, 5).map((ch) => ({
        ch,
        setCode: r.payload.setCode,
        img: r.payload.cards.find((cd) => cd.cardId === ch.cardId)?.imageUrl ?? null,
      })),
    )
    .filter((x) => x.img)
    .sort((a, b) => b.ch.valueCents - a.ch.valueCents);

  // One card per set for the first pass, so the fan shows three different sets;
  // if that can't fill three, backfill with the next most valuable of any set.
  for (const pass of [true, false]) {
    for (const x of allChase) {
      if (heroCards.length >= 3) break;
      if (seenCards.has(x.ch.cardId)) continue;
      if (pass && seenSets.has(x.setCode)) continue;
      seenCards.add(x.ch.cardId);
      seenSets.add(x.setCode);
      heroCards.push({
        cardId: x.ch.cardId,
        name: x.ch.name,
        imageUrl: x.img!,
        valueCents: x.ch.valueCents,
        // Infinity means the tier's odds don't resolve for this card — the hero
        // drops the claim rather than printing a fabricated rate.
        oneInPacks: Number.isFinite(x.ch.oneInPacks) ? x.ch.oneInPacks : null,
      });
    }
  }

  const cardCount = products.reduce((n, p) => n + p.cards.length, 0);

  return (
    <div className="space-y-6">
      <RankingsHero
        cards={heroCards}
        productCount={rankedCount}
        losingCount={losingCount}
        cardCount={cardCount}
      />


      <RankingsTable products={products} availableSources={availableSources} />
    </div>
  );
}
