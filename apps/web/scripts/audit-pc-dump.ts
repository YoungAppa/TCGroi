// Save the PriceCharting pokemon-cards + one-piece CSVs to scratch for reuse.
import { writeFileSync } from "node:fs";
const OUT = process.argv[2]!;
async function main() {
  const t = process.env.PRICECHARTING_TOKEN!;
  for (const cat of ["pokemon-cards", "one-piece-cards"]) {
    const r = await fetch(`https://www.pricecharting.com/price-guide/download-custom?t=${encodeURIComponent(t)}&category=${cat}`, { signal: AbortSignal.timeout(300000) });
    writeFileSync(`${OUT}/pc-${cat}.csv`, await r.text());
    console.log(cat, "saved");
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
