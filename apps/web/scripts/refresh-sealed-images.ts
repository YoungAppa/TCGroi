import { getDb, games } from "@/lib/db";
import { refreshSealedImages } from "@/lib/jobs/refresh-catalog";
async function main() {
  const db = getDb();
  const gameIdBySlug = new Map((await db.select().from(games)).map((g) => [g.slug, g.id]));
  const n = await refreshSealedImages(gameIdBySlug);
  console.log(`sealed images updated: ${n}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
