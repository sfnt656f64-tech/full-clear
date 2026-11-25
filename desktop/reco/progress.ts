// Potentiel de progression d'un champion (mode « Progresser sur de nouveaux champions »). Fonctions pures.
//
// Score = 55 % force à maîtrise égale + 45 % accord avec tes points forts. La durée d'apprentissage est à 0 % tant
// que les courbes des groupes moyen et difficile ne se distinguent pas ; elle est mesurée sans la tranche ≥ 200 k
// points (surtout de la sélection : les joueurs qui ont fait du champion leur spécialité). La difficulté Riot est
// affichée en information.
// Sur un champion où tu as déjà joué, ton score de stats y est mélangé au potentiel : moitié-moitié à 20 parties.
// Le plafond (forte maîtrise sur le champion contre forte maîtrise sur les autres junglers) n'est qu'affiché, tant
// qu'il n'est pas mesurable (4 écarts nets sur 29 champions mesurables : à peine plus que le hasard).
//
// Données : points de maîtrise des junglers de la méta, lus à la collecte (au plus ~2 semaines après la partie).
// Les nombres de parties sont tirés des points (≈ 1 000 à 1 500 points par partie) : toujours en fourchette.

export const BUCKETS = [0, 10_000, 30_000, 60_000, 100_000, 200_000, Infinity] as const;
export const POINTS_PER_GAME = { low: 1_000, high: 1_500 } as const;
export const WEIGHTS = { force: 0.55, fit: 0.45, learning: 0 } as const;
/** Tes parties sur le champion pour que ton score de stats y pèse autant que le potentiel. */
export const MINE_HALF = 20;
/** Parties avec maîtrise sur le champion pour que sa correction de maîtrise soit mesurée (sinon : « à confirmer »). */
export const MIX_MEASURED_MIN = 100;
/** Accord : parties de méta « fictives » sans effet (un accord tiré de peu de parties reste proche de 50). */
export const K_FIT = 300;
/** Parties « fictives » au niveau du groupe, par tranche : rapproche la courbe d'un champion de celle de son groupe. */
export const K_BUCKET = 20;
/** Plafond : parties à forte maîtrise minimales, et seuil de forte maîtrise. */
export const CAP_MIN = 20;
export const HIGH_MASTERY = 100_000;
/** Atteint le niveau des joueurs expérimentés : à moins de 2 points de leur win rate. */
export const REACH_TOLERANCE = 2;

export type DiffGroup = "easy" | "medium" | "hard";
export const GROUP_LABEL: Record<DiffGroup, string> = { easy: "facile (difficulté Riot 1–3)", medium: "moyen (4–6)", hard: "difficile (7–10)" };
export const difficultyGroup = (d: number): DiffGroup => (d <= 3 ? "easy" : d <= 6 ? "medium" : "hard");

export interface MasteryRow { championId: number; win: boolean; points: number }
interface Rate { n: number; w: number }
const rate = (rows: { win: boolean }[]): Rate => ({ n: rows.length, w: rows.filter((r) => r.win).length });
const pct = (r: Rate) => (r.n ? (r.w / r.n) * 100 : NaN);
export const wilson = (w: number, n: number): number => {
  if (!n) return 100;
  const z = 1.96, p = w / n, d = 1 + z * z / n;
  return ((z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d) * 100;
};
const bucketOf = (points: number) => BUCKETS.findIndex((b, i) => points >= b && points < BUCKETS[i + 1]);

/** Régression isotone (pondérée) : courbe croissante la plus proche des points (on n'apprend pas « à reculons »). */
export function isotonic(ys: number[], ws: number[]): number[] {
  const blocks = ys.map((y, i) => ({ y, w: ws[i], n: 1 }));
  for (let i = 0; i < blocks.length - 1;) {
    if (blocks[i].y > blocks[i + 1].y) {
      const a = blocks[i], b = blocks[i + 1];
      blocks.splice(i, 2, { y: (a.y * a.w + b.y * b.w) / (a.w + b.w), w: a.w + b.w, n: a.n + b.n });
      if (i > 0) i--;
    } else i++;
  }
  return blocks.flatMap((b) => Array(b.n).fill(b.y));
}

export interface Curve {
  /** Win rate par tranche de points (rapproché du groupe, puis rendu croissant), et parties réelles par tranche. */
  points: { wr: number; n: number }[];
  /** Win rate des joueurs expérimentés du champion (100 à 200 k points ; au-delà, surtout de la sélection). */
  plateau: number;
  /** Tranche où la courbe atteint le plateau (à REACH_TOLERANCE près). */
  reach: number;
  /** Parties pour y arriver, en fourchette (points de la tranche ÷ 1 500 à 1 000 points par partie). */
  games: [number, number];
  /** Parties de méta avec maîtrise sur le champion ; « propre » s'il en a au moins 100. */
  n: number;
  own: boolean;
}

/** Parties avec maîtrise minimales pour une courbe propre au champion (sinon : celle de son groupe). */
export const OWN_CURVE_MIN = 100;

/**
 * Courbe d'apprentissage d'un champion : la sienne (rapprochée de son groupe tranche par tranche) s'il a au moins
 * 100 parties avec maîtrise ; sinon celle de son groupe de difficulté seule (avec 10 à 40 parties, la tranche
 * « expérimentés » d'un champion ne dépend que du hasard).
 */
export function learningCurve(champRows0: MasteryRow[], groupRows: MasteryRow[]): Curve {
  const nb = BUCKETS.length - 1;
  const champRows = champRows0.length >= OWN_CURVE_MIN ? champRows0 : [];
  const g = Array.from({ length: nb }, (_, b) => rate(groupRows.filter((r) => bucketOf(r.points) === b)));
  const c = Array.from({ length: nb }, (_, b) => rate(champRows.filter((r) => bucketOf(r.points) === b)));
  const raw = c.map((x, b) => (x.w + (K_BUCKET * (pct(g[b]) || 50)) / 100) / (x.n + K_BUCKET) * 100);
  const fit = isotonic(raw, c.map((x) => x.n + K_BUCKET));
  // Niveau des joueurs expérimentés : la dernière tranche avant 200 k points (au-delà, surtout de la sélection).
  const plateau = fit[nb - 2];
  const reach = fit.findIndex((y) => y >= plateau - REACH_TOLERANCE);
  const lo = BUCKETS[reach], hi = Math.min(BUCKETS[reach + 1], BUCKETS[nb - 1] * 1.5);
  return {
    points: fit.map((wr, b) => ({ wr, n: c[b].n })), plateau, reach,
    games: [Math.round(lo / POINTS_PER_GAME.high), Math.round(hi / POINTS_PER_GAME.low)],
    n: champRows0.length, own: champRows0.length >= OWN_CURVE_MIN,
  };
}

/** Force : parties « fictives » à 50 % (une force tirée de peu de parties reste proche de la moyenne). */
export const K_FORCE = 300;

export interface Force {
  /** Win rate brut (méta, plusieurs patchs), parties, marge. */
  raw: number; games: number; margin: number;
  /** Effet de la part de débutants : win rate attendu avec la maîtrise des joueurs du champion, moins celui avec la
   *  maîtrise moyenne du groupe (négatif : beaucoup de débutants, ce qui tire le win rate brut vers le bas). */
  mix: number;
  /** Force à maîtrise égale = brut − effet de la maîtrise, puis rapprochée de 50 % selon le nombre de parties. */
  adjusted: number;
  /** Part de débutants mesurée sur le champion lui-même (sinon tirée de son groupe : « à confirmer »). */
  mixMeasured: boolean;
}

/** Force du champion à maîtrise égale (corrige la part de débutants, par groupe de difficulté). */
export function forceAtEqualMastery(meta: Rate, champRows: MasteryRow[], groupRows: MasteryRow[]): Force {
  const nb = BUCKETS.length - 1;
  const gRate = Array.from({ length: nb }, (_, b) => pct(rate(groupRows.filter((r) => bucketOf(r.points) === b))) || 50);
  const share = (rows: MasteryRow[]) => Array.from({ length: nb }, (_, b) => rows.filter((r) => bucketOf(r.points) === b).length / Math.max(1, rows.length));
  // Part par tranche du champion, rapprochée de celle du groupe s'il a peu de parties avec maîtrise.
  const sc = share(champRows), sg = share(groupRows), k = 30;
  const mixC = sc.map((s, b) => (s * champRows.length + sg[b] * k) / (champRows.length + k));
  const expected = (sh: number[]) => sh.reduce((t, s, b) => t + s * gRate[b], 0);
  const mix = expected(mixC) - expected(sg);
  const raw = pct(meta);
  const eq = raw - mix;
  return { raw, games: meta.n, margin: wilson(meta.w, meta.n), mix, adjusted: (eq * meta.n + 50 * K_FORCE) / (meta.n + K_FORCE), mixMeasured: champRows.length >= MIX_MEASURED_MIN };
}

export interface Ceiling { delta: number; margin: number; games: number; measurable: boolean }
/** Plafond (information) : forte maîtrise sur le champion contre forte maîtrise sur les autres junglers. */
export function ceiling(champRows: MasteryRow[], otherRows: MasteryRow[]): Ceiling {
  const me = rate(champRows.filter((r) => r.points >= HIGH_MASTERY)), others = rate(otherRows.filter((r) => r.points >= HIGH_MASTERY));
  return { delta: pct(me) - pct(others), margin: Math.hypot(wilson(me.w, me.n), wilson(others.w, others.n)), games: me.n, measurable: me.n >= CAP_MIN };
}

/** Partie de méta sur un champion : victoire et position (0–100) sur chaque axe du radar. */
export interface AxisGame { win: boolean; axes: (number | null)[] }
export interface AxisImpact { hi: Rate; lo: Rate }

/** Sur chaque axe : victoires quand le joueur est au-dessus de la médiane sur cet axe, et en dessous. */
export function axisImpact(games: AxisGame[], nAxes: number): AxisImpact[] {
  return Array.from({ length: nAxes }, (_, i) => ({
    hi: rate(games.filter((g) => g.axes[i] != null && g.axes[i]! >= 50)),
    lo: rate(games.filter((g) => g.axes[i] != null && g.axes[i]! < 50)),
  }));
}

export interface Fit { value: number; margin: number; games: number; axes: { axis: number; effect: number }[] }

/**
 * Accord avec tes points forts : à quel point être fort sur TES axes forts fait gagner sur ce champion, par rapport
 * aux autres junglers. Sur chaque axe où tu es au-dessus de la médiane : (win rate des joueurs du champion forts sur
 * cet axe − ceux faibles sur cet axe), moins le même écart pour tous les junglers ; pondéré par ton avance sur l'axe.
 * Ce n'est ni la ressemblance avec tes champions habituels, ni le fait que le champion ait « naturellement » beaucoup
 * de survie ou de teamfight. Rapproché de 0 avec peu de parties (K_FIT), avec sa marge.
 * Attention : sur les axes mesurés sur toute la partie (Teamfight), l'écart suit en partie l'issue de la partie ;
 * la soustraction de l'écart de tous les junglers en retire la part commune.
 */
export function strengthFit(user: (number | null)[], champ: AxisImpact[], all: AxisImpact[]): Fit {
  const gap = (x: AxisImpact) => pct(x.hi) - pct(x.lo);
  const m = (x: AxisImpact) => Math.hypot(wilson(x.hi.w, x.hi.n), wilson(x.lo.w, x.lo.n));
  let num = 0, den = 0, var2 = 0, games = 0;
  const axes: Fit["axes"] = [];
  user.forEach((u, i) => {
    if (u == null || u <= 50 || !champ[i] || !(champ[i].hi.n + champ[i].lo.n)) return;
    const n = champ[i].hi.n + champ[i].lo.n;
    const shrink = n / (n + K_FIT);
    const effect = Number.isFinite(gap(champ[i])) ? (gap(champ[i]) - gap(all[i])) * shrink : 0;
    axes.push({ axis: i, effect });
    num += (u - 50) * effect;
    den += u - 50;
    var2 += ((u - 50) * m(champ[i]) * shrink) ** 2;
    games = Math.max(games, n);
  });
  return den ? { value: num / den, margin: Math.sqrt(var2) / den, games, axes } : { value: 0, margin: 0, games, axes };
}

export interface PotentialParts { force: Force; fit: Fit; curve: Curve; ceiling: Ceiling }
export interface PotentialScore {
  /** Score final : potentiel, mélangé à ton score de stats sur le champion si tu y as déjà joué. */
  total: number;
  potential: number; force: number; fit: number; learning: number;
  /** Ton score de stats sur le champion (0–100, même échelle), ses parties et son poids dans le total. */
  mine: { score: number; games: number; weight: number } | null;
}

/** Notes sur 100 de chaque critère, puis total pondéré. */
export function potentialScore(p: PotentialParts, mine?: { stats: number; games: number } | null): PotentialScore {
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  // Force : ±10 points de win rate autour de 50 % couvrent toute l'échelle.
  const force = clamp(50 + (p.force.adjusted - 50) * 5);
  // Accord : ±10 points de win rate d'écart sur tes axes forts couvrent toute l'échelle.
  const fit = clamp(50 + p.fit.value * 5);
  // Durée : 5 parties → 100, 300 parties → 0 (échelle logarithmique), au milieu de la fourchette.
  const mid = Math.max(1, (p.curve.games[0] + p.curve.games[1]) / 2);
  const learning = clamp(100 - (100 * Math.log10(mid / 5)) / Math.log10(300 / 5));
  const potential = WEIGHTS.force * force + WEIGHTS.fit * fit + WEIGHTS.learning * learning;
  // Tes résultats sur le champion : la preuve la plus directe ; leur poids monte avec tes parties (½ à 20 parties).
  // Même échelle que la force : stats 40 → 0, 50 → 50, 60 → 100.
  const m = mine && mine.games > 0 ? { score: clamp(50 + (mine.stats - 50) * 5), games: mine.games, weight: mine.games / (mine.games + MINE_HALF) } : null;
  const total = m ? m.weight * m.score + (1 - m.weight) * potential : potential;
  return { total, potential, force, fit, learning, mine: m };
}

export interface FirstGames { champions: number; first: number; after: number; diff: number; margin: number; n1: number; n2: number }
/**
 * Ta vitesse d'apprentissage : tes 10 premières parties sur un champion contre les suivantes (comptes fusionnés,
 * ordre chronologique), sur les champions découverts pendant l'historique et joués au moins 20 fois.
 * `score` : ta position face à ton adversaire direct (0–100), comparable d'une saison à l'autre.
 */
export function firstGamesEffect(byChampion: { score: number | null }[][]): FirstGames | null {
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const per = byChampion.filter((gs) => gs.length >= 20).map((gs) => {
    const a = gs.slice(0, 10).flatMap((g) => (g.score == null ? [] : [g.score])), b = gs.slice(10).flatMap((g) => (g.score == null ? [] : [g.score]));
    return { a, b };
  }).filter((x) => x.a.length && x.b.length);
  if (per.length < 2) return null;
  const diffs = per.map((x) => mean(x.b) - mean(x.a));
  const md = mean(diffs);
  const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - md) ** 2, 0) / (diffs.length - 1));
  return { champions: per.length, first: mean(per.flatMap((x) => x.a)), after: mean(per.flatMap((x) => x.b)), diff: md, margin: (1.96 * sd) / Math.sqrt(diffs.length), n1: per.reduce((s, x) => s + x.a.length, 0), n2: per.reduce((s, x) => s + x.b.length, 0) };
}
