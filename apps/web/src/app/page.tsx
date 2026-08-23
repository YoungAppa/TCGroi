import { RankingsHeading } from "@/components/RankingsHeading";
import { RankingsTable } from "@/components/RankingsTable";
import { getRankings } from "@/lib/data";

// ISR: rebuilt hourly from the DB the cron jobs write into. Never fetches
// externally at request time.
export const revalidate = 3600;

export default async function HomePage() {
  const { products, availableSources } = await getRankings();

  return (
    <div className="space-y-6">
      <RankingsHeading />

      <RankingsTable products={products} availableSources={availableSources} />
    </div>
  );
}
