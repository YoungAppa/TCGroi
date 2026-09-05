/**
 * Build the Pokédex layer: every species from PokéAPI's data files (official
 * names in EN/JA/ZH-Hans + generation), then map every Pokémon card in the
 * catalog — English, Japanese, Chinese — to the species it depicts.
 *
 * Matching is by name, longest-match-first over word n-grams for English
 * ("Team Rocket's Mewtwo ex" -> Mewtwo; "Porygon-Z" -> Porygon-Z not Porygon;
 * "Pikachu & Zekrom-GX" -> both). JP/ZH cards use their official English name
 * when we have one, else the official native species name as a substring
 * (ミュウツー beats ミュウ by the same longest-first rule). No fuzzy matching:
 * a card either contains a species name or it stays unassigned.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

const CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
const LANG = { jaHrkt: 1, zhHant: 4, en: 9, ja: 11, zhHans: 12 } as const;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[-:–/]/g, " ").replace(/['’.]/g, "").replace(/\s+/g, " ").trim();

interface Hit { start: number; len: number; id: number }
/** Longest-first, non-overlapping. */
function pick(hits: Hit[]): number[] {
  hits.sort((a, b) => b.len - a.len || a.start - b.start);
  const taken: [number, number][] = [];
  const out: number[] = [];
  for (const h of hits) {
    const end = h.start + h.len;
    if (taken.some(([s, e]) => h.start < e && s < end)) continue;
    taken.push([h.start, end]);
    if (!out.includes(h.id)) out.push(h.id);
  }
  return out;
}

async function main() {
  const db = getDb();
  const [speciesCsv, namesCsv] = await Promise.all([
    fetch(`${CSV}/pokemon_species.csv`).then((r) => r.text()),
    fetch(`${CSV}/pokemon_species_names.csv`).then((r) => r.text()),
  ]);
  const sp = parseCsv(speciesCsv); const spH = sp[0]!;
  const nm = parseCsv(namesCsv); const nmH = nm[0]!;
  const col = (h: string[], k: string) => h.indexOf(k);
  const names = new Map<number, Map<number, string>>();
  for (const r of nm.slice(1)) {
    const id = Number(r[col(nmH, "pokemon_species_id")]), lang = Number(r[col(nmH, "local_language_id")]);
    if (!id) continue;
    if (!names.has(id)) names.set(id, new Map());
    names.get(id)!.set(lang, r[col(nmH, "name")]!);
  }
  const species = sp.slice(1).map((r) => {
    const id = Number(r[col(spH, "id")]);
    const n = names.get(id) ?? new Map<number, string>();
    return {
      id, slug: r[col(spH, "identifier")]!, generation: Number(r[col(spH, "generation_id")]) || null,
      nameEn: n.get(LANG.en) ?? "", nameJa: n.get(LANG.jaHrkt) ?? n.get(LANG.ja) ?? null,
      nameZh: n.get(LANG.zhHans) ?? n.get(LANG.zhHant) ?? null,
      aliasesJa: [n.get(LANG.jaHrkt), n.get(LANG.ja)].filter(Boolean) as string[],
      aliasesZh: [n.get(LANG.zhHans), n.get(LANG.zhHant)].filter(Boolean) as string[],
    };
  }).filter((s) => s.id && s.nameEn);
  console.log(`species: ${species.length}`);

  for (let i = 0; i < species.length; i += 200) {
    const chunk = species.slice(i, i + 200);
    await db.execute(sql`
      insert into pokemon_species (id, slug, name_en, name_ja, name_zh, generation, image_url)
      select * from unnest(
        ${sql.raw(`array[${chunk.map((s) => s.id).join(",")}]::int[]`)},
        ${sql.raw(`array[${chunk.map((s) => `'${s.slug}'`).join(",")}]::text[]`)},
        ${sql.raw(`array[${chunk.map((s) => `'${s.nameEn.replace(/'/g, "''")}'`).join(",")}]::text[]`)},
        ${sql.raw(`array[${chunk.map((s) => (s.nameJa ? `'${s.nameJa.replace(/'/g, "''")}'` : "null")).join(",")}]::text[]`)},
        ${sql.raw(`array[${chunk.map((s) => (s.nameZh ? `'${s.nameZh.replace(/'/g, "''")}'` : "null")).join(",")}]::text[]`)},
        ${sql.raw(`array[${chunk.map((s) => s.generation ?? "null").join(",")}]::int[]`)},
        ${sql.raw(`array[${chunk.map((s) => `'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${s.id}.png'`).join(",")}]::text[]`)}
      )
      on conflict (id) do update set slug = excluded.slug, name_en = excluded.name_en, name_ja = excluded.name_ja,
        name_zh = excluded.name_zh, generation = excluded.generation, image_url = excluded.image_url`);
  }

  // English matcher: normalized n-gram -> species id.
  const enMap = new Map<string, number>();
  for (const s of species) enMap.set(norm(s.nameEn), s.id);
  const maxN = Math.max(...[...enMap.keys()].map((k) => k.split(" ").length));
  const matchEn = (name: string): number[] => {
    const toks = norm(name).split(" ");
    const hits: Hit[] = [];
    for (let i = 0; i < toks.length; i++)
      for (let n = 1; n <= maxN && i + n <= toks.length; n++) {
        const id = enMap.get(toks.slice(i, i + n).join(" "));
        if (id) hits.push({ start: i, len: n, id });
      }
    return pick(hits);
  };
  const nativeAliases = (key: "aliasesJa" | "aliasesZh") =>
    species.flatMap((s) => s[key].map((a) => ({ a, id: s.id }))).sort((x, y) => y.a.length - x.a.length);
  const jaAliases = nativeAliases("aliasesJa"), zhAliases = nativeAliases("aliasesZh");
  const matchNative = (name: string, aliases: { a: string; id: number }[]): number[] => {
    const hits: Hit[] = [];
    for (const { a, id } of aliases) {
      let from = 0;
      while (true) { const i = name.indexOf(a, from); if (i < 0) break; hits.push({ start: i, len: a.length, id }); from = i + 1; }
    }
    return pick(hits);
  };

  await db.execute(sql`truncate card_species`);
  const rows = await db.execute<{ id: string; name: string; name_en: string | null; language: string }>(sql`
    select c.id, c.name, c.external_ids->>'name_en' as name_en, s.language
    from cards c join sets s on s.id = c.set_id join games g on g.id = s.game_id
    where g.slug = 'pokemon'`);
  const list = [...rows];
  const pairs: { c: string; s: number }[] = [];
  let matched = 0;
  const unmatchedSample: string[] = [];
  // Item cards named after a Pokémon (Rotom Dex, Clefairy Doll, "Pikachu on
  // the Ball") are not that Pokémon; the few real patterns are excluded.
  const NOT_A_POKEMON = /\b(dex|bike|phone|doll|on the ball|catcher|illustrator's|mail)$/i;
  for (const c of list) {
    let ids: number[] = [];
    if (NOT_A_POKEMON.test((c.language === "EN" ? c.name : c.name_en ?? "").trim())) continue;
    if (c.language === "EN") ids = matchEn(c.name);
    else if (c.name_en) ids = matchEn(c.name_en);
    if (ids.length === 0 && c.language === "JP") ids = matchNative(c.name, jaAliases);
    if (ids.length === 0 && c.language === "ZH") ids = matchNative(c.name, zhAliases);
    if (ids.length) matched++; else if (unmatchedSample.length < 40 && Math.random() < 0.02) unmatchedSample.push(`${c.language}:${c.name}`);
    for (const s of ids) pairs.push({ c: c.id, s });
  }
  for (let i = 0; i < pairs.length; i += 2000) {
    const chunk = pairs.slice(i, i + 2000);
    await db.execute(sql`
      insert into card_species (card_id, species_id)
      select * from unnest(${sql.raw(`array[${chunk.map((p) => `'${p.c}'`).join(",")}]::uuid[]`)},
                           ${sql.raw(`array[${chunk.map((p) => p.s).join(",")}]::int[]`)})
      on conflict do nothing`);
  }
  console.log(`cards: ${list.length} pokemon cards, ${matched} matched to a species (${(100 * matched / list.length).toFixed(1)}%), ${pairs.length} links`);
  console.log("unmatched sample:", unmatchedSample.join(" | "));
  const top = await db.execute(sql`select ps.name_en, count(*) n from card_species cs join pokemon_species ps on ps.id = cs.species_id group by 1 order by 2 desc limit 8`);
  console.log("top:", [...top].map((r: any) => `${r.name_en} ${r.n}`).join(", "));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
