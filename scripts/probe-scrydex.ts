/**
 * Live verification for the Scrydex provider — RUN THIS FIRST when the key
 * arrives, before trusting a single Scrydex number.
 *
 *   TCGPLAYER_MIRROR_API_KEY=... SCRYDEX_TEAM_ID=... npx tsx scripts/probe-scrydex.ts
 * (or put both in .env.local and run: npx tsx --env-file=.env.local scripts/probe-scrydex.ts)
 *
 * It answers the questions the adapter was built on but could not verify:
 *   1. Do our stored pokemontcg_io ids (e.g. "sv8-238") match Scrydex card ids?
 *   2. What does the price object actually look like (raw vs graded, fields)?
 *   3. Does the One Piece path ("onepiece"?) exist, and how do its card ids
 *      relate to collector numbers like OP09-118?
 *   4. What envelope/pagination fields does the API return?
 *   5. Do sealed-product endpoints return market prices we could use?
 *
 * Prints raw JSON excerpts — the point is human eyes on the real shape.
 */
import { getEnv } from "@/lib/env";

const BASE = "https://api.scrydex.com";

async function call(path: string): Promise<{ status: number; body: unknown }> {
  const env = getEnv();
  const key = env.TCGPLAYER_MIRROR_API_KEY;
  const teamId = env.SCRYDEX_TEAM_ID;
  if (!key || !teamId) {
    throw new Error("Set TCGPLAYER_MIRROR_API_KEY and SCRYDEX_TEAM_ID first.");
  }

  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-Api-Key": key, "X-Team-ID": teamId, accept: "application/json" },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text().catch(() => null);
  }
  return { status: res.status, body };
}

function excerpt(v: unknown, len = 1600): string {
  return JSON.stringify(v, null, 1)?.slice(0, len) ?? String(v);
}

async function main() {
  console.log("=== 1. account usage (auth sanity + credit visibility) ===");
  const usage = await call("/account/v1/usage");
  console.log(`  HTTP ${usage.status}`);
  console.log(excerpt(usage.body, 600));

  console.log("\n=== 2. pokemon card by known id (id-parity check: sv8-238 = Pikachu ex SIR) ===");
  const known = await call("/pokemon/v1/cards/sv8-238?include=prices");
  console.log(`  HTTP ${known.status}`);
  console.log(excerpt(known.body));
  console.log(
    "  ^ If this 404s, id parity with pokemontcg_io does NOT hold and the adapter's matching must switch to number-based.",
  );

  console.log("\n=== 3. pokemon expansion cards page (envelope + pagination) ===");
  const page = await call("/pokemon/v1/expansions/sv8/cards?include=prices&pageSize=3");
  console.log(`  HTTP ${page.status}`);
  console.log(excerpt(page.body, 2200));

  console.log("\n=== 4. one piece: path + a card (does 'onepiece' exist? id shape?) ===");
  for (const path of ["onepiece", "one-piece", "op"]) {
    const r = await call(`/${path}/v1/expansions?pageSize=2`);
    console.log(`  /${path}/v1/expansions -> HTTP ${r.status}`);
    if (r.status === 200) {
      console.log(excerpt(r.body, 1200));
      break;
    }
  }

  console.log("\n=== 5. sealed products (the upgrade that retires hand-tracked market prices) ===");
  const sealed = await call("/pokemon/v1/sealed?include=prices&pageSize=2");
  console.log(`  HTTP ${sealed.status}`);
  console.log(excerpt(sealed.body, 1600));

  console.log(
    "\nNext: compare the price objects above against extractRawMarket() in scrydex-prices.ts, fix any mismatch, then set TCGPLAYER_MIRROR_PROVIDER=scrydex and run refresh-prices.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("probe failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
