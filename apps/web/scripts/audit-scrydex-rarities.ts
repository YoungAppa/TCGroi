import { writeFileSync } from "node:fs";
const H = { "X-Api-Key": process.env.TCGPLAYER_MIRROR_API_KEY!, "X-Team-ID": process.env.SCRYDEX_TEAM_ID!, accept: "application/json" };
async function cards(id: string) {
  const out: any[] = [];
  for (let page = 1; page < 10; page++) {
    const r = await fetch(`https://api.scrydex.com/pokemon/v1/expansions/${encodeURIComponent(id)}/cards?page=${page}&page_size=250`, { headers: H, signal: AbortSignal.timeout(30000) });
    if (!r.ok) { out.push({ error: r.status }); break; }
    const d = await r.json(); out.push(...(d.data ?? []));
    if ((d.data ?? []).length < 250) break;
  }
  return out;
}
async function main() {
  const out: Record<string, any> = {};
  for (const id of ["s6a_ja", "s4a_ja", "s8b_ja", "sm12a_ja", "sm8b_ja", "xy8a_ja", "xy1a_ja", "cp5_ja", "s10p_ja", "bw9_ja", "l1_ja", "dp7", "ex8", "mep", "mcd24", "sve"]) {
    const cs = await cards(id);
    const codes: Record<string, number> = {};
    for (const c of cs) { const k = `${c.rarity_code ?? "?"}|${c.rarity ?? "?"}`; codes[k] = (codes[k] ?? 0) + 1; }
    out[id] = { n: cs.length, codes, sample: cs[0] ? { name: c0(cs[0]), number: cs[0].number, prices: (cs[0].variants?.[0]?.prices ?? []).slice(0, 2), images: cs[0].images?.[0]?.small ?? cs[0].images?.[0]?.medium } : null };
    console.log(id, cs.length, JSON.stringify(codes));
  }
  writeFileSync(process.argv[2]!, JSON.stringify(out, null, 1));
  process.exit(0);
}
const c0 = (c: any) => c.name;
main().catch((e) => { console.error(e); process.exit(1); });
