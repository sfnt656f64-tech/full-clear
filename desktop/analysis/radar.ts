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

// Définitions vérifiées sur tes parties (stabilité, lien avec la victoire, comparaison au jungler adverse) :
// - Early : la participation aux kills seule ne disait rien (aucun lien avec la victoire, très bruitée) ; on y ajoute
//   les écarts d'or et d'XP à 10 min et le first blood.
// - Objectifs : la participation aux objectifs (≈ 95 % pour tout le monde) ne distinguait personne ; on mesure la part
//   des objectifs neutres pris par ton équipe avant 20 min et ceux cédés sans contrepartie. Mesure d'équipe : dépend
//   aussi de tes coéquipiers et de l'avance de la partie.
// - Survie : les morts par 10 min sur toute la partie suivaient l'issue (on meurt plus dans une partie perdue) ; on garde
//   les morts avant 15 min et on ajoute les morts en 1 contre 1 avant 15 min.
// - Or : l'or brut dépend du rythme de la partie ; l'écart d'or avec ton adversaire direct à 15 min, non.
// - Teamfight : mesuré sur toute la partie, il suit en partie l'issue (signalé dans l'aide).
export const AXES: RadarAxis[] = [
  { key: "farm", label: "Farm", metrics: ["cs10", "cs15"], hint: "CS à 10 et 15 min" },
  { key: "early", label: "Early", metrics: ["kp15", "gd10", "xd10", "fb"], hint: "participation aux kills avant 15 min, écarts d'or et d'XP à 10 min, first blood" },
  { key: "teamfight", label: "Teamfight", metrics: ["kpLate", "dmgShare"], hint: "participation aux kills après 15 min, part des dégâts (toute la partie : suit en partie l'issue)" },
  { key: "objectives", label: "Objectifs", metrics: ["obj20", "conc20"], hint: "objectifs neutres avant 20 min pris par ton équipe, cédés sans contrepartie (mesure d'équipe)" },
  { key: "survival", label: "Survie", metrics: ["deaths15", "solo15"], hint: "morts avant 15 min, dont en 1 contre 1" },
  { key: "gold", label: "Or", metrics: ["gd15"], hint: "écart d'or avec ton adversaire direct à 15 min" },
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
  /** Marge d'erreur à 95 % du score (écart-type du score partie par partie / √parties), null sous 2 parties. */
  margin: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

/** Radar de tes parties (chaque partie comparée à son rôle) ; null sous MIN_RADAR_GAMES parties. */
export function radarOf(games: AnalysisGame[], ref: MetaRef, minGames = MIN_RADAR_GAMES): Radar | null {
  if (games.length < minGames) return null;
  const byKey = new Map(METRICS.map((m) => [m.key, m]));
  // Position de chaque partie sur chaque axe. Même saison que la méta : parmi les joueurs Émeraude+ ; sinon : face à
  // ton adversaire direct.
  const grid = games.map((g) => AXES.map((axis) => mean(axis.metrics.flatMap((k) => {
    const r = gameRank(byKey.get(k)!, g, ref, null).rank;
    return r == null ? [] : [r];
  }))));
  const values = AXES.map((_, i) => mean(grid.flatMap((row) => (row[i] == null ? [] : [row[i]!]))));
  const known = values.filter((v): v is number => v != null);
  // Score de chaque partie (moyenne de ses axes connus) : sert à la marge d'erreur du score.
  const perGame = grid.flatMap((row) => { const v = row.filter((x): x is number => x != null); return v.length >= 3 ? [mean(v)!] : []; });
  let margin: number | null = null;
  if (perGame.length >= 2) {
    const m = mean(perGame)!;
    const sd = Math.sqrt(perGame.reduce((s, v) => s + (v - m) ** 2, 0) / (perGame.length - 1));
    margin = (1.96 * sd) / Math.sqrt(perGame.length);
  }
  return { values, games: games.length, score: known.length >= 3 ? mean(known) : null, margin };
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
