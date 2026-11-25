// Suivi de tes objectifs (jungle) : mesures par partie tirées du détail anonyme, comparaison « depuis le début du
// suivi » contre « les 4 semaines d'avant », et valeur semaine par semaine. Fonctions pures.
import type { Detail } from "../collector/detail.ts";

const MIN = 60_000;
/**
 * Fosse du dragon (Faille de l'invocateur). Ta présence se mesure dans la minute qui précède la prise du premier
 * dragon (par l'une ou l'autre équipe) : sur tes parties 2026, ton équipe le prend alors dans 68 % des cas, contre
 * 33 % quand tu n'y es pas. Ta position à l'apparition (5:00) ne le prédisait pas (47 % contre 53 %).
 */
export const DRAGON_PIT = { x: 9_950, y: 4_500 };
/** « Près du dragon » : à moins de cette distance de la fosse (environ un écran et demi). */
export const DRAGON_NEAR = 3_000;
const DAY = 86_400_000;
/** En dessous : pas de conclusion. */
export const MIN_GAMES = 20;

/** Mesures d'une de tes parties de jungle. */
export interface GameMetrics {
  start: number;
  win: boolean;
  championId: number;
  deaths15: number;
  /** Ton CS à 10 min, et l'écart avec le jungler adverse (null sans chronologie). */
  cs10: number | null;
  cs10diff: number | null;
  firstDragon: boolean;
  /** Ton équipe prend au moins 2 Voidgrubs sur 3. */
  grubs: boolean;
  /** Tes morts dans la minute qui précède un objectif pris par l'adversaire. */
  deathsBeforeObj: number;
  /** Tu es près de la fosse dans la minute qui précède la prise du premier dragon ; null si aucun dragon ou position manquante. */
  dragonPresence: boolean | null;
  /** Tes morts avant 15 min, seul (aucun allié à moins de 1 500 unités), dans la jungle adverse ou la rivière. */
  soloDeaths: number;
  /** Objectifs (dragon, Voidgrubs, Héraut) pris par l'adversaire, et ceux sans contrepartie pour ton équipe. */
  ceded: number;
  uncompensated: number;
  /** Idem pour les seuls objectifs cédés avant 15 min (moins influencés par l'issue de la partie). */
  cededEarly: number;
  uncompensatedEarly: number;
}

export const OBJECTIVES = new Set(["DRAGON", "HORDE", "RIFTHERALD"]);
/** Zone d'une position pour ton équipe (base bleue en bas à gauche ; la rivière suit x + y ≈ 14 700). */
export function zoneOf(p: { x: number; y: number }, team: number): "base" | "lane" | "river" | "own" | "enemy" {
  const { x, y } = p;
  if ((x < 3500 && y < 3500) || (x > 11300 && y > 11300)) return "base";
  if ((x < 3000 && y > 4500) || (y > 12000 && x < 10300) || (y < 3000 && x > 4500) || (x > 12000 && y < 10300) || Math.abs(x - y) < 1600) return "lane";
  const sum = x + y;
  if (Math.abs(sum - 14_700) < 1_500) return "river";
  return (team === 100) === (sum < 14_700) ? "own" : "enemy";
}

type Ev = Num & { type?: unknown; timestamp?: unknown };
/**
 * Objectifs adverses (Voidgrubs regroupés : même type à moins de 90 s) et, pour chacun, une contrepartie de ton
 * équipe dans la minute avant ou après : un objectif, une tour (ou un inhibiteur), ou plus de kills que l'adversaire.
 */
export function trades(events: Ev[], team: number, teamOf: Map<number, number>, beforeMs = Infinity): { ceded: number; uncompensated: number } {
  const taken: { t: number; type: string }[] = [];
  for (const e of events) {
    if (e.type !== "ELITE_MONSTER_KILL" || !OBJECTIVES.has(String(e.monsterType)) || n(e.killerTeamId) === team || n(e.timestamp) >= beforeMs) continue;
    const last = taken.at(-1);
    if (last && last.type === e.monsterType && n(e.timestamp) - last.t < 90_000) continue;
    taken.push({ t: n(e.timestamp), type: String(e.monsterType) });
  }
  let uncompensated = 0;
  for (const o of taken) {
    const w = events.filter((e) => Math.abs(n(e.timestamp) - o.t) <= MIN);
    const obj = w.some((e) => e.type === "ELITE_MONSTER_KILL" && n(e.killerTeamId) === team);
    const building = w.some((e) => e.type === "BUILDING_KILL" && n(e.teamId) !== team); // teamId : équipe qui perd le bâtiment
    const kills = w.filter((e) => e.type === "CHAMPION_KILL" && n(e.killerId) > 0);
    const ours = kills.filter((e) => teamOf.get(n(e.killerId)) === team).length;
    if (!obj && !building && ours <= kills.length - ours) uncompensated++;
  }
  return { ceded: taken.length, uncompensated };
}

type Num = Record<string, unknown>;
const n = (v: unknown) => (typeof v === "number" ? v : 0);

export function gameMetrics(d: Detail): GameMetrics | null {
  const me = d.match.parts.find((p) => p.me);
  // Sans chronologie (rare, parties anciennes) : mesures inconnues, la partie n'est pas suivie.
  if (!me || me.teamPosition !== "JUNGLE" || me.gameEndedInEarlySurrender || d.match.queue !== 420 || !d.timeline) return null;
  const pid = n(me.participantId), team = n(me.teamId);
  const ej = d.match.parts.find((p) => n(p.teamId) !== team && p.teamPosition === "JUNGLE");
  const events = d.timeline.frames.flatMap((f) => f.e);
  const deaths = events.filter((e) => e.type === "CHAMPION_KILL" && e.victimId === pid);
  const enemyObj = events.filter((e) => e.type === "ELITE_MONSTER_KILL" && n(e.killerTeamId) !== team);
  const f10 = d.timeline.frames.find((f) => Math.abs(f.t - 10 * MIN) <= 30_000);
  const cs = (p?: Num) => (p ? n(p.minionsKilled) + n(p.jungleMinionsKilled) : null);
  const a = cs(f10?.p[String(pid)]), b = ej ? cs(f10?.p[String(ej.participantId)]) : null;
  const obj = (d.match.teams.find((t) => n(t.teamId) === team)?.objectives ?? {}) as Record<string, { first?: boolean; kills?: number }>;
  return {
    start: d.match.start,
    win: !!me.win,
    championId: n(me.championId),
    deaths15: deaths.filter((e) => n(e.timestamp) < 15 * MIN).length,
    cs10: a,
    cs10diff: a != null && b != null ? a - b : null,
    firstDragon: !!obj.dragon?.first,
    grubs: (obj.horde?.kills ?? 0) >= 2,
    dragonPresence: (() => {
      const first = events.find((e) => e.type === "ELITE_MONSTER_KILL" && e.monsterType === "DRAGON");
      if (!first) return null;
      // Image de la minute entamée avant la prise (ex. prise à 7:16 → ta position à 7:00).
      const minute = Math.floor(n(first.timestamp) / MIN);
      const pos = d.timeline.frames.find((f) => Math.abs(f.t - minute * MIN) <= 30_000)?.p[String(pid)]?.position as { x: number; y: number } | undefined;
      return pos ? Math.hypot(pos.x - DRAGON_PIT.x, pos.y - DRAGON_PIT.y) <= DRAGON_NEAR : null;
    })(),
    soloDeaths: (() => {
      const allies = d.match.parts.filter((x) => n(x.teamId) === team && n(x.participantId) !== pid).map((x) => String(x.participantId));
      return deaths.filter((e) => {
        const pos = e.position as { x: number; y: number } | undefined;
        if (!pos || n(e.timestamp) >= 15 * MIN) return false;
        const z = zoneOf(pos, team);
        if (z !== "enemy" && z !== "river") return false;
        const fr = d.timeline!.frames.reduce((best, x) => (Math.abs(x.t - n(e.timestamp)) < Math.abs(best.t - n(e.timestamp)) ? x : best));
        return !allies.some((a) => { const q = fr.p[a]?.position as { x: number; y: number } | undefined; return q && Math.hypot(q.x - pos.x, q.y - pos.y) < 1_500; });
      }).length;
    })(),
    ...trades(events as Ev[], team, new Map(d.match.parts.map((x) => [n(x.participantId), n(x.teamId)]))),
    ...(() => { const t = trades(events as Ev[], team, new Map(d.match.parts.map((x) => [n(x.participantId), n(x.teamId)])), 15 * MIN); return { cededEarly: t.ceded, uncompensatedEarly: t.uncompensated }; })(),
    deathsBeforeObj: deaths.filter((e) => enemyObj.some((o) => n(o.timestamp) > n(e.timestamp) && n(o.timestamp) - n(e.timestamp) <= MIN)).length,
  };
}

export interface GoalMetric {
  key: string;
  label: string;
  unit: string;
  better: "+" | "-";
  target: number;
  /** « moyenne » ou « part des parties » (%). */
  kind: "mean" | "share";
  /** Mesure d'information : affichée sans cible, avec la raison. */
  info?: boolean;
  note?: string;
  value: (g: GameMetrics) => number | boolean | null;
}

export interface Goal {
  key: string; label: string; main?: boolean; metrics: GoalMetric[]; exercise: string;
  /** Suivi chaque semaine (tranchable en 20 à 30 parties) ou chaque mois (résultats à long terme). */
  horizon: "week" | "month";
}

/**
 * Objectifs par défaut, d'après tes 163 parties de jungle 2026 (25/11/2026). Ceux de la semaine se tranchent en
 * 20 à 30 parties (écart à la cible d'environ 0,4 écart-type) ; les résultats à long terme se suivent chaque mois.
 * - objectifs cédés avant 15 min sans contrepartie : 49 % ± 7 en 2026 (écart-type 41), 57 % sur les 20 dernières
 *   → 35 %. Lien avec la victoire : 58 % ± 13 (tout compensé, 50 parties) contre 33 % ± 9 (93 parties). Sur toute
 *   la partie, l'écart (86 % contre 32 %) est gonflé par l'issue de la partie : l'équipe qui gagne prend les
 *   objectifs tardifs. À écart d'or comparable à 15 min, trop peu de parties pour conclure ;
 * - morts dans la minute avant un objectif adverse : 1,3 → 0,9 ; CS à 10 min : 68 → 72 (médiane Émeraude+ 2026 : 71) ;
 * - long terme : morts avant 15 min 2,0 → 1,2 ; 3 morts ou plus 34 % → 10 % ; premier dragon 52 % → 62 %.
 * Morts seul en jungle adverse ou rivière (0,52 par partie) : pour information, elles pèsent peu sur la victoire
 * (49 % sans, 46 % avec).
 */
export const DEFAULT_GOALS: Goal[] = [
  {
    key: "trades", label: "Échanger chaque objectif cédé", main: true, horizon: "week",
    exercise: "Quand un objectif ne peut pas être disputé (pas de priorité, adversaires déjà dessus), n'y va pas : prends tout de suite le côté opposé (Voidgrubs ou Héraut contre dragon, une tour avec la lane qui a la priorité, ou les camps adverses de l'autre côté) et préviens l'équipe par un ping ou un message avant de partir.",
    metrics: [
      { key: "uncompensatedEarly", label: "Objectifs cédés avant 15 min sans contrepartie", unit: " %", better: "-", target: 35, kind: "mean",
        value: (g) => (g.cededEarly ? (g.uncompensatedEarly / g.cededEarly) * 100 : null) },
      { key: "uncompensated", label: "Sur toute la partie", unit: " %", better: "-", target: 0, kind: "mean", info: true,
        note: "gonflée par l'issue de la partie : l'équipe qui gagne prend les objectifs tardifs",
        value: (g) => (g.ceded ? (g.uncompensated / g.ceded) * 100 : null) },
    ],
  },
  {
    key: "beforeObj", label: "Ne pas mourir juste avant un objectif adverse", horizon: "week",
    exercise: "Une minute avant chaque apparition d'objectif : base si besoin, balise de contrôle du côté de l'objectif, et pas de combat dans la rivière sans priorité.",
    metrics: [
      { key: "deathsBeforeObj", label: "Morts dans la minute avant un objectif adverse", unit: "", better: "-", target: 0.9, kind: "mean", value: (g) => g.deathsBeforeObj },
    ],
  },
  {
    key: "cs10", label: "Plus de CS à 10 min", horizon: "week",
    exercise: "Clear complet propre avant le premier gank, puis repasse par tes camps entre deux actions : vise environ 7 CS par minute jusqu'à 10 min.",
    metrics: [
      { key: "cs10", label: "CS à 10 min", unit: "", better: "+", target: 72, kind: "mean", value: (g) => g.cs10 },
    ],
  },
  {
    key: "deaths", label: "Mourir moins avant 15 min", horizon: "month",
    exercise: "Résultat de tes objectifs de la semaine (échanges d'objectifs, morts avant un objectif).",
    metrics: [
      { key: "deaths15", label: "Morts avant 15 min", unit: "", better: "-", target: 1.2, kind: "mean", value: (g) => g.deaths15 },
      { key: "deaths15plus", label: "Parties avec 3 morts ou plus avant 15 min", unit: " %", better: "-", target: 10, kind: "share", value: (g) => g.deaths15 >= 3 },
      // Pèse peu sur la victoire en 2026 : information seulement.
      { key: "soloDeaths", label: "Morts seul dans la jungle adverse ou la rivière avant 15 min", unit: "", better: "-", target: 0, kind: "mean", info: true,
        note: "pèse peu sur la victoire en 2026 (49 % sans, 46 % avec)", value: (g) => g.soloDeaths },
    ],
  },
  {
    key: "dragon", label: "Premier dragon", horizon: "month",
    exercise: "Résultat d'équipe : il suit tes échanges d'objectifs et ta présence au bon moment.",
    metrics: [
      { key: "firstDragon", label: "Premier dragon pris par ton équipe", unit: " %", better: "+", target: 62, kind: "share", value: (g) => g.firstDragon },
      // En partie circulaire (souvent, c'est toi qui le smites) : information seulement.
      { key: "dragonPresence", label: "Près de la fosse dans la minute avant la prise du 1er dragon", unit: " %", better: "+", target: 0, kind: "share", info: true,
        note: "en partie circulaire : souvent, c'est toi qui le smites", value: (g) => g.dragonPresence },
    ],
  },
];

export interface Stat { value: number | null; margin: number | null; n: number }

/** Moyenne (± 95 %) ou part des parties en % (± Wilson 95 %). */
export function stat(m: GoalMetric, games: GameMetrics[]): Stat {
  const vals = games.map((g) => m.value(g)).filter((v): v is number | boolean => v != null);
  const k = vals.length;
  if (!k) return { value: null, margin: null, n: 0 };
  if (m.kind === "share") {
    const w = vals.filter(Boolean).length, z = 1.96, p = w / k, d = 1 + z * z / k;
    const h = (z * Math.sqrt(p * (1 - p) / k + z * z / (4 * k * k))) / d;
    return { value: p * 100, margin: h * 100, n: k };
  }
  const xs = vals.map(Number), mean = xs.reduce((s, v) => s + v, 0) / k;
  const sd = k > 1 ? Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (k - 1)) : 0;
  return { value: mean, margin: k > 1 ? (1.96 * sd) / Math.sqrt(k) : null, n: k };
}

export interface GoalMetricView {
  key: string; label: string; unit: string; better: "+" | "-"; target: number;
  /**
   * Parties « depuis » encore nécessaires pour savoir si tu es du bon côté de la cible, d'après la variabilité
   * actuelle : 0 si c'est déjà tranché ; null si ta valeur est trop proche de la cible pour trancher.
   */
  needed: number | null;
  before: Stat;
  since: Stat;
  /** L'écart est-il net (marges qui ne se chevauchent pas, et au moins MIN_GAMES parties de chaque côté) ? */
  clear: boolean;
  reached: boolean | null;
  /** Mesure d'information (sans cible), et sa raison. */
  info: boolean;
  note: string | null;
  /** Semaine par semaine (objectifs de la semaine) ou mois par mois (long terme) depuis le début du suivi. */
  periods: { label: string; stat: Stat }[];
}

export interface GoalsView {
  startMs: number;
  /** Période de référence : les 4 semaines d'avant, étendue aux 20 dernières parties d'avant s'il y en a moins. */
  baseline: { fromMs: number; games: number; extended: boolean };
  sinceGames: number;
  goals: { key: string; label: string; main: boolean; exercise: string; horizon: "week" | "month"; metrics: GoalMetricView[] }[];
}

/**
 * Parties « depuis » nécessaires pour savoir si tu es au-dessus ou en dessous de la cible : la marge à 95 % (qui
 * décroît en 1/√n) doit devenir plus petite que l'écart entre ta valeur et la cible (et au moins MIN_GAMES parties).
 * Ta valeur : celle depuis le début du suivi (au moins 5 parties), sinon celle d'avant.
 */
export function neededGames(m: GoalMetric, beforeGames: GameMetrics[], sinceGames: GameMetrics[], b: Stat, s: Stat, target: number): number | null {
  const all = [...beforeGames, ...sinceGames].map((g) => m.value(g)).filter((v): v is number | boolean => v != null);
  const value = s.n >= 5 ? s.value : b.value;
  if (all.length < 2 || value == null) return null;
  let sd: number;
  if (m.kind === "share") { const p = all.filter(Boolean).length / all.length; sd = Math.sqrt(p * (1 - p)) * 100; }
  else { const xs = all.map(Number), mu = xs.reduce((x, v) => x + v, 0) / xs.length; sd = Math.sqrt(xs.reduce((x, v) => x + (v - mu) ** 2, 0) / (xs.length - 1)); }
  const gap = Math.abs(value - target);
  // Trop proche de la cible (moins d'un dixième d'écart-type) : il faudrait des centaines de parties.
  if (sd === 0 || gap < sd / 10) return null;
  const n = Math.max(MIN_GAMES, Math.ceil((1.96 * sd / gap) ** 2));
  return Math.max(0, n - s.n);
}

export function goalsView(all: GameMetrics[], startMs: number, goals: Goal[] = DEFAULT_GOALS, targets: Record<string, number> = {}): GoalsView {
  const sorted = [...all].sort((a, b) => a.start - b.start);
  const since = sorted.filter((g) => g.start >= startMs);
  let before = sorted.filter((g) => g.start < startMs && g.start >= startMs - 28 * DAY);
  let extended = false;
  if (before.length < MIN_GAMES) {
    before = sorted.filter((g) => g.start < startMs).slice(-MIN_GAMES);
    extended = true;
  }
  const lastStart = Math.max(startMs, ...since.map((g) => g.start));
  const weeks: { label: string; games: GameMetrics[] }[] = [];
  for (let w = startMs; w <= lastStart; w += 7 * DAY) {
    const gs = since.filter((g) => g.start >= w && g.start < w + 7 * DAY);
    weeks.push({ label: `semaine du ${new Date(w).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`, games: gs });
  }
  const months: { label: string; games: GameMetrics[] }[] = [];
  for (let d = new Date(startMs); d.getTime() <= lastStart; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const from = d.getTime(), to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    months.push({ label: d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }), games: since.filter((g) => g.start >= from && g.start < to) });
  }
  return {
    startMs,
    baseline: { fromMs: before[0]?.start ?? startMs, games: before.length, extended },
    sinceGames: since.length,
    goals: goals.map((g) => ({
      key: g.key, label: g.label, main: !!g.main, exercise: g.exercise, horizon: g.horizon,
      metrics: g.metrics.map((m) => {
        const target = targets[m.key] ?? m.target;
        const b = stat(m, before), s = stat(m, since);
        const clear = b.n >= MIN_GAMES && s.n >= MIN_GAMES && b.value != null && s.value != null && b.margin != null && s.margin != null
          && Math.abs(s.value - b.value) > b.margin + s.margin;
        const reached = !m.info && s.n >= MIN_GAMES && s.value != null ? (m.better === "-" ? s.value <= target : s.value >= target) : null;
        return {
          key: m.key, label: m.label, unit: m.unit, better: m.better, target, before: b, since: s, clear, reached, info: !!m.info, note: m.note ?? null,
          needed: m.info ? null : neededGames(m, before, since, b, s, target),
          periods: (g.horizon === "week" ? weeks : months).map((w) => ({ label: w.label, stat: stat(m, w.games) })),
        };
      }),
    })),
  };
}
