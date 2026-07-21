import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Same fallback the robots/sitemap routes use; set NEXT_PUBLIC_SITE_URL at deploy.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://packroi.vercel.app";

const TITLE = "TCGROI — TCG pack & box expected value";
const DESCRIPTION =
  "Expected value and ROI for sealed Pokémon and One Piece TCG products, from community pull rates and live market prices. Opening sealed product is almost always -EV; this site shows exactly how much.";

export const metadata: Metadata = {
  // Resolves relative OG images and per-page canonical URLs against the site
  // origin — without it, shared links carry no absolute image/URL.
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · TCGROI",
  },
  description: DESCRIPTION,
  applicationName: "TCGROI",
  openGraph: {
    type: "website",
    siteName: "TCGROI",
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border bg-surface">
          <nav className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              TCG<span className="text-accent">ROI</span>
            </Link>
            {/* -my-2 py-2 grows the tap target to ~40px (WCAG 2.5.8) without
                changing the header's visual height. */}
            <div className="flex items-center gap-2 text-sm text-muted">
              <Link
                href="/"
                className="-my-2 inline-flex items-center px-2 py-2 hover:text-foreground"
              >
                Rankings
              </Link>
              <Link
                href="/methodology"
                className="-my-2 inline-flex items-center px-2 py-2 hover:text-foreground"
              >
                Methodology
              </Link>
            </div>
          </nav>
        </header>

        {/* The honest banner is not decoration; it is the site's thesis. */}
        <div className="border-b border-border bg-surface-raised">
          <p className="mx-auto max-w-7xl px-4 py-2 text-xs text-muted">
            Opening sealed product is almost always{" "}
            <span className="font-semibold text-roi-neg">−EV</span>. This site
            exists to show you exactly how much. Pull rates are community
            estimates, never official odds.
          </p>
        </div>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>

        <footer className="border-t border-border bg-surface">
          <div className="mx-auto max-w-7xl space-y-1 px-4 py-4 text-xs text-muted">
            <p>
              Card and price data via the{" "}
              <a
                href="https://pokemontcg.io"
                className="underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                pokemontcg.io
              </a>{" "}
              API, PriceCharting, and PokemonPriceTracker. Not endorsed by or
              affiliated with any of them, nor with TCGplayer, eBay, PSA, The
              Pokémon Company, or Bandai.
            </p>
            <p>
              Not financial or gambling advice. Estimates carry real error —
              see <Link href="/methodology" className="underline">methodology</Link>.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
