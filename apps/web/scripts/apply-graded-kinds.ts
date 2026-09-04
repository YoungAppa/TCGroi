import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  await sql.unsafe("ALTER TYPE price_kind ADD VALUE IF NOT EXISTS 'cgc10'");
  await sql.unsafe("ALTER TYPE price_kind ADD VALUE IF NOT EXISTS 'tag10'");
  const r = await sql.unsafe("select unnest(enum_range(NULL::price_kind))::text as v");
  console.log("kinds now:", r.map((x: any) => x.v).join(","));
  await sql.end();
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
