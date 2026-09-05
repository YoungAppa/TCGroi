"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { SpeciesSummary } from "@/lib/data/species";

export type PokedexTile = Pick<SpeciesSummary, "id" | "slug" | "nameEn" | "nameJa" | "nameZh" | "generation" | "cardCount" | "topPriceCents">;
const art = (id: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
import { formatCents } from "@packroi/ev/format";

const GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * The Pokédex grid: all 1,025 species, national-dex order, filtered live by
 * name in any language or by dex number. Species with no card in the catalog
 * stay visible (so the list is honestly complete) but don't link anywhere.
 */
export function PokedexGrid({ species }: { species: PokedexTile[] }) {
  const [q, setQ] = useState("");
  const [gen, setGen] = useState<number | null>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return species.filter((s) => {
      if (gen !== null && s.generation !== gen) return false;
      if (!needle) return true;
      return (
        s.nameEn.toLowerCase().includes(needle) ||
        (s.nameJa ?? "").includes(q.trim()) ||
        (s.nameZh ?? "").includes(q.trim()) ||
        String(s.id) === needle.replace(/^#0*/, "")
      );
    });
  }, [species, q, gen]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a Pokémon — Pikachu, ピカチュウ, 皮卡丘, #25"
          aria-label="Search Pokémon"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent sm:w-80"
        />
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setGen(null)}
            className={`rounded-full border px-2.5 py-1 text-xs ${gen === null ? "border-accent text-foreground" : "border-border text-muted hover:text-foreground"}`}
          >
            All
          </button>
          {GENS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGen(gen === g ? null : g)}
              className={`rounded-full border px-2.5 py-1 text-xs ${gen === g ? "border-accent text-foreground" : "border-border text-muted hover:text-foreground"}`}
            >
              Gen {g}
            </button>
          ))}
        </div>
        <span className="tabular ml-auto text-xs text-muted">
          {shown.length.toLocaleString()} of {species.length.toLocaleString()} Pokémon
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {shown.map((s) => {
          const inner = (
            <>
              <img src={art(s.id)} alt="" loading="lazy" decoding="async" className="mx-auto h-20 w-20 object-contain" />
              <span className="tabular block text-[10px] text-muted">#{String(s.id).padStart(4, "0")}</span>
              <span className="block truncate text-sm font-medium text-foreground">{s.nameEn}</span>
              <span className="tabular block text-[11px] text-muted">
                {s.cardCount > 0 ? `${s.cardCount.toLocaleString()} card${s.cardCount === 1 ? "" : "s"}` : "no cards yet"}
                {s.topPriceCents !== null && s.topPriceCents > 0 ? ` · top ${formatCents(s.topPriceCents)}` : ""}
              </span>
            </>
          );
          const cls = "rounded-lg border border-border bg-surface p-2 text-center";
          return s.cardCount > 0 ? (
            <Link key={s.id} href={`/pokedex/${s.slug}`} className={`${cls} hover:border-accent/50`}>
              {inner}
            </Link>
          ) : (
            <div key={s.id} className={`${cls} opacity-50`}>
              {inner}
            </div>
          );
        })}
      </div>
      {shown.length === 0 && <p className="text-sm text-muted">No Pokémon matches that.</p>}
    </div>
  );
}
