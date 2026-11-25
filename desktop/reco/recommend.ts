// Champions recommandés (jungle, mid) : « Mon pool » classé par score, et « À essayer » (champions que tu ne
// joues pas) choisis d'après ton profil de jeu, leur ressemblance avec tes meilleurs champions, leur force dans
// la méta Émeraude+ et leur difficulté de prise en main. Fonctions pures.
//
// Score « Mon pool » :
//   - ton win rate, chaque partie pondérée par sa saison (1 / ½ / ¼), ramené vers le win rate de la méta
//     comme si tu avais joué SHRINK_MY parties de plus à ce niveau : 3 victoires sur 3 ne suffisent pas
//     à faire un champion fort (faux positif) ;
//   - la force du champion dans la méta (win rate ramené vers 50 % de la même façon), avec un petit poids :
//     elle sert déjà de point de départ à ton win rate lissé ;
//   - ta maîtrise : parties classées pondérées (jusqu'à +6, en racine : chaque partie compte, sans plafond trop tôt) et points de maîtrise Riot de tes comptes,
//     qui comptent aussi les autres modes (jusqu'à +1,5).
//
//   score = ton win rate lissé + 0,3 × (win rate méta lissé − 50) + bonus parties + bonus points
import { champByKey, PROFILE_FROM_TAG, PROFILE_LABEL } from "../../src/data/champions";
import { mobility, MOBILITY_LABEL } from "../../src/data/mobility";
import type { Champion } from "../../src/data/types";
import type { MetaChampion, MetaMasteryRow, MetaPartRow } from "../meta/meta-stats.ts";
import { seasonWeight, type MyGameRow } from "../stats/my-stats.ts";

export const RECO_ROLES = ["JUNGLE", "MIDDLE"] as const;
/** Parties « fictives » au win rate de la méta ajoutées à tes parties (lissage). */
export const SHRINK_MY = 30;
/** Parties « fictives » à 50 % ajoutées aux parties de méta. */
export const SHRINK_META = 100;
/** Parties dans le rôle (toutes saisons) pour faire partie de ton pool ; en dessous, le champion peut être proposé dans « À essayer ». */
export const POOL_MIN_GAMES = 10;
/** Parties de méta dans le rôle pour être proposé dans « À essayer ». */
export const TRY_MIN_META = 50;
/** Bonus de maîtrise : parties classées (racine, plein à GAMES_FULL parties pondérées), points Riot (plein à 300 000). */
export const GAMES_BONUS = 6;
export const GAMES_FULL = 150;
export const POINTS_BONUS = 1.5;
/** Win rate de méta (lissé) minimal pour « À essayer ». */
export const TRY_MIN_META_WR = 49;
/** Ressemblance (0 à 1) à partir de laquelle on cite un de tes champions. */
export const SIMILAR = 0.6;
/** En dessous : « provisoire ». */
export const PROVISIONAL_META = 100;
/** Parties courtes / longues (secondes) pour le style early / scaling. */
export const SHORT_S = 25 * 60;
export const LONG_S = 32 * 60;
/** « À essayer » : nombre de propositions par rôle. */
export const TRY_COUNT = 5;
/** Points de maîtrise : environ 1 000 par partie (approximation pour parler en parties). */
export const MASTERY_STEPS = [
  { max: 10_000, games: 10 },
  { max: 30_000, games: 30 },
  { max: 100_000, games: 100 },
  { max: Infinity, games: Infinity },
] as const;

export interface Rate { games: number; winRate: number }

export interface PlayProfile {
  role: string;
  games: number;
  /** Participation aux kills (%) : toute la partie, avant 15 min, après 15 min. */
  kp: number | null;
  kp15: number | null;
  kpLate: number | null;
  /** Moyenne Émeraude+ du rôle avant 15 min (référence ; null sans chronologies de méta). */
  metaKp15: number | null;
  /** Part des kills de ton équipe que tu fais toi-même (%). */
  killShare: number | null;
  gold15: number | null;
  metaGold15: number | null;
  /** Tes parties courtes (< 25 min) et longues (≥ 32 min). */
  short: Rate;
  long: Rate;
  /** De −1 (scaling) à +1 (early). */
  tilt: number;
  style: "early" | "scaling" | "balanced";
}

export interface ChampStyle {
  games: number;
  /** Win rate (lissé) des parties courtes moins celui des parties longues, en points : > 0 = champion d'early. */
  early: number;
  kp: number | null;
  kp15: number | null;
  gold15: number | null;
}

export interface Learning {
  /** Parties (environ) avant d'atteindre le niveau des joueurs qui le maîtrisent ; null si inconnu. */
  games: number | null;
  /** Win rate des joueurs qui le découvrent (< 10 000 points) et de ceux qui le maîtrisent (≥ 100 000). */
  novice: Rate | null;
  expert: Rate | null;
}

export interface PoolPick {
  championId: number;
  role: string;
  /** Indice de classement (proche d'un win rate attendu). */
  score: number;
  games: number;
  /** Parties pondérées par saison. */
  weightedGames: number;
  winRate: number;
  /** Ton win rate lissé (pondéré par saison, ramené vers la méta). */
  adjustedWinRate: number;
  /** Points de maîtrise (tes comptes cumulés). */
  masteryPoints: number;
  /** Détail du score : la somme des 4 termes. */
  breakdown: { winRate: number; meta: number; games: number; mastery: number };
  kda: number;
  meta: Rate | null;
  /** Parties par saison, de la plus récente à la plus ancienne. */
  seasons: { season: number; games: number }[];
  reasons: string[];
  provisional: boolean;
}

export interface TryPick {
  championId: number;
  role: string;
  score: number;
  meta: Rate;
  similarTo: number[];
  learning: Learning;
  /** Tes parties sur ce champion dans le rôle (moins que le minimum du pool). */
  tried: { games: number; wins: number } | null;
  reasons: string[];
  provisional: boolean;
}

export interface RoleReco { role: string; profile: PlayProfile; pool: PoolPick[]; tryList: TryPick[] }

export interface RecoInput {
  myGames: MyGameRow[];
  /** Méta des derniers patchs (metaStats) et ses lignes brutes (style des champions). */
  meta: MetaChampion[];
  metaParts: MetaPartRow[];
  /** Maîtrise des joueurs sources (tous patchs en base). */
  mastery: MetaMasteryRow[];
  metaMatches: number;
  excluded: number[];
  /** Tes points de maîtrise par champion (tes comptes cumulés). */
  myMastery?: Map<number, number>;
}

export interface Recommendations {
  roles: RoleReco[];
  metaMatches: number;
  /** Méta encore trop maigre : tout est provisoire. */
  provisional: boolean;
  season: number | null;
}

const pct = (w: number, n: number) => (n ? (w / n) * 100 : 0);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const nf = (n: number, d = 0) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
/** Win rate ramené vers `prior` (%) avec `k` parties fictives. */
const shrink = (wins: number, n: number, prior: number, k: number) => ((wins + (k * prior) / 100) / (n + k)) * 100;
const rate = (rows: { win: boolean }[]): Rate => ({ games: rows.length, winRate: pct(rows.filter((r) => r.win).length, rows.length) });

// ---------- Style des champions (méta) ----------

/** Style de chaque (champion, rôle) dans la méta : early / scaling, participation aux kills. */
export function metaStyles(parts: MetaPartRow[]): Map<string, ChampStyle> {
  const teamKills = new Map<string, number>();
  for (const p of parts) {
    const k = `${p.matchId}|${p.team}`;
    teamKills.set(k, (teamKills.get(k) ?? 0) + (p.kills ?? 0));
  }
  const groups = new Map<string, MetaPartRow[]>();
  for (const p of parts) {
    if (!p.role) continue;
    const k = `${p.championId}|${p.role}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(p);
  }
  const out = new Map<string, ChampStyle>();
  for (const [k, rows] of groups) {
    const short = rows.filter((r) => (r.durationS ?? 0) > 0 && r.durationS! < SHORT_S);
    const long = rows.filter((r) => (r.durationS ?? 0) >= LONG_S);
    const sw = short.filter((r) => r.win).length, lw = long.filter((r) => r.win).length;
    let ka = 0, tk = 0, ka15 = 0, tk15 = 0, g15 = 0, n15 = 0;
    for (const r of rows) {
      const t = teamKills.get(`${r.matchId}|${r.team}`) ?? 0;
      if (t > 0) { ka += (r.kills ?? 0) + (r.assists ?? 0); tk += t; }
      if (r.teamKills15 != null && r.teamKills15 > 0) { ka15 += (r.kills15 ?? 0) + (r.assists15 ?? 0); tk15 += r.teamKills15; }
      if (r.gold15 != null) { g15 += r.gold15; n15++; }
    }
    out.set(k, {
      games: rows.length,
      early: shrink(sw, short.length, 50, 20) - shrink(lw, long.length, 50, 20),
      kp: tk ? pct(ka, tk) : null,
      kp15: tk15 >= 50 ? pct(ka15, tk15) : null,
      gold15: n15 >= 20 ? g15 / n15 : null,
    });
  }
  return out;
}

/** Moyennes du rôle dans la méta (participation avant 15 min, or à 15 min) : référence pour ton profil. */
function roleBaseline(parts: MetaPartRow[], role: string): { kp15: number | null; gold15: number | null } {
  let ka15 = 0, tk15 = 0, g = 0, n = 0;
  for (const p of parts) {
    if (p.role !== role) continue;
    if (p.teamKills15 != null && p.teamKills15 > 0) { ka15 += (p.kills15 ?? 0) + (p.assists15 ?? 0); tk15 += p.teamKills15; }
    if (p.gold15 != null) { g += p.gold15; n++; }
  }
  return { kp15: tk15 >= 200 ? pct(ka15, tk15) : null, gold15: n >= 50 ? g / n : null };
}

// ---------- Ton profil ----------

export function playProfile(games: MyGameRow[], role: string, baseline: { kp15: number | null; gold15: number | null }): PlayProfile {
  const rows = games.filter((g) => g.role === role);
  let ka = 0, tk = 0, ka15 = 0, tk15 = 0, kaLate = 0, tkLate = 0, k = 0;
  for (const g of rows) {
    if (g.teamKills && g.teamKills > 0) { ka += g.kills + g.assists; tk += g.teamKills; k += g.kills; }
    if (g.teamKills != null && g.teamKills15 != null && g.kills15 != null && g.assists15 != null) {
      ka15 += g.kills15 + g.assists15; tk15 += g.teamKills15;
      kaLate += g.kills + g.assists - g.kills15 - g.assists15; tkLate += g.teamKills - g.teamKills15;
    }
  }
  const golds = rows.flatMap((g) => (g.gold15 == null ? [] : [g.gold15]));
  const short = rate(rows.filter((g) => g.durationS < SHORT_S));
  const long = rate(rows.filter((g) => g.durationS >= LONG_S));
  const kp15 = tk15 >= 30 ? pct(ka15, tk15) : null;
  const kpLate = tkLate >= 30 ? pct(kaLate, tkLate) : null;
  const gold15 = golds.length >= 10 ? golds.reduce((s, v) => s + v, 0) / golds.length : null;

  // Penchant early / scaling : écart de win rate parties courtes / longues (lissé), et, si la méta le permet,
  // ta participation et ton or à 15 min comparés à la moyenne Émeraude+ du rôle.
  const signals: number[] = [];
  const sl = short.games + long.games;
  if (sl >= 10) {
    const s = shrink((short.winRate * short.games) / 100, short.games, 50, 20);
    const l = shrink((long.winRate * long.games) / 100, long.games, 50, 20);
    // Confiance selon le nombre de parties : 17 parties ne suffisent pas à définir un style.
    signals.push(clamp((s - l) / 10, -1, 1) * (sl / (sl + 40)));
  }
  if (kp15 != null && baseline.kp15 != null) signals.push(clamp((kp15 - baseline.kp15) / 10, -1, 1));
  if (gold15 != null && baseline.gold15 != null) signals.push(clamp((gold15 - baseline.gold15) / 500, -1, 1));
  const tilt = signals.length ? signals.reduce((s, v) => s + v, 0) / signals.length : 0;
  return {
    role,
    games: rows.length,
    kp: tk ? pct(ka, tk) : null,
    kp15,
    kpLate,
    metaKp15: baseline.kp15,
    killShare: tk ? pct(k, tk) : null,
    gold15,
    metaGold15: baseline.gold15,
    short,
    long,
    tilt,
    style: tilt > 0.3 ? "early" : tilt < -0.3 ? "scaling" : "balanced",
  };
}

// ---------- Difficulté de prise en main ----------

/** Parties nécessaires (environ) avant de jouer au niveau des joueurs qui maîtrisent le champion. */
export function learning(rows: MetaMasteryRow[]): Learning {
  const novice = rate(rows.filter((r) => r.points < MASTERY_STEPS[0].max));
  const expert = rate(rows.filter((r) => r.points >= MASTERY_STEPS[2].max));
  if (rows.length < 40 || expert.games < 15) return { games: null, novice: novice.games ? novice : null, expert: expert.games ? expert : null };
  // Plateau : niveau des joueurs à plus de 100 000 points, lissé vers 50 %.
  const plateau = shrink((expert.winRate * expert.games) / 100, expert.games, 50, 20);
  let lo = 0;
  for (const step of MASTERY_STEPS) {
    const r = rate(rows.filter((x) => x.points >= lo && x.points < step.max));
    lo = step.max;
    if (r.games < 10) continue;
    // Atteint quand le win rate de la tranche est à moins de 2 points du plateau (en tenant compte du petit échantillon).
    if (shrink((r.winRate * r.games) / 100, r.games, plateau, 10) >= plateau - 2) {
      return { games: Number.isFinite(step.games) ? step.games : 150, novice, expert };
    }
  }
  return { games: 150, novice, expert };
}

export const learningLabel = (l: Learning): string =>
  l.games == null ? "difficulté encore inconnue" : l.games <= 10 ? "prise en main rapide" : l.games <= 30 ? `≈ ${l.games} parties pour le maîtriser`
    : l.games <= 100 ? "≈ 100 parties pour le maîtriser" : "long à maîtriser (plus de 100 parties)";

// ---------- Ressemblance entre champions ----------

function describe(c: Champion): string {
  const dmg = c.damage === "magic" ? "dégâts magiques" : c.damage === "physical" ? "dégâts physiques" : "dégâts mixtes";
  return `${PROFILE_LABEL[c.profile].toLowerCase()} ${MOBILITY_LABEL[mobility(c.id)]}, ${dmg}`;
}

/** Ressemblance de 0 à 1 : classe, dégâts, portée, mobilité, style (early / scaling). */
export function similarity(a: Champion, b: Champion, sa?: ChampStyle, sb?: ChampStyle): number {
  let s = 0;
  // Même classe ; à moitié si la classe de l'un est une des étiquettes Riot de l'autre (Kayn : combattant et assassin).
  const tagProfiles = (c: Champion) => new Set((c.tags ?? []).map((t) => PROFILE_FROM_TAG[t]));
  if (a.profile === b.profile) s += 0.3;
  else if (tagProfiles(b).has(a.profile) || tagProfiles(a).has(b.profile)) s += 0.15;
  const ta = new Set(a.tags ?? []), tb = new Set(b.tags ?? []);
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  if (union) s += 0.15 * (inter / union);
  if (a.damage === b.damage) s += 0.15;
  else if (a.damage === "mixed" || b.damage === "mixed") s += 0.07;
  if (a.range === b.range) s += 0.1;
  const dm = Math.abs(mobility(a.id) - mobility(b.id));
  s += dm === 0 ? 0.15 : dm === 1 ? 0.07 : 0;
  if (sa && sb) s += 0.15 * clamp(1 - Math.abs(sa.early - sb.early) / 8, 0, 1);
  else s += 0.07;
  return clamp(s, 0, 1);
}

// ---------- Calcul ----------

export function recommend(input: RecoInput): Recommendations {
  const excluded = new Set(input.excluded);
  const seasons = [...new Set(input.myGames.map((g) => g.season))].sort((a, b) => b - a);
  const current = seasons[0] ?? null;
  const games = input.myGames.filter((g) => !g.remake && !excluded.has(g.championId));
  const metaBy = new Map(input.meta.map((m) => [`${m.championId}|${m.role}`, m]));
  const styles = metaStyles(input.metaParts);
  const masteryBy = new Map<number, MetaMasteryRow[]>();
  for (const m of input.mastery) (masteryBy.get(m.championId) ?? masteryBy.set(m.championId, []).get(m.championId)!).push(m);
  const provisional = input.metaMatches < 1000;

  // ----- Mon pool -----
  const pools = new Map<string, PoolPick[]>(RECO_ROLES.map((role) => {
    const byChamp = new Map<number, MyGameRow[]>();
    for (const g of games) if (g.role === role) (byChamp.get(g.championId) ?? byChamp.set(g.championId, []).get(g.championId)!).push(g);
    const pool: PoolPick[] = [];
    for (const [championId, gs] of byChamp) {
      if (gs.length < POOL_MIN_GAMES) continue;
      const m = metaBy.get(`${championId}|${role}`);
      const metaAdj = m ? shrink(m.wins, m.games, 50, SHRINK_META) : 50;
      let wn = 0, ww = 0;
      for (const g of gs) {
        const w = current == null ? 1 : seasonWeight(g.season, current);
        wn += w;
        if (g.win) ww += w;
      }
      const adjusted = shrink(ww, wn, metaAdj, SHRINK_MY);
      const points = input.myMastery?.get(championId) ?? 0;
      const breakdown = {
        winRate: adjusted,
        meta: 0.3 * (metaAdj - 50),
        games: GAMES_BONUS * Math.min(1, Math.sqrt(wn / GAMES_FULL)),
        mastery: POINTS_BONUS * Math.min(1, Math.log(1 + points / 1000) / Math.log(1 + 300)),
      };
      const k = gs.reduce((s, g) => s + g.kills, 0), d = gs.reduce((s, g) => s + g.deaths, 0), a = gs.reduce((s, g) => s + g.assists, 0);
      const bySeason = new Map<number, number>();
      for (const g of gs) bySeason.set(g.season, (bySeason.get(g.season) ?? 0) + 1);
      const wins = gs.filter((g) => g.win).length;
      const pick: PoolPick = {
        championId, role,
        score: breakdown.winRate + breakdown.meta + breakdown.games + breakdown.mastery,
        games: gs.length,
        weightedGames: wn,
        winRate: pct(wins, gs.length),
        adjustedWinRate: adjusted,
        masteryPoints: points,
        breakdown,
        kda: (k + a) / Math.max(1, d),
        meta: m ? { games: m.games, winRate: m.winRate } : null,
        seasons: [...bySeason.entries()].sort((x, y) => y[0] - x[0]).map(([season, n]) => ({ season, games: n })),
        reasons: [],
        provisional: provisional || !m || m.games < PROVISIONAL_META,
      };
      pick.reasons = poolReasons(pick, current, metaAdj);
      pool.push(pick);
    }
    pool.sort((x, y) => y.score - x.score || y.games - x.games);
    return [role, pool];
  }));
  const triedOf = (role: string, championId: number) => {
    const gs = games.filter((g) => g.role === role && g.championId === championId);
    return gs.length ? { games: gs.length, wins: gs.filter((g) => g.win).length } : null;
  };
  /** Champions de ton pool (dans l'un ou l'autre rôle) : jamais dans « À essayer ». */
  const played = new Set([...pools.values()].flat().map((p) => p.championId));

  const roles = RECO_ROLES.map((role): RoleReco => {
    // Profil : saison en cours et précédente (ton jeu actuel).
    const recent = games.filter((g) => current == null || g.season >= current - 1);
    const profile = playProfile(recent, role, roleBaseline(input.metaParts, role));
    const pool = pools.get(role)!;

    // ----- À essayer -----
    // Tes meilleurs champions (au moins 5 parties) : ceux du rôle, complétés par ceux de l'autre rôle si tu y joues peu.
    const solid = (r: string) => pools.get(r)!.filter((p) => p.games >= 5);
    const best = (solid(role).length >= 2 ? solid(role) : [...solid(role), ...RECO_ROLES.filter((r) => r !== role).flatMap(solid)]).slice(0, 3);
    const tryList: TryPick[] = [];
    for (const m of input.meta) {
      if (m.role !== role || m.games < TRY_MIN_META || played.has(m.championId) || excluded.has(m.championId)) continue;
      const c = champByKey(m.championId);
      if (!c) continue;
      const st = styles.get(`${m.championId}|${role}`);
      const sims = best.flatMap((b) => {
        const bc = champByKey(b.championId);
        return bc ? [{ id: b.championId, sim: similarity(c, bc, st, styles.get(`${b.championId}|${b.role}`)) }] : [];
      }).sort((x, y) => y.sim - x.sim);
      const sim = sims[0]?.sim ?? 0.5;
      const metaAdj = shrink(m.wins, m.games, 50, SHRINK_META);
      // Un champion en difficulté dans la méta n'est jamais proposé, même s'il te ressemble.
      if (metaAdj < TRY_MIN_META_WR) continue;
      const metaNorm = clamp((metaAdj - 47) / 8, 0, 1);
      // Tous rôles confondus : la prise en main d'un champion dépend peu du rôle, et il faut beaucoup de parties.
      const learn = learning(masteryBy.get(m.championId) ?? []);
      const ease = learn.games == null ? 0.5 : learn.games <= 10 ? 1 : learn.games <= 30 ? 0.7 : learn.games <= 100 ? 0.4 : 0.1;
      // Style : un joueur d'early sur un champion d'early (et inversement).
      const fit = st ? profile.tilt * clamp(st.early / 6, -1, 1) : 0;
      const parts = { sim: 0.4 * sim, meta: 0.3 * metaNorm, ease: 0.2 * ease, fit: 0.1 * (fit + 1) / 2 };
      const pick: TryPick = {
        championId: m.championId, role,
        score: 100 * (parts.sim + parts.meta + parts.ease + parts.fit),
        meta: { games: m.games, winRate: m.winRate },
        similarTo: sims.filter((x) => x.sim >= SIMILAR).slice(0, 2).map((x) => x.id),
        learning: learn,
        tried: triedOf(role, m.championId),
        reasons: [],
        provisional: provisional || m.games < PROVISIONAL_META || learn.games == null,
      };
      pick.reasons = tryReasons(pick, c, sims[0] ? champByKey(sims[0].id) : undefined, sim, metaAdj, learn, profile, st, fit);
      tryList.push(pick);
    }
    tryList.sort((x, y) => y.score - x.score || y.meta.games - x.meta.games);
    return { role, profile, pool, tryList: tryList.slice(0, TRY_COUNT) };
  });
  return { roles, metaMatches: input.metaMatches, provisional, season: current };
}

// ---------- Raisons en clair ----------

/** 1 à 2 raisons, les plus marquantes d'abord. */
function top(reasons: { w: number; text: string }[]): string[] {
  return reasons.filter((r) => r.w > 0).sort((a, b) => b.w - a.w).slice(0, 2).map((r) => r.text);
}

function poolReasons(p: PoolPick, current: number | null, metaAdj: number): string[] {
  const r: { w: number; text: string }[] = [];
  if (p.games >= 8 && p.winRate >= 54) r.push({ w: (p.winRate - 50) * Math.sqrt(p.games) / 4, text: `Tu gagnes ${nf(p.winRate)} % de tes ${p.games} parties.` });
  if (p.games >= 8 && p.winRate <= 46) r.push({ w: (50 - p.winRate) * Math.sqrt(p.games) / 4, text: `Seulement ${nf(p.winRate)} % de victoires sur ${p.games} parties.` });
  if (p.games < 8) r.push({ w: 6, text: `Seulement ${p.games} parties : ton win rate compte encore peu.` });
  if (p.weightedGames >= 30 || p.masteryPoints >= 150_000) {
    r.push({ w: 5 + p.weightedGames / 20, text: `Champion que tu maîtrises (${p.games} parties${p.masteryPoints >= 10_000 ? `, ${nf(Math.round(p.masteryPoints / 1000))} k points de maîtrise` : ""}).` });
  }
  if (p.meta && metaAdj >= 51.5) r.push({ w: (metaAdj - 50) * 2.5, text: `Fort dans la méta Émeraude+ : ${nf(p.meta.winRate, 1)} % sur ${nf(p.meta.games)} parties.` });
  if (p.meta && metaAdj <= 48.5) r.push({ w: (50 - metaAdj) * 2.5, text: `En difficulté dans la méta : ${nf(p.meta.winRate, 1)} % en Émeraude+.` });
  if (!p.meta) r.push({ w: 1, text: "Pas encore de données de méta pour lui dans ce rôle." });
  const old = current == null ? 0 : p.seasons.filter((s) => s.season < current).reduce((s, x) => s + x.games, 0);
  if (old > p.games / 2) r.push({ w: 4, text: `Surtout joué les saisons précédentes : ces parties comptent moins.` });
  return top(r);
}

function tryReasons(p: TryPick, c: Champion, near: Champion | undefined, sim: number, metaAdj: number, l: Learning, profile: PlayProfile, st: ChampStyle | undefined, fit: number): string[] {
  const r: { w: number; text: string }[] = [];
  if (near && sim >= SIMILAR) r.push({ w: sim * 10, text: `Proche de ${near.name}, un de tes meilleurs champions : ${describe(c)}.` });
  if (metaAdj >= 51) r.push({ w: (metaAdj - 50) * 2.5, text: `${nf(p.meta.winRate, 1)} % de victoires en Émeraude+ (${nf(p.meta.games)} parties).` });
  if (l.games != null && l.games <= 30) {
    r.push({ w: l.games <= 10 ? 6 : 4, text: l.novice && l.novice.games >= 10
      ? `Rapide à prendre en main : ceux qui le découvrent gagnent déjà ${nf(l.novice.winRate)} %.`
      : `Rapide à prendre en main (${learningLabel(l)}).` });
  }
  if (p.tried) r.push({ w: 9, text: `Tu l'as déjà joué ${p.tried.games} fois (${p.tried.wins} victoire${p.tried.wins > 1 ? "s" : ""}) : pas encore assez pour ton pool.` });
  if (l.games != null && l.games > 100) r.push({ w: 3, text: "Long à maîtriser : prévois de nombreuses parties avant d'être à l'aise." });
  if (st && fit > 0.3) {
    r.push({ w: fit * 7, text: profile.style === "early"
      ? `Champion d'early game, comme ton style${profile.kp15 != null ? ` (tu participes à ${nf(profile.kp15)} % des kills avant 15 min)` : ""}.`
      : "Champion qui monte en puissance, comme ton style (tu gagnes plus souvent les parties longues)." });
  }
  const out = top(r);
  return out.length ? out : [`${describe(c)[0].toUpperCase()}${describe(c).slice(1)}.`];
}
