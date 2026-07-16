import { RankingsTable } from "@/components/RankingsTable";
import { getRankings } from "@/lib/data";

// ISR: rebuilt hourly from the DB the cron jobs write into. Never fetches
// externally at request time.
export const revalidate = 3600;

export default async function HomePage() {
  const { products, availableSources } = await getRankings();

  const shown = products.filter((p) => p.pullRates.confidence !== "placeholder");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sealed product rankings</h1>
        <p className="mt-1 text-sm text-muted">
          Expected value of opening, from community pull rates × live card
          prices. {shown.length} products across{" "}
          {new Set(shown.map((p) => p.setCode)).size} sets — sets without real
          community data are hidden until they have it.
        </p>
      </div>

      <RankingsTable products={products} availableSources={availableSources} />
    </div>
  );
}
