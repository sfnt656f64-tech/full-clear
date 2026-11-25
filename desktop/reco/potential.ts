// Classement par potentiel (Champions recommandés), par rôle. S'appuie d'abord sur les stats de jeu (radar :
// moyenne des 6 axes, 50 = médiane Émeraude+), plus stables que le win rate sur peu de parties. Fonctions pures.
import { radarHighlights, type Radar } from "../analysis/radar.ts";
import type { PoolPick } from "./recommend.ts";

/** Seuils (réglables). */
export const KEEP_GAMES = 15;
export const KEEP_WR = 51;
export const KEEP_STATS = 50;
export const POTENTIAL_STATS = 55;
export const SHELVE_GAMES = 20;
export const SHELVE_STATS = 50;
export const SHELVE_WR = 50;

export type PotentialGroup = "keep" | "potential" | "neutral" | "shelve";
/** Assez de parties pour juger un champion autour de la médiane (sinon « potentiel à confirmer »). */
export const NEUTRAL_GAMES = 20;

export interface PotentialEntry {
  championId: number;
  group: PotentialGroup;
  games: number;
  /** Win rate lissé (pool), ou brut pour un champion encore hors du pool. */
  winRate: number | null;
  radar: Radar | null;
  text: string;
  /** Pas de radar (moins de 5 parties relues) ou peu de parties : à confirmer. */
  provisional: boolean;
  /** Score du pool (tri dans le groupe), null hors pool. */
  score: number | null;
}

export interface TriedChampion { championId: number; games: number; wins: number }

const nf = (n: number) => Math.round(n).toLocaleString("fr-FR");
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} et ${xs.at(-1)}`);

/** Classe un champion du pool (au moins 10 parties dans le rôle). */
export function classifyPool(p: PoolPick, radar: Radar | null): PotentialEntry {
  const wr = p.adjustedWinRate, g = p.games, s = radar?.score ?? null;
  const h = radar ? radarHighlights(radar) : { strong: [], weak: [] };
  const wrText = `${nf(wr)} % de victoires (lissé) sur ${g} parties`;
  const strong = h.strong.length ? `${list(h.strong)} au-dessus de 65 % des joueurs` : "";
  const weak = h.weak.length ? ` (${list(h.weak)})` : "";
  const base = { championId: p.championId, games: g, winRate: wr, radar, score: p.score };

  if (s == null) {
    // Pas encore de radar : classement provisoire sur le win rate.
    const group: PotentialGroup = g >= KEEP_GAMES && wr >= KEEP_WR ? "keep" : g >= SHELVE_GAMES && wr < SHELVE_WR ? "shelve" : "potential";
    return { ...base, group, provisional: true, text: `${wrText}. Stats de jeu pas encore disponibles (parties en cours de relecture) : classement provisoire.` };
  }
  if (g >= KEEP_GAMES && wr >= KEEP_WR && s >= KEEP_STATS) {
    return { ...base, group: "keep", provisional: false, text: `${strong ? `${strong}, ` : "Stats au-dessus de la médiane, "}${wrText} : à garder.` };
  }
  if (g >= KEEP_GAMES && wr >= KEEP_WR) {
    return { ...base, group: "keep", provisional: false, text: `Tu gagnes (${wrText}), mais tes stats sont sous la médiane${weak} : à consolider.` };
  }
  if (s >= POTENTIAL_STATS) {
    return { ...base, group: "potential", provisional: g < NEUTRAL_GAMES, text: `${strong || "Stats nettement au-dessus de la médiane"}, mais ${wrText} : potentiel à développer.` };
  }
  if (g >= SHELVE_GAMES && s < SHELVE_STATS && wr < SHELVE_WR) {
    return { ...base, group: "shelve", provisional: false, text: `Stats sous la médiane${weak} et ${wrText} : à mettre de côté.` };
  }
  // Stats autour de la médiane (50 à 55) : avec assez de parties, rien de caché à développer.
  if (s >= SHELVE_STATS && g >= NEUTRAL_GAMES) {
    return { ...base, group: "neutral", provisional: false, text: `Stats autour de la médiane et ${wrText} : neutre, pas prioritaire.` };
  }
  if (s >= SHELVE_STATS) {
    return { ...base, group: "potential", provisional: true, text: `Stats autour de la médiane${strong ? ` (${strong})` : ""} et ${wrText} : potentiel à confirmer (moins de ${NEUTRAL_GAMES} parties).` };
  }
  return { ...base, group: "shelve", provisional: true, text: `Stats sous la médiane${weak}, mais encore peu de parties (${g}) : à mettre de côté pour l'instant.` };
}

/** Champion joué 5 à 9 fois (hors pool) : « Potentiel à développer » seulement avec de très bonnes stats. */
export function classifyTried(t: TriedChampion, radar: Radar | null): PotentialEntry | null {
  if (!radar?.score || radar.score < POTENTIAL_STATS) return null;
  const h = radarHighlights(radar);
  return {
    championId: t.championId, group: "potential", games: t.games, winRate: (t.wins / t.games) * 100, radar, score: null, provisional: true,
    text: `${h.strong.length ? `${list(h.strong)} au-dessus de 65 % des joueurs` : "Stats nettement au-dessus de la médiane"} sur seulement ${t.games} parties (${t.wins} victoire${t.wins > 1 ? "s" : ""}) : potentiel à développer.`,
  };
}

export interface PotentialGroups { keep: PotentialEntry[]; potential: PotentialEntry[]; neutral: PotentialEntry[]; shelve: PotentialEntry[] }

export function potentialGroups(pool: PoolPick[], tried: TriedChampion[], radars: Map<number, Radar | null>): PotentialGroups {
  const entries = [
    ...pool.map((p) => classifyPool(p, radars.get(p.championId) ?? null)),
    ...tried.flatMap((t) => { const e = classifyTried(t, radars.get(t.championId) ?? null); return e ? [e] : []; }),
  ];
  const by = (g: PotentialGroup) => entries.filter((e) => e.group === g)
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || (b.radar?.score ?? 0) - (a.radar?.score ?? 0));
  return { keep: by("keep"), potential: by("potential"), neutral: by("neutral"), shelve: by("shelve") };
}
