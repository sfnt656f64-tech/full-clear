// Analyse d'après-partie : ta partie comparée aux joueurs Émeraude+ sur le même champion et le même rôle,
// et les points à travailler sur tes dernières parties. Fonctions pures. Uniquement tes parties et une méta
// anonyme : aucun nom de joueur.

import { gameRank, sameSeason, type MetaRef } from "./overview.ts";

export interface AnalysisGame {
  matchId: string; account: string; startMs: number; durationS: number; patch: string; season?: number;
  championId: number; role: string; win: boolean; kills: number; deaths: number; assists: number; cs: number;
  gold15: number | null; cs15: number | null; cs10: number | null;
  teamKills: number | null; kills15: number | null; assists15: number | null; teamKills15: number | null;
  objTeam: number | null; objMine: number | null; deaths15: number;
  /** Tes dégâts aux champions et ceux de ton équipe (v7), null si pas encore relus. */
  damage?: number | null; teamDamage?: number | null;
  /** Mesures de ton adversaire direct (même rôle, même partie) : référence des saisons sans méta. */
  opp?: Values | null;
}
export interface AnalysisGame extends DuelValues {}
export interface MyEventRow { t: number; kind: "kill" | "death" | "assist"; x: number; y: number; otherChamp: number }
export interface MetaMetricRow extends DuelValues {
  /** Partie et participant (jointure avec les chronologies de méta). */
  matchId?: string; participantId?: number;
  championId: number; win: boolean; cs10: number | null; cs15: number | null; gold15: number | null; deaths15: number | null;
  kills15: number | null; assists15: number | null; teamKills15: number | null; objTeam: number | null; objMine: number | null;
  /** Toute la partie (participation après 15 min, morts par 10 min, part des dégâts). */
  kills?: number; assists?: number; teamKills?: number | null;
  deaths?: number; durationS?: number; damage?: number | null; teamDamage?: number | null;
}

/** Mesures tirées de la chronologie, face au jungler (ou adversaire direct) de l'autre équipe. */
export interface DuelValues {
  /** Écarts d'or et d'XP avec ton adversaire direct à 10 min, d'or à 15 min. */
  gd10?: number | null; xd10?: number | null; gd15?: number | null;
  /** Participation au first blood (1 oui, 0 non). */
  fb?: number | null;
  /** Morts sans aucun allié adverse en assistance (1 contre 1) avant 15 min. */
  solo15?: number | null;
  /** Objectifs neutres avant 20 min (dragons, larves, héraut) : part prise par ton équipe (%), et nombre cédés sans contrepartie. */
  obj15?: number | null; unc15?: number | null;
}

export type Values = Pick<AnalysisGame, "cs10" | "cs15" | "gold15" | "kills15" | "assists15" | "teamKills15" | "objTeam" | "objMine"> & DuelValues & {
  deaths15: number | null; kills?: number; assists?: number; teamKills?: number | null;
  deaths?: number; durationS?: number; damage?: number | null; teamDamage?: number | null;
};

export interface Metric {
  key: string;
  label: string;
  /** « + » : plus c'est haut, mieux c'est ; « - » : l'inverse (morts). */
  better: "+" | "-";
  /** Groupe de la répartition farm / kills / objectifs (ou aucun). */
  group: "farm" | "kills" | "objectives" | null;
  unit: string;
  value: (v: Values) => number | null;
}

export const METRICS: Metric[] = [
  { key: "cs10", label: "CS à 10 min", better: "+", group: null, unit: "", value: (v) => v.cs10 },
  { key: "cs15", label: "CS à 15 min", better: "+", group: "farm", unit: "", value: (v) => v.cs15 },
  { key: "gold15", label: "Or à 15 min", better: "+", group: null, unit: "", value: (v) => v.gold15 },
  { key: "kp15", label: "Participation aux kills avant 15 min", better: "+", group: "kills", unit: " %",
    value: (v) => (v.teamKills15 && v.kills15 != null && v.assists15 != null ? ((v.kills15 + v.assists15) / v.teamKills15) * 100 : null) },
  { key: "kpLate", label: "Participation aux kills après 15 min", better: "+", group: "kills", unit: " %",
    value: (v) => {
      if (v.kills == null || v.assists == null || v.teamKills == null || v.kills15 == null || v.assists15 == null || v.teamKills15 == null) return null;
      const team = v.teamKills - v.teamKills15;
      return team > 0 ? ((v.kills + v.assists - v.kills15 - v.assists15) / team) * 100 : null;
    } },
  { key: "obj", label: "Participation aux objectifs", better: "+", group: "objectives", unit: " %",
    value: (v) => (v.objTeam && v.objMine != null ? (v.objMine / v.objTeam) * 100 : null) },
  { key: "deaths15", label: "Morts avant 15 min", better: "-", group: null, unit: "", value: (v) => v.deaths15 },
  { key: "deathsPer10", label: "Morts par 10 min", better: "-", group: null, unit: "",
    value: (v) => (v.deaths != null && v.durationS ? (v.deaths / v.durationS) * 600 : null) },
  { key: "dmgShare", label: "Part des dégâts de l'équipe", better: "+", group: null, unit: " %",
    value: (v) => (v.damage != null && v.teamDamage ? (v.damage / v.teamDamage) * 100 : null) },
  { key: "gd10", label: "Écart d'or à 10 min", better: "+", group: null, unit: "", value: (v) => v.gd10 ?? null },
  { key: "xd10", label: "Écart d'XP à 10 min", better: "+", group: null, unit: "", value: (v) => v.xd10 ?? null },
  { key: "fb", label: "Participation au first blood", better: "+", group: null, unit: " %", value: (v) => (v.fb == null ? null : v.fb * 100) },
  { key: "gd15", label: "Écart d'or à 15 min", better: "+", group: null, unit: "", value: (v) => v.gd15 ?? null },
  { key: "solo15", label: "Morts en 1 contre 1 avant 15 min", better: "-", group: null, unit: "", value: (v) => v.solo15 ?? null },
  { key: "obj15", label: "Objectifs neutres avant 15 min pris par ton équipe", better: "+", group: null, unit: " %", value: (v) => v.obj15 ?? null },
  { key: "unc15", label: "Objectifs cédés avant 15 min sans contrepartie", better: "-", group: null, unit: " %", value: (v) => v.unc15 ?? null },
];

/** Parties de méta minimales sur ton champion pour s'y comparer (sinon : tout le rôle). */
export const MIN_META_CHAMP = 30;
/** Parties récentes utilisées pour les points à travailler et leur évolution. */
export const FOCUS_GAMES = 10;

export interface MetricCompare {
  key: string;
  label: string;
  unit: string;
  better: "+" | "-";
  mine: number | null;
  median: number | null;
  /** Ta position parmi les joueurs Émeraude+ (0–100, 100 = meilleur), dans le sens du « mieux ». */
  rank: number | null;
}

export interface FocusPoint {
  key: string;
  label: string;
  unit: string;
  /** Ta moyenne récente et la médiane Émeraude+. */
  mine: number;
  median: number;
  rank: number;
  /** Tes valeurs, de la plus ancienne à la plus récente. */
  trend: number[];
  /** Évolution : moyenne de la 2ᵉ moitié moins celle de la 1ʳᵉ (dans le sens du « mieux » : > 0 = progrès). */
  progress: number | null;
  text: string;
}

export interface GameAnalysis {
  game: AnalysisGame;
  events: MyEventRow[];
  metrics: MetricCompare[];
  /**
   * Référence : méta Émeraude+ de la même saison sur ton champion (ou tout le rôle si trop peu de parties), ou ton
   * adversaire direct de la même partie pour une saison sans méta. Dans ce cas, « median » est sa valeur.
   */
  comparedTo: "champion" | "role" | "opponent";
  metaGames: number;
  focus: FocusPoint[];
  /** Parties (même champion et rôle, sinon même rôle) utilisées pour les points à travailler. */
  focusGames: number;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
const fmt = (n: number, unit: string) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: unit === " %" || n >= 100 ? 0 : 1 })}${unit}`;

export function analyseGame(game: AnalysisGame, events: MyEventRow[], recent: AnalysisGame[], ref: MetaRef, refName = "Émeraude"): GameAnalysis {
  const current = sameSeason(game, ref);
  const { rows, champion } = ref.rowsFor(game.role, game.championId);

  const metrics: MetricCompare[] = METRICS.map((m) => {
    const mine = m.value(game);
    const r = gameRank(m, game, ref, game.championId).rank;
    // Médiane Émeraude+ (même saison) ; sinon la valeur de ton adversaire direct.
    const refValue = current ? median(ref.sorted(m, game.role, game.championId)) : game.opp ? m.value(game.opp) : null;
    return { key: m.key, label: m.label, unit: m.unit, better: m.better, mine, median: refValue, rank: r };
  });

  // Points à travailler : tes dernières parties sur ce champion dans ce rôle (sinon dans ce rôle), chacune comparée
  // à la référence de sa saison.
  const champGames = recent.filter((g) => g.championId === game.championId && g.role === game.role);
  const pool = (champGames.length >= 5 ? champGames : recent.filter((g) => g.role === game.role)).slice(0, FOCUS_GAMES).reverse();
  const poolMeta = pool.every((g) => sameSeason(g, ref));
  const focus: FocusPoint[] = [];
  for (const m of METRICS) {
    const vals = pool.map((g) => m.value(g)).filter((x): x is number => x != null);
    const ranks = pool.map((g) => gameRank(m, g, ref, game.championId).rank).filter((x): x is number => x != null);
    if (vals.length < 3 || ranks.length < 3) continue;
    const mine = mean(vals);
    const rank = mean(ranks);
    if (rank >= 40) continue;
    const refVals = poolMeta ? ref.sorted(m, game.role, game.championId) : pool.map((g) => (g.opp ? m.value(g.opp) : null)).filter((x): x is number => x != null);
    const med = poolMeta ? median(refVals) : refVals.length ? mean(refVals) : null;
    if (med == null) continue;
    const half = Math.floor(vals.length / 2);
    const progress = vals.length >= 4 ? (mean(vals.slice(half)) - mean(vals.slice(0, half))) * (m.better === "+" ? 1 : -1) : null;
    const trendText = progress == null ? "" : Math.abs(progress) < 0.05 * Math.max(1, Math.abs(med)) ? " Stable sur tes dernières parties." : progress > 0 ? " En progrès sur tes dernières parties." : " En recul sur tes dernières parties.";
    focus.push({
      key: m.key, label: m.label, unit: m.unit, mine, median: med, rank, trend: vals, progress,
      text: poolMeta
        ? `${m.label} : ${fmt(mine, m.unit)} en moyenne, contre ${fmt(med, m.unit)} en ${refName} (mieux que ${Math.round(rank)} % des joueurs).${trendText}`
        : `${m.label} : ${fmt(mine, m.unit)} en moyenne, contre ${fmt(med, m.unit)} pour ton adversaire direct (mieux que lui dans ${Math.round(rank)} % des parties).${trendText}`,
    });
  }
  focus.sort((x, y) => x.rank - y.rank);

  return {
    game, events, metrics,
    comparedTo: !current ? "opponent" : champion ? "champion" : "role",
    metaGames: current ? rows.length : 0,
    focus: focus.slice(0, 3),
    focusGames: pool.length,
  };
}
