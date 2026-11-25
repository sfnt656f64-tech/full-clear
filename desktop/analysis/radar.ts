// Radar à 6 axes (Farm, Early, Teamfight, Objectifs, Survie, Or), calculé partie par partie puis moyenné :
// - partie de la saison de la méta : position « mieux que X % » face aux joueurs Émeraude+ du même rôle ;
// - partie d'une saison précédente : face à ton adversaire direct de la même partie (part des parties où tu fais
//   mieux que lui).
// 50 = la référence sur chaque axe (hexagone régulier). Fonctions pures.
import { METRICS, type AnalysisGame } from "./analysis.ts";
import { gameRank, type MetaRef } from "./overview.ts";

export interface RadarAxis {
  key: string;
  label: string;
  /** Mesures combinées (moyenne de leurs positions). */
  metrics: string[];
  hint: string;
}

export const AXES: RadarAxis[] = [
  { key: "farm", label: "Farm", metrics: ["cs10", "cs15"], hint: "CS à 10 et 15 min" },
  { key: "early", label: "Early", metrics: ["kp15"], hint: "participation aux kills avant 15 min" },
  { key: "teamfight", label: "Teamfight", metrics: ["kpLate", "dmgShare"], hint: "participation aux kills après 15 min, part des dégâts" },
  { key: "objectives", label: "Objectifs", metrics: ["obj"], hint: "participation aux objectifs" },
  { key: "survival", label: "Survie", metrics: ["deaths15", "deathsPer10"], hint: "morts avant 15 min et par 10 min" },
  { key: "gold", label: "Or", metrics: ["gold15"], hint: "or à 15 min" },
];

/** Parties relues minimales pour tracer un radar. */
export const MIN_RADAR_GAMES = 5;

export interface Radar {
  /** Valeur de chaque axe (0–100, 50 = médiane Émeraude+), même ordre que AXES ; null si pas de donnée. */
  values: (number | null)[];
  /** Parties utilisées. */
  games: number;
  /** Moyenne des axes connus (50 = médiane) : les « stats de jeu ». */
  score: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

/** Radar de tes parties (chaque partie comparée à son rôle) ; null sous MIN_RADAR_GAMES parties. */
export function radarOf(games: AnalysisGame[], ref: MetaRef, minGames = MIN_RADAR_GAMES): Radar | null {
  if (games.length < minGames) return null;
  const byKey = new Map(METRICS.map((m) => [m.key, m]));
  const values = AXES.map((axis) => {
    const perGame: number[] = [];
    for (const g of games) {
      const ranks = axis.metrics.flatMap((k) => {
        // Même saison que la méta : position parmi les joueurs Émeraude+ ; sinon : face à ton adversaire direct.
        const r = gameRank(byKey.get(k)!, g, ref, null).rank;
        return r == null ? [] : [r];
      });
      const r = mean(ranks);
      if (r != null) perGame.push(r);
    }
    return mean(perGame);
  });
  const known = values.filter((v): v is number => v != null);
  return { values, games: games.length, score: known.length >= 3 ? mean(known) : null };
}

/** Axes au-dessus de `hi` et en dessous de `lo` (pour les phrases d'explication). */
export function radarHighlights(r: Radar, hi = 65, lo = 35): { strong: string[]; weak: string[] } {
  const strong: string[] = [], weak: string[] = [];
  r.values.forEach((v, i) => {
    if (v == null) return;
    if (v >= hi) strong.push(AXES[i].label);
    if (v <= lo) weak.push(AXES[i].label);
  });
  return { strong, weak };
}
