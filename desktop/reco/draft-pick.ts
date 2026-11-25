// Draft : classe les champions de ton pool selon les picks déjà révélés. Fonctions pures.
//
// Pour chaque champion C (dans ton rôle), on part de son score de pool (« Mon pool ») et on ajoute :
//   - contres : win rate de C dans la méta Émeraude+ quand chaque adversaire révélé est en face,
//     comparé à son win rate habituel (lissé : peu de parties → effet proche de 0), pondéré par le rôle :
//     ton vis-à-vis probable (même rôle) compte ×1,5, les autres ×0,5 ;
//   - synergie : idem avec chaque allié verrouillé ;
//   - dégâts : bonus si C apporte le type de dégâts qui manque à ton équipe.
// Un champion hors de ton pool n'est proposé que s'il est nettement meilleur (OFF_POOL_MARGIN points),
// après une pénalité parce que tu ne le joues pas.
//
// L'appli met en avant des choix, avec leurs raisons ; c'est toi qui choisis (règles Riot).
import { wilson } from "./pool-advice.ts";
import { champByKey } from "../../src/data/champions";
import type { Champion } from "../../src/data/types";
import type { MetaChampion, MetaPartRow } from "../meta/meta-stats.ts";
import type { PoolPick } from "./recommend.ts";
import { LANE_LABELS, type Lane } from "./lanes.ts";

/** Parties « fictives » au win rate habituel du champion, pour lisser un duel ou une association. */
export const K_PAIR = 150;
/** Effet maximal d'un adversaire ou d'un allié (points), et du total des contres / synergies. */
export const PAIR_CAP = 3;
export const TOTAL_CAP = 4;
/** Un duel ne compte que s'il repose sur assez de parties (pas de conclusion sous 20) ; il est cité s'il pèse assez. */
export const PAIR_MIN_GAMES = 20;
export const PAIR_MIN_EFFECT = 0.5;
/** Hors pool : parties de méta minimales, pénalité (tu ne le joues pas), marge pour le proposer. */
export const OFF_POOL_MIN_GAMES = 100;
export const OFF_POOL_PENALTY = 2;
export const OFF_POOL_MARGIN = 3;
/** Poids d'un duel : contre ton vis-à-vis (même rôle), contre les autres. */
export const SAME_LANE_WEIGHT = 1.5;
export const OTHER_LANE_WEIGHT = 0.5;
/** Nombre de propositions. */
export const DRAFT_COUNT = 3;

export interface PairIndex {
  /** « champion|rôle » → ses parties (match, équipe, victoire). */
  byChampRole: Map<string, { matchId: string; team: number; win: boolean }[]>;
  /** match → champions et équipes. */
  byMatch: Map<string, { team: number; championId: number }[]>;
}

export function pairIndex(parts: MetaPartRow[]): PairIndex {
  const byChampRole = new Map<string, { matchId: string; team: number; win: boolean }[]>();
  const byMatch = new Map<string, { team: number; championId: number }[]>();
  for (const p of parts) {
    const team = p.team ?? 0;
    (byMatch.get(p.matchId) ?? byMatch.set(p.matchId, []).get(p.matchId)!).push({ team, championId: p.championId });
    if (!p.role) continue;
    const k = `${p.championId}|${p.role}`;
    (byChampRole.get(k) ?? byChampRole.set(k, []).get(k)!).push({ matchId: p.matchId, team, win: p.win });
  }
  return { byChampRole, byMatch };
}

export interface PairEffect { championId: number; games: number; winRate: number; effect: number; /** Win rate habituel du champion dans ce rôle. */ base: number }

export interface DraftPick {
  championId: number;
  inPool: boolean;
  /** Score de départ (pool) ou win rate de méta moins la pénalité (hors pool). */
  base: number;
  score: number;
  counter: number;
  synergy: number;
  damage: number;
  /** Rang dans ton pool (1 = meilleur), null hors pool. */
  poolRank: number | null;
  reasons: string[];
  provisional: boolean;
}

export interface DraftPicks {
  role: string;
  myTurn: boolean;
  list: DraftPick[];
  /** Champion hors pool nettement meilleur pour cette draft, sinon null. */
  offPool: DraftPick | null;
}

export interface DraftPickInput {
  role: string;
  myTurn: boolean;
  allies: number[];
  enemies: number[];
  /** Rôle probable de chaque adversaire révélé (draft rangée par rôle). */
  enemyLanes?: Map<number, Lane>;
  unavailable: number[];
  /** Champions exclus (réglage) : jamais proposés. */
  excluded?: number[];
  /** Ton pool dans ce rôle, déjà classé (recommend()). */
  pool: PoolPick[];
  meta: MetaChampion[];
  index: PairIndex;
  /** Méta trop maigre : tout est provisoire. */
  provisional?: boolean;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const nf = (n: number, d = 0) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const name = (id: number) => champByKey(id)?.name ?? `#${id}`;
/** « 58 % ± 9 sur 112 parties » : win rate ensemble et marge à 95 % (Wilson). */
const pm = (e: PairEffect) => `${nf(e.winRate)} % ± ${nf(wilson(Math.round((e.winRate / 100) * e.games), e.games))} sur ${e.games} parties`;

/** Effet (points de win rate, lissé) de chaque champion `others` sur C, côté adverse ou allié. */
export function pairEffects(index: PairIndex, championId: number, role: string, others: number[], side: "enemy" | "ally"): PairEffect[] {
  const rows = index.byChampRole.get(`${championId}|${role}`) ?? [];
  if (!rows.length) return [];
  const baseWr = (rows.filter((r) => r.win).length / rows.length) * 100;
  return others.map((o) => {
    let n = 0, w = 0;
    for (const r of rows) {
      const m = index.byMatch.get(r.matchId) ?? [];
      if (m.some((x) => x.championId === o && (side === "enemy" ? x.team !== r.team : x.team === r.team && x.championId !== championId))) {
        n++;
        if (r.win) w++;
      }
    }
    const shrunk = ((w + (K_PAIR * baseWr) / 100) / (n + K_PAIR)) * 100;
    // Trop peu de parties ensemble : aucun effet (même lissé, 6 victoires sur 6 pèseraient sans pouvoir être expliquées).
    return { championId: o, games: n, winRate: n ? (w / n) * 100 : 0, base: baseWr, effect: n < PAIR_MIN_GAMES ? 0 : clamp(shrunk - baseWr, -PAIR_CAP, PAIR_CAP) };
  });
}

type Dmg = "physical" | "magic";

/** Type de dégâts qui manque à ton équipe (au moins 2 alliés connus), sinon null. */
export function missingDamage(allies: Champion[]): Dmg | null {
  if (allies.length < 2) return null;
  let p = 0, m = 0;
  for (const a of allies) {
    if (a.damage === "physical") p++;
    else if (a.damage === "magic") m++;
    else { p += 0.5; m += 0.5; }
  }
  const magicShare = m / (p + m);
  return magicShare <= 0.25 ? "magic" : magicShare >= 0.75 ? "physical" : null;
}

function damageBonus(c: Champion, need: Dmg | null): number {
  if (!need) return 0;
  if (c.damage === "mixed") return 0.75;
  return c.damage === need ? 1.5 : -1;
}

const DMG_LABEL: Record<Dmg, string> = { physical: "physiques", magic: "magiques" };

function evaluate(input: DraftPickInput, championId: number, base: number, poolRank: number | null, need: Dmg | null, metaProvisional: boolean): DraftPick | null {
  const c = champByKey(championId);
  if (!c) return null;
  const enemies = pairEffects(input.index, championId, input.role, input.enemies, "enemy");
  const allies = pairEffects(input.index, championId, input.role, input.allies, "ally");
  const weight = (id: number) => {
    const lane = input.enemyLanes?.get(id);
    return !lane ? 1 : lane === input.role ? SAME_LANE_WEIGHT : OTHER_LANE_WEIGHT;
  };
  for (const e of enemies) e.effect *= weight(e.championId);
  const counter = clamp(enemies.reduce((s, e) => s + e.effect, 0), -TOTAL_CAP, TOTAL_CAP);
  const synergy = clamp(allies.reduce((s, e) => s + e.effect, 0), -TOTAL_CAP, TOTAL_CAP);
  const damage = damageBonus(c, need);

  const r: { w: number; text: string }[] = [];
  // Cité seulement si l'écart avec le win rate habituel dépasse la marge d'erreur (sinon : pas de conclusion).
  const cite = (e: PairEffect) => e.games >= PAIR_MIN_GAMES && Math.abs(e.effect) >= PAIR_MIN_EFFECT
    && Math.abs(e.winRate - e.base) > wilson(Math.round((e.winRate / 100) * e.games), e.games);
  const who = (id: number) => {
    const lane = input.enemyLanes?.get(id);
    return lane ? `${name(id)} (${LANE_LABELS[lane].toLowerCase()})` : name(id);
  };
  for (const e of enemies.filter(cite)) {
    r.push({ w: Math.abs(e.effect), text: e.effect > 0
      ? `Bon contre ${who(e.championId)} : ${pm(e)} en Émeraude+, contre ${nf(e.base)} % d'habitude.`
      : `Difficile contre ${who(e.championId)} : ${pm(e)} en Émeraude+, contre ${nf(e.base)} % d'habitude.` });
  }
  for (const e of allies.filter(cite)) {
    r.push({ w: Math.abs(e.effect), text: e.effect > 0
      ? `Bonne synergie avec ${name(e.championId)} : ${pm(e)}, contre ${nf(e.base)} % d'habitude.`
      : `Va mal avec ${name(e.championId)} : ${pm(e)}, contre ${nf(e.base)} % d'habitude.` });
  }
  if (need && damage > 0) r.push({ w: damage, text: `Ton équipe manque de dégâts ${DMG_LABEL[need]} : ${c.name} en apporte.` });
  if (need && damage < 0) r.push({ w: -damage, text: `Ton équipe a déjà surtout des dégâts ${DMG_LABEL[need === "magic" ? "physical" : "magic"]}, comme ${c.name}.` });
  const reasons = r.sort((a, b) => b.w - a.w).slice(0, 2).map((x) => x.text);
  if (poolRank != null && reasons.length < 2) reasons.push(poolRank === 1 ? "Ton meilleur champion dans ce rôle." : `N° ${poolRank} de ton pool.`);

  return {
    championId, inPool: poolRank != null, base, score: base + counter + synergy + damage, counter, synergy, damage, poolRank,
    reasons, provisional: !!input.provisional || metaProvisional,
  };
}

export function draftPicks(input: DraftPickInput): DraftPicks {
  const unavailable = new Set([...input.unavailable, ...(input.excluded ?? [])]);
  const allyChamps = input.allies.map((id) => champByKey(id)).filter((c): c is Champion => !!c);
  const need = missingDamage(allyChamps);
  const metaBy = new Map(input.meta.filter((m) => m.role === input.role).map((m) => [m.championId, m]));

  const list = input.pool
    .map((p, i) => ({ p, rank: i + 1 }))
    .filter(({ p }) => !unavailable.has(p.championId))
    .flatMap(({ p, rank }) => {
      const d = evaluate(input, p.championId, p.score, rank, need, p.provisional);
      return d ? [d] : [];
    })
    .sort((a, b) => b.score - a.score || (a.poolRank ?? 99) - (b.poolRank ?? 99))
    .slice(0, DRAFT_COUNT);

  // Hors pool : seulement s'il est nettement meilleur que ton meilleur choix.
  const inPool = new Set(input.pool.map((p) => p.championId));
  let offPool: DraftPick | null = null;
  for (const m of metaBy.values()) {
    if (m.games < OFF_POOL_MIN_GAMES || inPool.has(m.championId) || unavailable.has(m.championId)) continue;
    const metaAdj = ((m.wins + 50) / (m.games + 100)) * 100;
    const d = evaluate(input, m.championId, metaAdj - OFF_POOL_PENALTY, null, need, m.games < 200);
    if (d && (!offPool || d.score > offPool.score)) offPool = d;
  }
  const bar = (list[0]?.score ?? -Infinity) + OFF_POOL_MARGIN;
  if (offPool && offPool.score >= bar) {
    offPool.reasons = [...offPool.reasons.slice(0, 2), list.length
      ? `Hors de ton pool : ${nf(offPool.score - list[0].score, 1)} point(s) de mieux que ton meilleur choix ici.`
      : "Aucun champion de ton pool disponible dans ce rôle : meilleur choix de la méta pour cette draft."];
  } else offPool = null;

  return { role: input.role, myTurn: input.myTurn, list, offPool };
}
