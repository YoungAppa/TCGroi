import type { Metadata } from "next";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import Link from "next/link";

import { SiteBanner, SiteFooter, SiteNav } from "@/components/SiteChrome";
import { I18nProvider } from "@/lib/i18n/context";
import { MoneyProvider } from "@/lib/money/context";
import { fetchFxRates } from "@/lib/money/rates";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Display face: the brand mark and page headlines only. Geist still carries
// every paragraph and every table cell.
const sora = Sora({ variable: "--font-sora", subsets: ["latin"], weight: ["600", "700", "800"] });

// Same fallback the robots/sitemap routes use; set NEXT_PUBLIC_SITE_URL at deploy.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://whatsthatroi.com";

const TITLE = "WhatsThatROI — TCG pack & box expected value";
const DESCRIPTION =
  "Expected value and ROI for sealed Pokémon (EN/JP/中文), One Piece and Magic products, from measured pull rates and live market prices — each set badged by how well-evidenced its odds are. Opening sealed product is almost always -EV; this site shows exactly how much.";

export const metadata: Metadata = {
  // Resolves relative OG images and per-page canonical URLs against the site
  // origin — without it, shared links carry no absolute image/URL.
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · WhatsThatROI",
  },
  description: DESCRIPTION,
  applicationName: "WhatsThatROI",
  openGraph: {
    type: "website",
    siteName: "WhatsThatROI",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Fetched on the server so the browser makes no third-party request and the
  // page's CSP stays clean. An empty table simply leaves every price in USD.
  const fxRates = await fetchFxRates();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider>
        <MoneyProvider rates={fxRates}>
        <header className="border-b border-border bg-surface">
          {/* Wraps rather than overflows: at 375px the old single row pushed the
              language and currency selects off-screen entirely, making them
              unreachable on a phone. */}
          <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="group flex items-center gap-2">
              {/* The mark carries the thesis: open the pack, the value goes down. */}
              <span
                aria-hidden
                className="inline-grid h-7 w-7 place-items-center rounded-lg border border-accent/40 bg-accent/10 text-[13px] font-black leading-none text-accent"
              >
                ↓
              </span>
              {/* "ROI" carries the foil — the only place in the chrome that
                  spends the holo gradient. */}
              <span className="font-display text-lg font-extrabold tracking-tight">
                whatsthat<span className="holo-text">ROI</span>
              </span>
            </Link>
            <SiteNav />
          </nav>
        </header>

        <SiteBanner />

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>

        <SiteFooter />
        </MoneyProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
