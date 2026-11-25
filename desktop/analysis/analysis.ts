// Analyse d'après-partie : ta partie comparée aux joueurs Émeraude+ sur le même champion et le même rôle,
// et les points à travailler sur tes dernières parties. Fonctions pures. Uniquement tes parties et une méta
// anonyme : aucun nom de joueur.

export interface AnalysisGame {
  matchId: string; account: string; startMs: number; durationS: number; patch: string; season?: number;
  championId: number; role: string; win: boolean; kills: number; deaths: number; assists: number; cs: number;
  gold15: number | null; cs15: number | null; cs10: number | null;
  teamKills: number | null; kills15: number | null; assists15: number | null; teamKills15: number | null;
  objTeam: number | null; objMine: number | null; deaths15: number;
}
export interface MyEventRow { t: number; kind: "kill" | "death" | "assist"; x: number; y: number; otherChamp: number }
export interface MetaMetricRow {
  championId: number; win: boolean; cs10: number | null; cs15: number | null; gold15: number | null; deaths15: number | null;
  kills15: number | null; assists15: number | null; teamKills15: number | null; objTeam: number | null; objMine: number | null;
  /** Toute la partie (participation après 15 min). */
  kills?: number; assists?: number; teamKills?: number | null;
}

type Values = Pick<AnalysisGame, "cs10" | "cs15" | "gold15" | "kills15" | "assists15" | "teamKills15" | "objTeam" | "objMine"> & {
  deaths15: number | null; kills?: number; assists?: number; teamKills?: number | null;
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
  /** Comparaison sur ton champion, ou sur tout le rôle si trop peu de parties. */
  comparedTo: "champion" | "role";
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

/** Part des joueurs que tu dépasses (100 = meilleur), dans le sens du « mieux ». */
function rankOf(value: number, xs: number[], better: "+" | "-"): number {
  if (!xs.length) return 50;
  let below = 0, equal = 0;
  for (const x of xs) {
    if (better === "+" ? x < value : x > value) below++;
    else if (x === value) equal++;
  }
  return ((below + equal / 2) / xs.length) * 100;
}

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
const fmt = (n: number, unit: string) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: unit === " %" || n >= 100 ? 0 : 1 })}${unit}`;

export function analyseGame(game: AnalysisGame, events: MyEventRow[], recent: AnalysisGame[], meta: MetaMetricRow[]): GameAnalysis {
  const same = meta.filter((r) => r.championId === game.championId);
  const ref = same.length >= MIN_META_CHAMP ? same : meta;
  const metaValues = (m: Metric) => ref.map((r) => m.value(r)).filter((x): x is number => x != null);

  const metrics: MetricCompare[] = METRICS.map((m) => {
    const xs = metaValues(m);
    const mine = m.value(game);
    return { key: m.key, label: m.label, unit: m.unit, better: m.better, mine, median: median(xs), rank: mine != null && xs.length ? rankOf(mine, xs, m.better) : null };
  });

  // Points à travailler : tes dernières parties sur ce champion dans ce rôle (sinon dans ce rôle).
  const champGames = recent.filter((g) => g.championId === game.championId && g.role === game.role);
  const pool = (champGames.length >= 5 ? champGames : recent.filter((g) => g.role === game.role)).slice(0, FOCUS_GAMES).reverse();
  const focus: FocusPoint[] = [];
  for (const m of METRICS) {
    const vals = pool.map((g) => m.value(g)).filter((x): x is number => x != null);
    const xs = metaValues(m);
    if (vals.length < 3 || xs.length < 20) continue;
    const mine = mean(vals);
    const med = median(xs)!;
    const rank = rankOf(mine, xs, m.better);
    if (rank >= 40) continue;
    const half = Math.floor(vals.length / 2);
    const progress = vals.length >= 4 ? (mean(vals.slice(half)) - mean(vals.slice(0, half))) * (m.better === "+" ? 1 : -1) : null;
    const trendText = progress == null ? "" : Math.abs(progress) < 0.05 * Math.max(1, Math.abs(med)) ? " Stable sur tes dernières parties." : progress > 0 ? " En progrès sur tes dernières parties." : " En recul sur tes dernières parties.";
    focus.push({
      key: m.key, label: m.label, unit: m.unit, mine, median: med, rank, trend: vals, progress,
      text: `${m.label} : ${fmt(mine, m.unit)} en moyenne, contre ${fmt(med, m.unit)} en Émeraude+ (mieux que ${Math.round(rank)} % des joueurs).${trendText}`,
    });
  }
  focus.sort((a, b) => a.rank - b.rank);

  return {
    game, events, metrics,
    comparedTo: ref === same ? "champion" : "role",
    metaGames: ref.length,
    focus: focus.slice(0, 3),
    focusGames: pool.length,
  };
}
