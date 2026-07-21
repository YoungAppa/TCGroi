import { RankingsTable } from "@/components/RankingsTable";
import { computeProduct } from "@/lib/data/compute";
import { getRankings } from "@/lib/data";
import { DEFAULT_FILTER_STATE } from "@packroi/ev/url-state";

// ISR: rebuilt hourly from the DB the cron jobs write into. Never fetches
// externally at request time.
export const revalidate = 3600;

export default async function HomePage() {
  const { products, availableSources } = await getRankings();

  const shown = products.filter((p) => p.pullRates.confidence !== "placeholder");
  const setCount = new Set(shown.map((p) => p.setCode)).size;

  // The thesis, quantified from our own data. Computed on the DEFAULT source
  // blend (the exact state the table first renders) so the hero and the first
  // paint of the table can never contradict each other.
  const ids = availableSources.map((s) => s.id);
  const priced = shown
    .map((p) => ({ p, c: computeProduct(p, DEFAULT_FILTER_STATE, ids) }))
    .filter((x) => x.p.market.priceCents !== null && x.p.market.priceCents > 0);

  // Dollar-weighted, not a mean of ratios: sum(EV) / sum(price) answers "across
  // every sealed product we track, what does $1 at market actually buy back?"
  // — honest even though a few expensive boxes dominate the pool.
  const totalEv = priced.reduce((s, x) => s + x.c.ev.evProductCents, 0);
  const totalMarket = priced.reduce((s, x) => s + (x.p.market.priceCents ?? 0), 0);
  const centsOnDollar = totalMarket > 0 ? Math.round((totalEv / totalMarket) * 100) : null;
  const losing = priced.filter((x) => (x.c.roiMarket ?? 0) < 0).length;

  return (
    <div className="space-y-8">
      {/* Hero: the site's thesis, proven with its own numbers. */}
      <section className="relative overflow-hidden rounded-2xl border border-border bg-surface">
        {/* Pack-foil sheen — the only decorative use of the accent on the page. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_150%_at_0%_0%,rgba(234,179,8,0.10),transparent_55%)]"
        />
        <div className="relative px-5 py-8 sm:px-8 sm:py-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent">
            The math on ripping packs
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-bold leading-[1.1] tracking-tight sm:text-[2.6rem]">
            Opening sealed product is almost always a{" "}
            <span className="text-roi-neg">losing bet</span>.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
            TCGROI values every booster box, Elite Trainer Box and pack by its real
            community pull rates × live card prices — so you can see the loss
            before you rip, not after.
          </p>

          {centsOnDollar !== null && (
            <dl className="mt-8 grid max-w-2xl grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
              <Stat
                label="Cards back per $1 at market"
                value={`${centsOnDollar}¢`}
                tone="neg"
              />
              <Stat label="Products that lose money" value={`${losing}/${priced.length}`} />
              <Stat
                label="Sets tracked"
                value={`${setCount}`}
                sub={`${shown.length} products`}
              />
            </dl>
          )}
        </div>
      </section>

      <div>
        <h2 className="text-xl font-bold tracking-tight">Sealed product rankings</h2>
        <p className="mt-1 text-sm text-muted">
          Expected value of opening, from community pull rates × live card prices.
          Sets without real community data are hidden until they have it.
        </p>
      </div>

      <RankingsTable products={products} availableSources={availableSources} />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "neg";
}) {
  return (
    <div className="bg-surface px-4 py-3.5">
      <dd
        className={`tabular text-2xl font-bold leading-none sm:text-[1.75rem] ${
          tone === "neg" ? "text-roi-neg" : "text-foreground"
        }`}
      >
        {value}
      </dd>
      <dt className="mt-1.5 text-[11px] uppercase leading-tight tracking-wide text-muted">
        {label}
        {sub && <span className="ml-1 normal-case tracking-normal text-muted/70">· {sub}</span>}
      </dt>
    </div>
  );
}
