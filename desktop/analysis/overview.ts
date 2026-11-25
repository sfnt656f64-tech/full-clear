// Vue d'ensemble de l'onglet « Analyse » : tes parties filtrées (champion, rôle, période, compte), comparées à
// la méta Émeraude+ (même rôle, et même champion quand il y en a un), avec points forts / faibles, évolution
// et tableau de tes champions. Fonctions pures.
import { METRICS, type AnalysisGame, type MetaMetricRow, type Metric } from "./analysis.ts";

export type Period = { kind: "season"; season: number } | { kind: "30d" } | { kind: "patch" } | { kind: "all" };

export interface OverviewFilter {
  /** Clé numérique du champion, ou null pour tous. */
  championId: number | null;
  /** Rôle (TOP, JUNGLE…), ou null pour tous. */
  role: string | null;
  period: Period;
  /** « Nom#TAG », ou null pour les deux comptes. */
  account: string | null;
}

/** Parties de méta minimales sur un champion pour s'y comparer (sinon : tout le rôle). */
export const MIN_META_CHAMP = 30;
/** Parties minimales d'un champion pour le tableau comparatif. */
export const MIN_TABLE_GAMES = 3;
const DAY = 86_400_000;

const cmpPatch = (a: string, b: string) => {
  const [a1, a2] = a.split(".").map(Number), [b1, b2] = b.split(".").map(Number);
  return a1 - b1 || a2 - b2;
};

export function filterGames(games: AnalysisGame[], f: OverviewFilter, now = Date.now()): AnalysisGame[] {
  let out = games.filter((g) => (f.championId == null || g.championId === f.championId) && (f.role == null || g.role === f.role) && (f.account == null || g.account === f.account));
  if (f.period.kind === "season") { const s = f.period.season; out = out.filter((g) => g.season === s); }
  if (f.period.kind === "30d") out = out.filter((g) => now - g.startMs <= 30 * DAY);
  if (f.period.kind === "patch") {
    const last = games.map((g) => g.patch).sort(cmpPatch).pop();
    out = out.filter((g) => g.patch === last);
  }
  return out;
}

/** Référence de méta : par rôle, tous champions, et par (rôle, champion). Valeurs triées par mesure. */
export class MetaRef {
  private readonly cache = new Map<string, number[]>();
  private readonly rows: Map<string, MetaMetricRow[]>;
  constructor(byRole: Map<string, MetaMetricRow[]>) { this.rows = byRole; }

  /** Lignes de comparaison : le champion s'il a assez de parties, sinon tout le rôle. */
  rowsFor(role: string, championId: number | null): { rows: MetaMetricRow[]; champion: boolean } {
    const all = this.rows.get(role) ?? [];
    if (championId != null) {
      const same = all.filter((r) => r.championId === championId);
      if (same.length >= MIN_META_CHAMP) return { rows: same, champion: true };
    }
    return { rows: all, champion: false };
  }

  sorted(m: Metric, role: string, championId: number | null): number[] {
    const { rows, champion } = this.rowsFor(role, championId);
    const key = `${m.key}|${role}|${champion ? championId : "*"}`;
    let xs = this.cache.get(key);
    if (!xs) {
      xs = rows.map((r) => m.value(r)).filter((x): x is number => x != null).sort((a, b) => a - b);
      this.cache.set(key, xs);
    }
    return xs;
  }
}

/** Part des valeurs de méta que `v` dépasse (100 = meilleur), dans le sens du « mieux » ; égalités comptées à moitié. */
export function percentile(v: number, sorted: number[], better: "+" | "-"): number | null {
  if (!sorted.length) return null;
  const bound = (strict: boolean) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (strict ? sorted[m] < v : sorted[m] <= v) lo = m + 1; else hi = m; }
    return lo;
  };
  const below = bound(true), equal = bound(false) - below;
  const p = ((below + equal / 2) / sorted.length) * 100;
  return better === "+" ? p : 100 - p;
}

const median = (xs: number[]): number | null => (xs.length ? (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2) : null);
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

export interface OverviewMetric {
  key: string; label: string; unit: string; better: "+" | "-";
  /** Ta moyenne sur la sélection, et le nombre de parties où la mesure existe. */
  mine: number | null;
  n: number;
  /** Médiane Émeraude+ (un seul rôle dans la sélection), sinon null. */
  median: number | null;
  /** Moyenne de ta position partie par partie (100 = meilleur), chaque partie comparée à son rôle. */
  rank: number | null;
}

export interface Overview {
  games: number;
  wins: number;
  winRate: number | null;
  /** Win rate Émeraude+ du champion (ou du rôle) pour comparaison, si un seul rôle. */
  metaWinRate: number | null;
  metrics: OverviewMetric[];
  strengths: OverviewMetric[];
  weaknesses: OverviewMetric[];
  /** Référence : le champion choisi (assez de méta) ou tout le rôle. */
  comparedTo: "champion" | "role" | "mixed";
  /** Des parties d'anciennes saisons sont comparées à la méta actuelle. */
  oldSeasons: boolean;
}

export function overview(games: AnalysisGame[], ref: MetaRef, f: OverviewFilter, currentSeason: number | null): Overview {
  const roles = [...new Set(games.map((g) => g.role))];
  const single = roles.length === 1 ? roles[0] : null;
  const metrics: OverviewMetric[] = METRICS.map((m) => {
    const vals: number[] = [], ranks: number[] = [];
    for (const g of games) {
      const v = m.value(g);
      if (v == null) continue;
      vals.push(v);
      const r = percentile(v, ref.sorted(m, g.role, f.championId), m.better);
      if (r != null) ranks.push(r);
    }
    return {
      key: m.key, label: m.label, unit: m.unit, better: m.better, mine: mean(vals), n: vals.length,
      median: single ? median(ref.sorted(m, single, f.championId)) : null,
      rank: ranks.length ? mean(ranks) : null,
    };
  });
  const wins = games.filter((g) => g.win).length;
  let metaWinRate: number | null = null;
  let comparedTo: Overview["comparedTo"] = "mixed";
  if (single) {
    const { rows, champion } = ref.rowsFor(single, f.championId);
    metaWinRate = rows.length ? (rows.filter((r) => r.win).length / rows.length) * 100 : null;
    comparedTo = champion ? "champion" : "role";
  }
  const ranked = metrics.filter((m) => m.rank != null && m.n >= 3);
  return {
    games: games.length,
    wins,
    winRate: games.length ? (wins / games.length) * 100 : null,
    metaWinRate,
    metrics,
    strengths: ranked.filter((m) => m.rank! >= 60).sort((a, b) => b.rank! - a.rank!).slice(0, 3),
    weaknesses: ranked.filter((m) => m.rank! <= 40).sort((a, b) => a.rank! - b.rank!).slice(0, 3),
    comparedTo,
    oldSeasons: currentSeason != null && games.some((g) => g.season != null && g.season < currentSeason),
  };
}

export interface EvolutionPoint { label: string; games: number; winRate: number; values: Record<string, number | null> }

/** Évolution mois par mois si la sélection couvre plus de 3 mois, sinon patch par patch (de l'ancien au récent). */
export function evolution(games: AnalysisGame[]): { by: "month" | "patch"; points: EvolutionPoint[] } {
  if (!games.length) return { by: "patch", points: [] };
  const span = Math.max(...games.map((g) => g.startMs)) - Math.min(...games.map((g) => g.startMs));
  const by = span > 92 * DAY ? "month" : "patch";
  const keyOf = (g: AnalysisGame) => {
    if (by === "patch") return g.patch;
    const d = new Date(g.startMs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const groups = new Map<string, AnalysisGame[]>();
  for (const g of games) (groups.get(keyOf(g)) ?? groups.set(keyOf(g), []).get(keyOf(g))!).push(g);
  const keys = [...groups.keys()].sort(by === "patch" ? cmpPatch : (a, b) => a.localeCompare(b));
  return {
    by,
    points: keys.map((k) => {
      const gs = groups.get(k)!;
      const values: Record<string, number | null> = {};
      for (const m of METRICS) values[m.key] = mean(gs.map((g) => m.value(g)).filter((x): x is number => x != null));
      return { label: by === "month" ? monthLabel(k) : k, games: gs.length, winRate: (gs.filter((g) => g.win).length / gs.length) * 100, values };
    }),
  };
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const monthLabel = (k: string) => { const [y, m] = k.split("-").map(Number); return `${MONTHS[m - 1]} ${String(y).slice(2)}`; };

export interface ChampionRow {
  championId: number;
  games: number;
  winRate: number;
  /** Ta moyenne par mesure, et ta position moyenne face à la méta (champion si assez de parties, sinon rôle). */
  values: Record<string, number | null>;
  ranks: Record<string, number | null>;
  /** Médiane Émeraude+ sur ce champion (si assez de parties de méta). */
  medians: Record<string, number | null>;
}

/** Tes champions entre eux (au moins MIN_TABLE_GAMES parties dans la sélection), du plus joué au moins joué. */
export function championTable(games: AnalysisGame[], ref: MetaRef): ChampionRow[] {
  const by = new Map<number, AnalysisGame[]>();
  for (const g of games) (by.get(g.championId) ?? by.set(g.championId, []).get(g.championId)!).push(g);
  const rows: ChampionRow[] = [];
  for (const [championId, gs] of by) {
    if (gs.length < MIN_TABLE_GAMES) continue;
    const values: Record<string, number | null> = {}, ranks: Record<string, number | null> = {}, medians: Record<string, number | null> = {};
    const role = gs[0].role;
    for (const m of METRICS) {
      const vals = gs.map((g) => m.value(g)).filter((x): x is number => x != null);
      values[m.key] = mean(vals);
      const rs = gs.flatMap((g) => { const v = m.value(g); const r = v == null ? null : percentile(v, ref.sorted(m, g.role, championId), m.better); return r == null ? [] : [r]; });
      ranks[m.key] = mean(rs);
      medians[m.key] = ref.rowsFor(role, championId).champion ? median(ref.sorted(m, role, championId)) : null;
    }
    rows.push({ championId, games: gs.length, winRate: (gs.filter((g) => g.win).length / gs.length) * 100, values, ranks, medians });
  }
  return rows.sort((a, b) => b.games - a.games);
}
