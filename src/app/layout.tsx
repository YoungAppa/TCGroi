import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "PACKROI — TCG pack & box expected value",
    template: "%s · PACKROI",
  },
  description:
    "Expected value and ROI for sealed Pokémon and One Piece TCG products, from community pull rates and live market prices. Opening sealed product is almost always -EV; this site shows exactly how much.",
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
              PACK<span className="text-accent">ROI</span>
            </Link>
            <div className="flex gap-4 text-sm text-muted">
              <Link href="/" className="hover:text-foreground">
                Rankings
              </Link>
              <Link href="/methodology" className="hover:text-foreground">
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
              Market price data via a third-party TCGplayer mirror
              (pokemontcg.io). Not endorsed by or affiliated with TCGplayer or
              The Pokémon Company.
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
