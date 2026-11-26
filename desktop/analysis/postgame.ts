// Analyse d'après-partie : une partie terminée (classée ou normale en draft), lue dans l'API quelques minutes après la
// fin. Rien ne sert pendant la partie (règles Riot) : c'est un bilan, qui ne tire aucune conclusion d'une seule partie.
// Fonctions pures.
import { champByKey } from "../../src/data/champions";
import type { Detail } from "../collector/detail.ts";
import { METRICS, type AnalysisGame, type Metric } from "./analysis.ts";
import { gameRank, type MetaRef } from "./overview.ts";
import type { GameMetrics } from "./goals.ts";

const MIN = 60_000;
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const mmss = (ms: number) => `${Math.floor(ms / MIN)}:${String(Math.floor((ms % MIN) / 1000)).padStart(2, "0")}`;
const name = (id: number) => champByKey(id)?.name ?? `#${id}`;
const fmt = (v: number, unit: string) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: unit.trim() === "%" || Math.abs(v) >= 100 ? 0 : 1 })}${unit}`;

/** Mesures comparées au jungler adverse (avant 15 min surtout : moins liées à l'issue de la partie). */
export const VS_KEYS = ["cs10", "gd10", "xd10", "gd15", "kp15", "deaths15", "solo15", "obj15", "unc15", "kpLate", "dmgShare"] as const;
/** Écarts avec l'adversaire direct : une seule valeur (positive : en ta faveur). */
export const DIFF_KEYS = new Set(["gd10", "xd10", "gd15"]);
/**
 * Points à travailler : seulement les mesures retenues (avant 15 min, plus les CS à 15 min). Pas les morts par
 * 10 min (suivent l'issue de la partie), ni l'or brut (remplacé par l'écart d'or), ni les mesures de toute la partie.
 */
export const WORK_KEYS = new Set(["cs10", "cs15", "gd10", "xd10", "gd15", "kp15", "deaths15", "solo15", "obj15", "unc15"]);
/** Mesures sur toute la partie, qui suivent en partie l'issue : signalées comme telles. */
const OUTCOME_LINKED = new Set(["kpLate", "dmgShare"]);

export interface VsLine { key: string; label: string; unit: string; mine: number | null; opp: number | null; better: boolean | null; outcomeLinked: boolean; /** Écart (une seule valeur, ta perspective). */ diff: boolean }
export interface GoalLine { key: string; label: string; value: string; target: string; met: boolean | null }
export interface Moment { t: number; time: string; kind: "death" | "kill" | "objective-ours" | "objective-theirs"; text: string }
export interface AverageLine { key: string; label: string; unit: string; game: number; average: number; games: number; better: boolean }

export interface PostGame {
  matchId: string; account: string; startMs: number; championId: number; win: boolean; durationS: number;
  /** Rôle joué (TOP, JUNGLE…) : tes objectifs de la semaine ne portent que sur la jungle. */
  role: string;
  queue: "ranked" | "flex" | "draftNormal"; kda: string;
  opponent: number | null;
  vs: VsLine[];
  goals: GoalLine[];
  moments: Moment[];
  average: { games: number; lines: AverageLine[] } | null;
  /** Champion de progression : son repère (texte), sinon null. */
  progression: string | null;
  /** Points à travailler : tirés de tes dernières parties (pas de cette seule partie), avec leur évolution. */
  work: string[];
  /** Ton point fort net sur les mêmes parties (ou pourquoi il n'y en a pas). */
  strength: string;
}

const DRAGON_FR: Record<string, string> = { FIRE: "infernal", WATER: "océanique", AIR: "des nuages", EARTH: "des montagnes", CHEMTECH: "chemtech", HEXTECH: "hextech", ELDER: "ancestral" };
const OBJ_LABEL: Record<string, string> = { DRAGON: "dragon", HORDE: "larve du Néant", RIFTHERALD: "Héraut", BARON_NASHOR: "Nashor", ATAKHAN: "Atakhan" };

/** Moments clés de la chronologie : tes morts (et qui), tes kills, les objectifs pris et perdus. */
export function keyMoments(d: Detail): Moment[] {
  if (!d.timeline) return [];
  const me = d.match.parts.find((p) => p.me);
  if (!me) return [];
  const pid = n(me.participantId), team = n(me.teamId);
  const champOf = new Map(d.match.parts.map((p) => [n(p.participantId), n(p.championId)]));
  const ev = d.timeline.frames.flatMap((f) => f.e).sort((a, b) => n(a.timestamp) - n(b.timestamp));
  const out: Moment[] = [];
  const objs = ev.filter((e) => e.type === "ELITE_MONSTER_KILL" && n(e.killerTeamId) > 0);
  let lastGrub = -Infinity;
  for (const e of ev) {
    const t = n(e.timestamp);
    if (e.type === "CHAMPION_KILL" && n(e.victimId) === pid) {
      const helpers = ((e.assistingParticipantIds as number[] | undefined) ?? []).length;
      const enemyObj = objs.find((o) => n(o.killerTeamId) !== team && n(o.timestamp) > t && n(o.timestamp) - t <= MIN);
      out.push({ t, time: mmss(t), kind: "death", text: `Mort, tué par ${name(champOf.get(n(e.killerId)) ?? 0)}${helpers ? ` avec ${helpers} autre${helpers > 1 ? "s" : ""}` : " en 1 contre 1"}${enemyObj ? ` — ils prennent ${OBJ_LABEL[String(enemyObj.monsterType)] ?? "un objectif"} à ${mmss(n(enemyObj.timestamp))}` : ""}.` });
    } else if (e.type === "CHAMPION_KILL" && n(e.killerId) === pid) {
      out.push({ t, time: mmss(t), kind: "kill", text: `Kill sur ${name(champOf.get(n(e.victimId)) ?? 0)}.` });
    } else if (e.type === "ELITE_MONSTER_KILL" && n(e.killerTeamId) > 0) {
      const type = String(e.monsterType);
      if (type === "HORDE") { if (t - lastGrub < 90_000) continue; lastGrub = t; }
      const ours = n(e.killerTeamId) === team;
      const sub = String(e.monsterSubType ?? "").replace(/_DRAGON$/, "");
      const label = type === "DRAGON" ? `dragon${DRAGON_FR[sub] ? ` ${DRAGON_FR[sub]}` : ""}` : OBJ_LABEL[type] ?? type.toLowerCase();
      out.push({ t, time: mmss(t), kind: ours ? "objective-ours" : "objective-theirs", text: `${ours ? "Ton équipe prend" : "Ils prennent"} : ${label}${n(e.killerId) === pid ? " (par toi)" : ""}.` });
    }
  }
  return out;
}

/** Tes objectifs de la semaine sur cette partie (valeur de la partie et cible ; aucune conclusion sur une partie). */
export function goalLines(m: GameMetrics | null, targets: { uncompensatedEarly: number; deathsBeforeObj: number; cs10: number }): GoalLine[] {
  if (!m) return [];
  const out: GoalLine[] = [];
  out.push(m.cededEarly
    ? { key: "uncompensatedEarly", label: "Objectifs cédés avant 15 min sans contrepartie", value: `${m.uncompensatedEarly} sur ${m.cededEarly} cédé${m.cededEarly > 1 ? "s" : ""}`, target: `≤ ${targets.uncompensatedEarly} %`, met: (m.uncompensatedEarly / m.cededEarly) * 100 <= targets.uncompensatedEarly }
    : { key: "uncompensatedEarly", label: "Objectifs cédés avant 15 min sans contrepartie", value: "aucun objectif cédé avant 15 min", target: `≤ ${targets.uncompensatedEarly} %`, met: true });
  out.push({ key: "deathsBeforeObj", label: "Morts dans la minute avant un objectif adverse", value: String(m.deathsBeforeObj), target: `≤ ${targets.deathsBeforeObj.toLocaleString("fr-FR")} par partie`, met: m.deathsBeforeObj <= targets.deathsBeforeObj });
  if (m.cs10 != null) out.push({ key: "cs10", label: "CS à 10 min", value: `${m.cs10}${m.cs10diff != null ? ` (${m.cs10diff >= 0 ? "+" : "−"}${Math.abs(m.cs10diff)} face au jungler adverse)` : ""}`, target: `≥ ${targets.cs10}`, met: m.cs10 >= targets.cs10 });
  return out;
}

export interface PostGameInput {
  game: AnalysisGame;
  detail: Detail;
  queue: PostGame["queue"];
  metrics: GameMetrics | null;
  targets: { uncompensatedEarly: number; deathsBeforeObj: number; cs10: number };
  /** Tes autres parties sur ce champion, dans ce rôle et cette saison (hors celle-ci). */
  sameChampion: AnalysisGame[];
  /** Tes 20 dernières parties avant celle-ci, dans ce rôle (points à travailler). */
  recent: AnalysisGame[];
  ref: MetaRef;
  refName: string;
  progression: string | null;
}

export function postGame(x: PostGameInput): PostGame {
  const g = x.game;
  const byKey = new Map(METRICS.map((m) => [m.key, m]));
  const opp = x.detail.match.parts.find((p) => !p.me && n(p.teamId) !== n(x.detail.match.parts.find((q) => q.me)?.teamId) && p.teamPosition === g.role);
  const vs: VsLine[] = VS_KEYS.flatMap((k): VsLine[] => {
    const m = byKey.get(k);
    if (!m) return [];
    const mine = m.value(g), o = g.opp ? m.value(g.opp) : null;
    if (DIFF_KEYS.has(k)) return [{ key: k, label: m.label, unit: m.unit, mine, opp: null, better: mine == null || mine === 0 ? null : mine > 0, outcomeLinked: false, diff: true }];
    return [{ key: k, label: m.label, unit: m.unit, mine, opp: o, better: mine == null || o == null || mine === o ? null : m.better === "+" ? mine > o : mine < o, outcomeLinked: OUTCOME_LINKED.has(k), diff: false }];
  });
  // Ta moyenne sur ce champion (même rôle, même saison) : seulement à partir de 5 autres parties.
  let average: PostGame["average"] = null;
  if (x.sameChampion.length >= 5) {
    const lines = VS_KEYS.flatMap((k) => {
      const m = byKey.get(k)!;
      const v = m.value(g);
      const vals = x.sameChampion.map((h) => m.value(h)).filter((y): y is number => y != null);
      if (v == null || vals.length < 5) return [];
      const avg = vals.reduce((s, y) => s + y, 0) / vals.length;
      return [{ key: k, label: m.label, unit: m.unit, game: v, average: avg, games: vals.length, better: m.better === "+" ? v >= avg : v <= avg }];
    });
    average = { games: x.sameChampion.length, lines };
  }
  const { work, strength } = workPoints(x.recent, x.ref, x.refName, g);
  return {
    matchId: g.matchId, account: g.account, startMs: g.startMs, championId: g.championId, win: g.win, durationS: g.durationS, role: g.role,
    queue: x.queue, kda: `${g.kills}/${g.deaths}/${g.assists}`, opponent: opp ? n(opp.championId) : null,
    vs, goals: g.role === "JUNGLE" ? goalLines(x.metrics, x.targets) : [], moments: keyMoments(x.detail), average, progression: x.progression,
    work, strength,
  };
}

/** Parties récentes pour les points à travailler : pas de conclusion en dessous. */
export const WORK_GAMES = 20;

const meanMargin = (xs: number[]) => {
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  const sd = xs.length > 1 ? Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (xs.length - 1)) : 0;
  return { mean, margin: (1.96 * sd) / Math.sqrt(xs.length) };
};

/** Parties minimales dans chaque moitié pour comparer les 10 dernières aux 10 précédentes. */
const HALF_MIN = 5;

/**
 * Évolution d'une mesure : moyenne sur tes 10 dernières parties contre les 10 précédentes, chacune avec sa marge ;
 * « progrès » ou « recul » seulement si l'écart dépasse la marge combinée.
 */
export function evolution(m: Metric, games: AnalysisGame[]): string {
  const vals = (gs: AnalysisGame[]) => gs.map((h) => m.value(h)).filter((v): v is number => v != null);
  const a = vals(games.slice(0, 10)), b = vals(games.slice(10, 20));
  if (a.length < HALF_MIN || b.length < HALF_MIN) return "Évolution : pas assez de valeurs pour comparer tes 10 dernières parties aux 10 précédentes.";
  const ra = meanMargin(a), rb = meanMargin(b);
  const gap = ra.mean - rb.mean, mg = Math.hypot(ra.margin, rb.margin);
  const better = m.better === "+" ? gap > 0 : gap < 0;
  const verdict = Math.abs(gap) <= mg ? "pas d'écart net (marge comprise)" : better ? "progrès net" : "recul net";
  return `Évolution : ${fmt(ra.mean, m.unit)} ± ${fmt(ra.margin, m.unit)} sur tes 10 dernières parties${a.length < 10 ? ` (${a.length} mesurées)` : ""}, contre ${fmt(rb.mean, m.unit)} ± ${fmt(rb.margin, m.unit)} sur les 10 précédentes${b.length < 10 ? ` (${b.length} mesurées)` : ""} : ${verdict}.`;
}

/**
 * Points à travailler et point fort : sur tes 20 dernières parties (avant celle-ci), les mesures nettement sous la
 * référence (ta position moyenne + sa marge < 50), les plus faibles d'abord (3 au plus), chacune avec son évolution ;
 * et la mesure nettement au-dessus (position − marge > 50) la plus haute. Cette partie n'est qu'un exemple : aucune
 * conclusion n'en est tirée.
 */
export function workPoints(recent: AnalysisGame[], ref: MetaRef, refName: string, game: AnalysisGame): { work: string[]; strength: string } {
  const games = recent.slice(0, WORK_GAMES);
  if (games.length < WORK_GAMES) {
    return { work: [`Moins de ${WORK_GAMES} parties avant celle-ci dans ce rôle (${games.length}) : pas encore de point à travailler.`], strength: `Moins de ${WORK_GAMES} parties : pas encore de point fort.` };
  }
  const scored = METRICS.filter((m) => WORK_KEYS.has(m.key)).flatMap((m) => {
    const ranks = games.map((h) => gameRank(m, h, ref, null).rank).filter((r): r is number => r != null);
    const vals = games.map((h) => m.value(h)).filter((v): v is number => v != null);
    if (ranks.length < WORK_GAMES * 0.8 || !vals.length) return [];
    const r = meanMargin(ranks);
    const avg = vals.reduce((s, y) => s + y, 0) / vals.length;
    const over = ranks.length < games.length ? `${ranks.length} de tes ${games.length} dernières parties` : `tes ${games.length} dernières parties`;
    return [{ m, rank: r.mean, margin: r.margin, avg, over }];
  });
  const line = (p: (typeof scored)[number], tail: string) => {
    const v = p.m.value(game);
    return `${p.m.label} : ${fmt(p.avg, p.m.unit)} en moyenne sur ${p.over}, mieux que ${Math.round(p.rank)} % ± ${Math.round(p.margin)} des joueurs ${refName} (${tail}).${v != null ? ` Cette partie : ${fmt(v, p.m.unit)}.` : ""} ${evolution(p.m, games)}`;
  };
  const weak = scored.filter((p) => p.rank + p.margin < 50).sort((a, b) => a.rank - b.rank);
  const strong = scored.filter((p) => p.rank - p.margin > 50).sort((a, b) => b.rank - a.rank);
  return {
    work: weak.length ? weak.slice(0, 3).map((p) => line(p, "nettement sous la médiane")) : [`Aucune mesure nettement sous la médiane ${refName} sur tes ${WORK_GAMES} dernières parties (marge comprise).`],
    strength: strong.length ? line(strong[0], "nettement au-dessus de la médiane")
      : (() => {
        // Pas de point fort net : ta meilleure mesure, dite comme telle (au-dessus de la médiane mais dans la marge).
        const best = scored.filter((p) => p.rank > 50).sort((a, b) => b.rank - a.rank)[0];
        return `Aucune mesure nettement au-dessus de la médiane ${refName} sur tes ${WORK_GAMES} dernières parties (marge comprise).${best ? ` La plus proche, pas encore nette : ${line(best, "au-dessus de la médiane, mais dans la marge")}` : ""}`;
      })(),
  };
}
