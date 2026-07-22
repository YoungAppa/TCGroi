/**
 * Standalone runner for the sealed-product photo step of refresh-catalog:
 * fills sealed_products.image_url from Scrydex for every set that has sealed
 * products, both games. Safe to re-run; no-op without Scrydex credentials.
 *
 *   npx tsx --env-file=.env.local scripts/refresh-sealed-images.ts
 */
import { refreshSealedImages } from "@/lib/jobs/refresh-catalog";

async function main() {
  const n = await refreshSealedImages();
  console.log(`sealed images updated: ${n}`);
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
