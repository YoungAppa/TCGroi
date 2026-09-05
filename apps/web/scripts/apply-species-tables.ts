import { readFileSync } from "node:fs";
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await sql.unsafe(readFileSync("drizzle/0012_pokemon_species.sql", "utf8"));
  const r = await sql.unsafe("select to_regclass('pokemon_species') as a, to_regclass('card_species') as b");
  console.log("tables:", JSON.stringify(r[0]));
  await sql.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
