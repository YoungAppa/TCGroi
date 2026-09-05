/**
 * The site's canonical origin. ONE definition, because every absolute URL we
 * emit — canonicals, sitemap entries, JSON-LD, Open Graph — must agree with
 * the host Vercel actually serves. The apex 308-redirects to www, so www is
 * canonical; a sitemap full of apex URLs is a sitemap full of redirects, which
 * search engines index poorly (that was the live state until 2026-09-06).
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.whatsthatroi.com").replace(/\/$/, "");
