// Enumerate PriceCharting consoles (= sets) with priced rows per category so we
// can see which priced sets/promos the catalog lacks. Writes a summary file.
import { writeFileSync } from "node:fs";
const OUT = process.argv[2]!;
async function main() {
  const t = process.env.PRICECHARTING_TOKEN!;
  const out: Record<string, Record<string, number>> = {};
  for (const cat of ["pokemon-cards", "one-piece-cards"]) {
    const r = await fetch(`https://www.pricecharting.com/price-guide/download-custom?t=${encodeURIComponent(t)}&category=${cat}`, { signal: AbortSignal.timeout(300000) });
    if (!r.ok) { out[cat] = { [`HTTP ${r.status}`]: 0 }; continue; }
    const csv = await r.text();
    const counts: Record<string, number> = {};
    for (const line of csv.split("\n").slice(1)) {
      const first = line.indexOf(",");
      if (first < 0) continue;
      const rest = line.slice(first + 1);
      const c = rest.startsWith('"') ? rest.slice(1, rest.indexOf('"', 1)) : rest.slice(0, rest.indexOf(","));
      counts[c] = (counts[c] ?? 0) + 1;
    }
    out[cat] = counts;
    console.log(cat, "rows:", csv.split("\n").length, "consoles:", Object.keys(counts).length);
  }
  writeFileSync(`${OUT}/pc-consoles.json`, JSON.stringify(out, null, 1));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
