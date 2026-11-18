// Tes stats par champion et par rôle, à partir de tes parties enregistrées (my_games). Fonctions pures.

/** Une de tes parties, réduite à ce qu'il faut pour les stats (aucune donnée d'autres joueurs). */
export interface MyGameRow {
  matchId: string;
  account: string;
  startMs: number;
  durationS: number;
  patch: string;
  championId: number;
  role: string;
  win: boolean;
  remake: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  vision: number;
  gold15: number | null;
  cs15: number | null;
}

export const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
export const ROLE_LABELS: Record<string, string> = { TOP: "Haut", JUNGLE: "Jungle", MIDDLE: "Milieu", BOTTOM: "Bas", UTILITY: "Support", "": "?" };

export type Period = "season" | "30d" | "patch";

export interface StatsFilter {
  /** « all » ou un compte « Nom#TAG ». */
  account: string;
  /** « all » ou un rôle de ROLES. */
  role: string;
  period: Period;
  /** Masque les lignes avec moins de parties. */
  minGames: number;
}

export const DEFAULT_FILTER: StatsFilter = { account: "all", role: "all", period: "season", minGames: 1 };

export interface StatLine {
  championId: number;
  role: string;
  games: number;
  wins: number;
  /** Win rate en %. */
  winRate: number;
  kills: number;
  deaths: number;
  assists: number;
  /** (K + A) / max(1, D), sur l'ensemble des parties. */
  kda: number;
  /** Moyennes par partie (or et CS à 15 min : parties d'au moins 15 min seulement). */
  gold15: number | null;
  cs15: number | null;
  csPerMin: number;
  vision: number;
  visionPerMin: number;
  /** Dernière partie (ms). */
  lastPlayed: number;
}

export interface StatsResult {
  lines: StatLine[];
  total: StatLine | null;
  /** Parties retenues (hors remakes) et remakes écartés. */
  games: number;
  remakes: number;
  patch: string | null;
  accounts: string[];
}

const DAY = 86_400_000;

/** Compare deux patchs « 16.9 » < « 16.23 ». */
export function comparePatch(a: string, b: string): number {
  const [a1, a2] = a.split(".").map(Number);
  const [b1, b2] = b.split(".").map(Number);
  return a1 - b1 || a2 - b2;
}

function line(championId: number, role: string, gs: MyGameRow[]): StatLine {
  const sum = (f: (g: MyGameRow) => number) => gs.reduce((s, g) => s + f(g), 0);
  const avg = (vals: number[]) => (vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null);
  const n = gs.length;
  const wins = gs.filter((g) => g.win).length;
  const minutes = sum((g) => g.durationS) / 60;
  const k = sum((g) => g.kills), d = sum((g) => g.deaths), a = sum((g) => g.assists);
  return {
    championId,
    role,
    games: n,
    wins,
    winRate: n ? (wins / n) * 100 : 0,
    kills: n ? k / n : 0,
    deaths: n ? d / n : 0,
    assists: n ? a / n : 0,
    kda: (k + a) / Math.max(1, d),
    gold15: avg(gs.flatMap((g) => (g.gold15 == null ? [] : [g.gold15]))),
    cs15: avg(gs.flatMap((g) => (g.cs15 == null ? [] : [g.cs15]))),
    csPerMin: minutes ? sum((g) => g.cs) / minutes : 0,
    vision: n ? sum((g) => g.vision) / n : 0,
    visionPerMin: minutes ? sum((g) => g.vision) / minutes : 0,
    lastPlayed: Math.max(0, ...gs.map((g) => g.startMs)),
  };
}

/**
 * Stats par (champion, rôle), triées par nombre de parties. Les remakes sont écartés.
 * `now` sert à la période « 30 derniers jours ».
 */
export function myStats(all: MyGameRow[], f: StatsFilter = DEFAULT_FILTER, now = Date.now()): StatsResult {
  const accounts = [...new Set(all.map((g) => g.account))].sort();
  let rows = all.filter((g) => f.account === "all" || g.account === f.account);
  const remakes = rows.filter((g) => g.remake).length;
  rows = rows.filter((g) => !g.remake);
  const patch = rows.map((g) => g.patch).sort(comparePatch).pop() ?? null;
  if (f.period === "30d") rows = rows.filter((g) => now - g.startMs <= 30 * DAY);
  if (f.period === "patch") rows = rows.filter((g) => g.patch === patch);
  if (f.role !== "all") rows = rows.filter((g) => g.role === f.role);

  const groups = new Map<string, MyGameRow[]>();
  for (const g of rows) {
    const k = `${g.championId}|${g.role}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(g);
  }
  const lines = [...groups.entries()]
    .map(([k, gs]) => { const [c, r] = k.split("|"); return line(Number(c), r, gs); })
    .filter((l) => l.games >= f.minGames)
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate || a.championId - b.championId);
  return { lines, total: rows.length ? line(0, f.role === "all" ? "" : f.role, rows) : null, games: rows.length, remakes, patch, accounts };
}
