// Plan d'avant-partie du jungler, calculé UNE fois à partir de la draft terminée (jamais selon l'état de la
// partie : règles Riot). Fonctions pures.
//
// Chance de gank estimée, par lane (avant 10 min) :
//   - point de départ : réussite des ganks des junglers Émeraude+ sur cette lane (kills avec le jungler,
//     rapportés à ces kills plus les morts du jungler sur place) — la chronologie ne montre pas les ganks
//     ratés sans mort, d'où une « chance estimée » et non une probabilité exacte ;
//   - ton champion : sa réussite propre sur cette lane, lissée vers la moyenne ;
//   - ton allié de lane : son contrôle (CC) ;
//   - le laner adverse : sa fréquence de morts sur gank avant 10 min, et sa mobilité ;
//   - le duel de la lane (méta).
import { findChamp } from "../../src/data/champions";
import { mobility } from "../../src/data/mobility";
import type { Champion } from "../../src/data/types";
import type { GankKillRow, TimelinePartRow } from "../meta/read.ts";
import { pairEffects, type PairIndex } from "../reco/draft-pick.ts";
import { LANE_LABELS, type Lane, type LaneRow } from "../reco/lanes.ts";

export const GANK_LANES = ["TOP", "MIDDLE", "BOTTOM"] as const;
export type GankLane = (typeof GANK_LANES)[number];
/** Rôle du laner (et de son support pour le bot) sur chaque lane. */
const LANE_ROLES: Record<GankLane, string[]> = { TOP: ["TOP"], MIDDLE: ["MIDDLE"], BOTTOM: ["BOTTOM", "UTILITY"] };
/** Lissage : parties « fictives » à la moyenne. */
const K_CHAMP = 30;
const K_VICTIM = 40;

export interface LaneGank {
  lane: GankLane;
  /** Chance de réussite estimée, en %. */
  chance: number;
  /** 1 à 2 raisons en clair. */
  reasons: string[];
}

export interface GamePlan {
  lanes: LaneGank[];
  firstGank: GankLane;
  /** Côté de départ conseillé, et répartition des départs de ton champion en Émeraude+ (%, côté top). */
  start: { side: "top" | "bot"; buff: string | null; topShare: number | null };
  objectives: string[];
  /** Parties de méta avec chronologie pour ton champion en jungle. */
  games: number;
  provisional: boolean;
}

export interface GamePlanInput {
  meChampion: number;
  side: "blue" | "red" | null;
  lanes: LaneRow<{ id: string }>[];
  kills: GankKillRow[];
  parts: TimelinePartRow[];
  index: PairIndex;
}

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const nf = (n: number) => Math.round(n).toLocaleString("fr-FR");
const champ = (id: string | undefined) => (id ? findChamp(id) : undefined);

const jgInvolved = (k: GankKillRow) => k.killerRole === "JUNGLE" || k.assistRoles.includes("JUNGLE");

interface Tally { ok: number; ko: number }

/** Réussite des ganks par lane : tous les junglers, et ton champion (même équipe que le jungler). */
function gankTallies(input: GamePlanInput) {
  const all: Record<GankLane, Tally> = { TOP: { ok: 0, ko: 0 }, MIDDLE: { ok: 0, ko: 0 }, BOTTOM: { ok: 0, ko: 0 } };
  const mine: Record<GankLane, Tally> = { TOP: { ok: 0, ko: 0 }, MIDDLE: { ok: 0, ko: 0 }, BOTTOM: { ok: 0, ko: 0 } };
  const myJungle = new Map<string, number>(); // match → équipe de ton champion en jungle
  for (const p of input.parts) if (p.role === "JUNGLE" && p.championId === input.meChampion) myJungle.set(p.matchId, p.team);
  for (const k of input.kills) {
    const lane = k.lane as GankLane;
    if (!GANK_LANES.includes(lane)) continue;
    const victimTeam = k.killerTeam === 100 ? 200 : 100;
    if (jgInvolved(k)) {
      all[lane].ok++;
      if (myJungle.get(k.matchId) === k.killerTeam) mine[lane].ok++;
    }
    if (k.victimRole === "JUNGLE") {
      all[lane].ko++;
      if (myJungle.get(k.matchId) === victimTeam) mine[lane].ko++;
    }
  }
  return { all, mine, games: myJungle.size };
}

/** Morts sur gank avant 10 min par partie, pour un champion dans un rôle (et la moyenne du rôle). */
function vulnerability(input: GamePlanInput, championId: number, role: string): { rate: number; base: number; games: number } {
  const gamesBy = new Map<string, number>();
  for (const p of input.parts) if (p.role === role) gamesBy.set(`${p.championId}`, (gamesBy.get(`${p.championId}`) ?? 0) + 1);
  const roleGames = [...gamesBy.values()].reduce((s, n) => s + n, 0);
  const deaths = input.kills.filter((k) => k.victimRole === role && jgInvolved(k));
  const base = roleGames ? deaths.length / roleGames : 0;
  const n = gamesBy.get(`${championId}`) ?? 0;
  const d = deaths.filter((k) => k.victimChamp === championId).length;
  return { rate: (d + K_VICTIM * base) / (n + K_VICTIM), base, games: n };
}

export function gamePlan(input: GamePlanInput): GamePlan | null {
  const me = input.lanes.find((r) => r.me);
  if (!me || me.lane !== "JUNGLE") return null;
  const { all, mine, games } = gankTallies(input);
  const byLane = (lane: Lane) => input.lanes.find((r) => r.lane === lane);

  const lanes: LaneGank[] = GANK_LANES.map((lane) => {
    const a = all[lane], m = mine[lane];
    const base = (a.ok + 1) / (a.ok + a.ko + 2);
    const champRate = (m.ok + K_CHAMP * base) / (m.ok + m.ko + K_CHAMP);
    let x = logit(clamp(champRate, 0.05, 0.95));
    const reasons: { w: number; text: string }[] = [];
    if (m.ok + m.ko >= 10 && Math.abs(champRate - base) >= 0.04) {
      reasons.push({ w: Math.abs(champRate - base) * 10, text: `ton champion réussit ${nf(champRate * 100)} % de ses ganks ici (moyenne ${nf(base * 100)} %)` });
    }

    const roles = LANE_ROLES[lane];
    const rows = roles.map((r) => byLane(r as Lane));
    // Contrôle de tes alliés sur la lane.
    const allies = rows.flatMap((r) => (champ(r?.ally?.id) ? [champ(r!.ally!.id)!] : []));
    const cc = allies.reduce((s, c) => s + c.cc, 0);
    x += 0.18 * (cc - 1.5);
    const ccAlly = allies.filter((c) => c.cc >= 2).sort((p, q) => q.cc - p.cc)[0];
    if (ccAlly) reasons.push({ w: ccAlly.cc, text: `${ccAlly.name} a beaucoup de contrôle` });

    // Laner(s) adverse(s) : vulnérabilité aux ganks et mobilité.
    const enemies = rows.flatMap((r, i) => (champ(r?.enemy?.id) ? [{ c: champ(r!.enemy!.id)!, role: roles[i] }] : []));
    for (const e of enemies) {
      const v = vulnerability(input, e.c.key!, e.role);
      if (v.base > 0) {
        const ratio = v.rate / v.base;
        x += 0.5 * Math.log(clamp(ratio, 0.5, 2));
        if (v.games >= 15 && ratio >= 1.25) reasons.push({ w: ratio * 2, text: `${e.c.name} meurt souvent sur gank` });
        if (v.games >= 15 && ratio <= 0.75) reasons.push({ w: (1 / ratio) * 2, text: `${e.c.name} meurt rarement sur gank` });
      }
      const mob = mobility(e.c.id);
      x -= 0.15 * (mob - 2);
      if (mob === 3) reasons.push({ w: 1.5, text: `${e.c.name} est très mobile` });
    }

    // Duel de la lane : ton allié contre son vis-à-vis (méta).
    const duel = rows[0]?.ally && rows[0]?.enemy ? duelEffect(input.index, champ(rows[0].ally.id), champ(rows[0].enemy.id), roles[0]) : 0;
    x += duel / 12;
    if (Math.abs(duel) >= 1.5 && rows[0]?.ally) {
      const a = champ(rows[0].ally.id)!;
      reasons.push({ w: Math.abs(duel), text: duel > 0 ? `${a.name} gagne souvent ce duel` : `${a.name} perd souvent ce duel` });
    }
    return { lane, chance: clamp(sigmoid(x) * 100, 10, 90), reasons: reasons.sort((p, q) => q.w - p.w).slice(0, 2).map((r) => r.text) };
  });

  const first = [...lanes].sort((a, b) => b.chance - a.chance)[0].lane;

  // Départ : du côté opposé au premier gank, pour finir le clear à côté de cette lane.
  const starts = input.parts.filter((p) => p.role === "JUNGLE" && p.championId === input.meChampion && p.startSide);
  const topShare = starts.length >= 10 ? (starts.filter((p) => p.startSide === "top").length / starts.length) * 100 : null;
  const side: "top" | "bot" = first === "TOP" ? "bot" : first === "BOTTOM" ? "top" : topShare != null && topShare >= 50 ? "top" : "bot";
  // Équipe bleue : Blue Buff côté top, Red Buff côté bot ; équipe rouge : l'inverse.
  const buff = input.side == null ? null : (input.side === "blue") === (side === "top") ? "Blue Buff" : "Red Buff";

  return {
    lanes,
    firstGank: first,
    start: { side, buff, topShare },
    objectives: objectivePlan(input, lanes),
    games,
    provisional: games < 30,
  };
}

function duelEffect(index: PairIndex, ally: Champion | undefined, enemy: Champion | undefined, role: string): number {
  if (!ally?.key || !enemy?.key) return 0;
  return pairEffects(index, ally.key, role, [enemy.key], "enemy")[0]?.effect ?? 0;
}

/** Objectifs à prioriser selon la composition (données de la draft). */
function objectivePlan(input: GamePlanInput, lanes: LaneGank[]): string[] {
  const allyChamps = input.lanes.flatMap((r) => (champ(r.ally?.id) ? [champ(r.ally!.id)!] : []));
  const enemyChamps = input.lanes.flatMap((r) => (champ(r.enemy?.id) ? [champ(r.enemy!.id)!] : []));
  const top = lanes.find((l) => l.lane === "TOP")!.chance, bot = lanes.find((l) => l.lane === "BOTTOM")!.chance;
  const out: string[] = [];
  if (top - bot >= 5) out.push("Voidgrubs puis Héraut : ton côté top est le plus favorable aux ganks.");
  else if (bot - top >= 5) out.push("Premiers dragons : ton côté bot est le plus favorable aux ganks.");
  else out.push("Top et bot se valent : choisis le premier objectif selon ton premier gank.");
  const early = (cs: Champion[]) => cs.filter((c) => c.early).length;
  const diff = early(allyChamps) - early(enemyChamps);
  if (diff >= 1) out.push(`Ta composition est plus forte en début de partie (${early(allyChamps)} champions d'early contre ${early(enemyChamps)}) : les premiers objectifs comptent.`);
  else if (diff <= -1) out.push(`Ils sont plus forts en début de partie (${early(enemyChamps)} champions d'early contre ${early(allyChamps)}) : prends les objectifs sans risque, sans forcer.`);
  return out;
}

/** Libellé de lane (la lane du bas regroupe ADC et support). */
export const laneLabel = (l: GankLane): string => (l === "BOTTOM" ? "Bot" : LANE_LABELS[l]);

/** Lignes courtes pour l'overlay (début de partie). */
export function planTips(p: GamePlan): string[] {
  const lanes = p.lanes.map((l) => `${laneLabel(l.lane)} ${nf(l.chance)} %`).join(" · ");
  return [
    `Ganks estimés : ${lanes}.`,
    `1er gank suggéré : ${laneLabel(p.firstGank)} · départ côté ${p.start.side}${p.start.buff ? ` (${p.start.buff})` : ""}.`,
    ...p.objectives.slice(0, 1),
  ];
}
