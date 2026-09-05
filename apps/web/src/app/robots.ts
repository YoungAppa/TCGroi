import type { MetadataRoute } from "next";
import { SITE_URL as BASE } from "@/lib/site";



export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Nothing in /admin or the APIs is for crawlers.
        disallow: ["/admin", "/api/"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
