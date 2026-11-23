// Tes stats par champion et par rôle, à partir de tes parties enregistrées (my_games). Fonctions pures.

/** Une de tes parties, réduite à ce qu'il faut pour les stats (aucune donnée d'autres joueurs). */
export interface MyGameRow {
  matchId: string;
  account: string;
  startMs: number;
  durationS: number;
  patch: string;
  /** Saison (année). */
  season: number;
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
  /** Kills de ton équipe ; avant 15 min : tes kills, tes assists, ceux de ton équipe (null : pas encore relu ou sans chronologie). */
  teamKills: number | null;
  kills15: number | null;
  assists15: number | null;
  teamKills15: number | null;
}

export const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
export const ROLE_LABELS: Record<string, string> = { TOP: "Haut", JUNGLE: "Jungle", MIDDLE: "Milieu", BOTTOM: "Bas", UTILITY: "Support", "": "?" };

/** Dans la saison choisie : toute la saison, les 30 derniers jours, ou le dernier patch joué. */
export type Period = "all" | "30d" | "patch";

export interface StatsFilter {
  /** « all » ou un compte « Nom#TAG ». */
  account: string;
  /** « all » ou un rôle de ROLES. */
  role: string;
  /** « current » (saison la plus récente jouée), « all » (toutes) ou une année. */
  season: "current" | "all" | number;
  period: Period;
  /** Masque les lignes avec moins de parties. */
  minGames: number;
  /** Champions exclus (clé numérique Riot) : parties jouées par quelqu'un d'autre. */
  excluded: number[];
}

export const DEFAULT_FILTER: StatsFilter = { account: "all", role: "all", season: "current", period: "all", minGames: 1, excluded: [] };

/**
 * Poids d'une saison pour le score : 1 pour la saison en cours, ½ pour la précédente, ¼ au-delà.
 * Les anciennes saisons comptent moins (le jeu et ton niveau ont changé) ; leurs builds et runes
 * ne servent jamais aux recommandations actuelles.
 */
export function seasonWeight(season: number, current: number): number {
  const age = current - season;
  return age <= 0 ? 1 : age === 1 ? 0.5 : 0.25;
}

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
  /** Parties retenues (hors remakes), remakes écartés, parties sur des champions exclus. */
  games: number;
  remakes: number;
  excludedGames: number;
  patch: string | null;
  /** Saison affichée (null pour « toutes »). */
  season: number | null;
  accounts: string[];
  /** Saisons présentes dans tes parties, de la plus récente à la plus ancienne. */
  seasons: number[];
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
  const seasons = [...new Set(all.map((g) => g.season))].sort((a, b) => b - a);
  const season = f.season === "all" ? null : f.season === "current" ? (seasons[0] ?? null) : f.season;
  const excluded = new Set(f.excluded);
  let rows = all.filter((g) => (f.account === "all" || g.account === f.account) && (season == null || g.season === season));
  const excludedGames = rows.filter((g) => excluded.has(g.championId)).length;
  rows = rows.filter((g) => !excluded.has(g.championId));
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
  return { lines, total: rows.length ? line(0, f.role === "all" ? "" : f.role, rows) : null, games: rows.length, remakes, excludedGames, patch, season, accounts, seasons };
}
