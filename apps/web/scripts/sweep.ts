/** Crawl every product/set page + sampled card pages; flag anything broken. */
import { getRankings } from "@/lib/data";

const BASE = "http://localhost:3000";
const BAD = [/\$NaN/, /NaN%/, /undefined%/, /\.undefined/, />undefined</];

async function check(path: string, markers: RegExp[]): Promise<string | null> {
  try {
    const r = await fetch(BASE + path, { signal: AbortSignal.timeout(60000) });
    if (r.status !== 200) return `${r.status} ${path}`;
    const html = await r.text();
    for (const b of BAD) if (b.test(html)) return `DIRTY(${b}) ${path}`;
    for (const m of markers) if (!m.test(html)) return `MISSING(${m}) ${path}`;
    return null;
  } catch (e) {
    return `FETCH-FAIL ${path}: ${(e as Error).message.slice(0, 60)}`;
  }
}

async function main() {
  const { products } = await getRankings();
  const visible = products.filter(
    (p) => p.market.priceCents !== null || p.msrpCents !== null || p.cards.some((c) => Object.keys(c.raw).length > 0),
  );
  const urls: { path: string; markers: RegExp[] }[] = [];
  const seenSets = new Set<string>();
  for (const p of visible) {
    urls.push({ path: `/${p.gameSlug}/${p.setCode}/${p.productSlug}`, markers: [/Where the value comes from|Chase cards/] });
    const setPath = `/${p.gameSlug}/${p.setCode}`;
    if (!seenSets.has(setPath)) { seenSets.add(setPath); urls.push({ path: setPath, markers: [] }); }
  }
  // card-page sample: top chase card of every 10th visible set
  const sample = [...seenSets].filter((_, i) => i % 10 === 0);
  for (const sp of sample) {
    const p = visible.find((x) => `/${x.gameSlug}/${x.setCode}` === sp)!;
    const card = p.cards.find((c) => c.imageUrl);
    if (card) urls.push({ path: `${sp}/card/${encodeURIComponent(card.number)}`, markers: [/Where to pull it/] });
  }
  urls.push({ path: "/", markers: [/The chase is/] }, { path: "/methodology", markers: [/Methodology/] });

  console.log(`sweeping ${urls.length} pages...`);
  const problems: string[] = [];
  let done = 0;
  const queue = [...urls];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const u = queue.shift()!;
      const r = await check(u.path, u.markers);
      if (r) problems.push(r);
      if (++done % 100 === 0) console.log(`  ${done}/${urls.length}`);
    }
  }));
  console.log(`done: ${done} pages, ${problems.length} problems`);
  problems.slice(0, 30).forEach((p) => console.log("  " + p));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
