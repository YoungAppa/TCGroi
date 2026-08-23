import { gradingCost, PSA_FEES_AS_OF } from "@/lib/grading/fees";


import { useMoney } from "@/lib/money/context";

interface ChaseLike {
  cardId: string;
  name: string;
  number: string;
  valueCents: number;
  psa10Cents: number | null;
  /** Share of this card's PSA population graded 10, or null with no census. */
  gemRate?: number | null;
  /** Size of that population, so the reader can judge the rate. */
  populationTotal?: number | null;
  /** Guaranteed promo (ETB/box insert) rather than a card pulled from a pack. */
  isPromo?: boolean;
}

/**
 * "Is it worth grading?" for a product's chase cards.
 *
 * PSA 10 sale value (from PokemonPriceTracker, where we have it) vs the raw
 * price plus PSA's fee gives the upside if the card grades a 10 — the
 * "Net if 10" column. It is an upper bound: it assumes a perfect grade. The
 * missing piece is the ODDS of actually getting a 10 (PSA population data,
 * Business-tier only), so that column stays pending — this shows the payoff,
 * not the probability-weighted expectation. Cards below a few dollars raw are
 * never worth grading, so they're omitted.
 */
export function GradingGuide({
  chase,
  promos = [],
}: {
  chase: ChaseLike[];
  /**
   * Guaranteed promos, listed FIRST: unlike a chase card you might pull, every
   * buyer gets these, so "should I grade it?" is a decision they will actually
   * face. Tagged so they're never mistaken for a pack pull.
   */
  promos?: ChaseLike[];
}) {
  const { money } = useMoney();
  const GRADEABLE_MIN = 1000; // $10 raw — the fee ($80+) dwarfs anything cheaper
  const promoRows = promos
    .filter((c) => c.valueCents >= GRADEABLE_MIN)
    .map((c) => ({ ...c, isPromo: true }));
  const chaseRows = chase.filter((c) => c.valueCents >= GRADEABLE_MIN);
  const rows = [...promoRows, ...chaseRows].slice(0, 12);
  if (rows.length === 0) return null;

  return (
    <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Is it worth grading?</h2>
        <span className="text-xs text-muted">PSA US fees, approx · {PSA_FEES_AS_OF}</span>
      </div>
      <p className="text-xs text-muted">
        What a PSA 10 sells for vs the raw price plus PSA&apos;s fee — the upside{" "}
        <em>if</em> the card grades a 10. The odds of actually getting a 10 are a
        separate column, still pending.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-3">Card</th>
              <th className="py-1.5 pr-3">Raw</th>
              <th className="py-1.5 pr-3">PSA fee</th>
              <th className="py-1.5 pr-3">PSA 10 value</th>
              <th className="py-1.5 pr-3">Net if 10</th>
              <th className="py-1.5">Chance of 10</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              // PSA prices the tier off the DECLARED (graded) value — pass the
              // PSA 10 price when we have it, else the raw value stands in.
              const g = gradingCost(c.valueCents, c.psa10Cents ?? undefined);
              const net =
                c.psa10Cents !== null ? c.psa10Cents - c.valueCents - g.feeCents : null;
              return (
                <tr key={c.cardId} className="border-b border-border/40 last:border-0">
                  <td className="py-1.5 pr-3">
                    {c.name} <span className="text-muted">#{c.number}</span>
                    {c.isPromo && (
                      <span
                        className="ml-1.5 rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted"
                        title="Guaranteed promo card — every one of these products includes it, so it isn't a pack pull."
                      >
                        promo
                      </span>
                    )}
                  </td>
                  <td className="tabular py-1.5 pr-3">{money(c.valueCents)}</td>
                  <td className="tabular py-1.5 pr-3 text-muted">
                    {money(g.feeCents)}{" "}
                    <span className="text-[11px]">({g.service})</span>
                  </td>
                  <td className="tabular py-1.5 pr-3 font-medium">
                    {c.psa10Cents !== null ? (
                      money(c.psa10Cents)
                    ) : (
                      <span
                        className="text-muted/60"
                        title="PSA 10 sale price — not fetched for this card yet"
                      >
                        —
                      </span>
                    )}
                  </td>
                  <td className="tabular py-1.5 pr-3 font-medium">
                    {net !== null ? (
                      <span className={net > 0 ? "text-roi-pos" : "text-roi-neg"}>
                        {net > 0 ? "+" : ""}
                        {money(net)}
                      </span>
                    ) : (
                      <span className="text-muted/60">—</span>
                    )}
                  </td>
                  <td className="tabular py-1.5">
                    {c.gemRate != null ? (
                      <span
                        className={
                          c.gemRate >= 0.5
                            ? "text-roi-pos"
                            : c.gemRate >= 0.2
                              ? "text-amber-400"
                              : "text-roi-neg"
                        }
                        title={`Of ${c.populationTotal?.toLocaleString() ?? "?"} PSA-graded copies, ${Math.round((c.gemRate ?? 0) * 100)}% came back a 10. A census of cards people chose to submit, so treat it as a ceiling rather than the odds for a random copy.`}
                      >
                        {(c.gemRate * 100).toFixed(0)}%
                        {c.populationTotal != null && (
                          <span className="ml-1 text-[10px] text-muted">
                            n={c.populationTotal.toLocaleString()}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span
                        className="text-muted/60"
                        title="Too few PSA-graded copies to quote a rate"
                      >
                        —
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">
        <span className="text-foreground">Net if 10</span> = PSA 10 value − raw −
        fee, the gain assuming a perfect grade (an upper bound — most cards
        won&apos;t 10). <span className="text-foreground">Chance of 10</span> is this
        card&apos;s own PSA population — of every copy graded, the share that came
        back a 10 — and it drives the graded EV toggle instead of one flat
        assumption. Read it as a ceiling, not a coin flip: it counts cards people
        CHOSE to submit, which skews toward good copies, and a card pulled from a
        pack today may fare worse. A &ldquo;—&rdquo; means too few graded copies
        to quote. PSA 10 prices come from Scrydex and PokemonPriceTracker. Fees exclude shipping and use the cheapest PSA tier for each
        card&apos;s declared (graded) value. PSA paused its cheaper Value tiers
        in June 2026 under a grading backlog, so Regular ($79.99) is the current
        floor — grading a card much under ~$100 rarely makes sense.
      </p>
    </section>
  );
}
