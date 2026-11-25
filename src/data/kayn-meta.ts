// Win rates de Kayn affichés sur le site : méta collectée par l'appli de bureau (scripts/site-meta.ts), avec leur
// marge d'erreur, plutôt que des chiffres de sites tiers figés à un ancien patch.
import { officialPatch } from "./version";

export interface MetaRow { patch: string; win: number; perks: string | null }
export interface KaynMeta {
  /** Date de génération (AAAA-MM-JJ). */
  generated: string;
  /** Patchs Data Dragon (ex. 16.23) et officiels (ex. 26.23). */
  patches: string[];
  officialPatches: string[];
  games: number;
  wins: number;
  /** Rune principale (keystone) : parties et victoires. */
  keystones: { id: number; name: string; games: number; wins: number }[];
}

const KEYSTONES: Record<number, string> = { 8010: "Conqueror", 8128: "Dark Harvest", 9923: "Hail of Blades", 8112: "Electrocute", 8021: "Fleet Footwork", 8437: "Grasp of the Undying" };


export function buildKaynMeta(rows: MetaRow[], patches: string[], generated: string): KaynMeta {
  const by = new Map<number, { games: number; wins: number }>();
  for (const r of rows) {
    let id: number | null = null;
    try { id = (JSON.parse(r.perks ?? "null") as { selections?: number[] } | null)?.selections?.[0] ?? null; } catch { id = null; }
    if (id == null || !KEYSTONES[id]) continue;
    const e = by.get(id) ?? { games: 0, wins: 0 };
    e.games++; if (r.win) e.wins++;
    by.set(id, e);
  }
  return {
    generated, patches, officialPatches: patches.map(officialPatch),
    games: rows.length, wins: rows.filter((r) => r.win).length,
    keystones: [...by].map(([id, e]) => ({ id, name: KEYSTONES[id], ...e })).sort((a, b) => b.games - a.games),
  };
}

/** Marge à 95 % (Wilson), en points. */
export function wilsonMargin(w: number, n: number): number {
  if (!n) return 100;
  const z = 1.96, p = w / n, d = 1 + z * z / n;
  return ((z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d) * 100;
}

/** « 47,3 % ± 3,3 (869 parties) », ou une mention claire sous 20 parties. */
export function wrText(w: number, n: number): string {
  const nf = (x: number, d = 1) => x.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (n < 20) return `${n} partie${n > 1 ? "s" : ""} : pas de conclusion`;
  return `${nf((w / n) * 100)} % ± ${nf(wilsonMargin(w, n))} (${n.toLocaleString("fr-FR")} parties)`;
}
