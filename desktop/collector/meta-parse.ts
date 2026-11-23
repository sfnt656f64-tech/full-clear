// Données de méta : une partie match-v5 → 10 lignes anonymes (champion, rôle, victoire, items, runes).
// Aucune identité n'est gardée : ni PUUID, ni Riot ID, ni pseudo. Fonctions pures.
import itemIndex from "../../src/data/generated/item-index.json";
import { STARTER_ITEM_IDS } from "../../src/data/starters";
import { at15, early15, patchOf, type TimelineV5 } from "./my-games.ts";

export interface MetaMatchV5 {
  metadata: { matchId: string };
  info: {
    gameCreation: number;
    gameStartTimestamp?: number;
    gameDuration: number;
    gameVersion: string;
    queueId: number;
    participants: {
      puuid: string;
      participantId: number;
      teamId: number;
      championId: number;
      teamPosition?: string;
      win: boolean;
      gameEndedInEarlySurrender?: boolean;
      kills: number; deaths: number; assists: number;
      item0: number; item1: number; item2: number; item3: number; item4: number; item5: number; item6: number;
      perks?: {
        statPerks?: { offense: number; flex: number; defense: number };
        styles?: { style: number; selections: { perk: number }[] }[];
      };
    }[];
  };
}

export interface MetaPart {
  participantId: number;
  team: number;
  championId: number;
  role: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  /** Inventaire final (hors trinket). */
  items: number[];
  /** Page de runes : principal, secondaire, 6 runes, 3 fragments. */
  perks: { primary: number; sub: number; selections: number[]; shards: number[] } | null;
}

export interface MetaGame {
  matchId: string;
  patch: string;
  startMs: number;
  durationS: number;
  remake: boolean;
  parts: MetaPart[];
}

export function summarizeMetaMatch(m: MetaMatchV5): MetaGame {
  return {
    matchId: m.metadata.matchId,
    patch: patchOf(m.info.gameVersion),
    startMs: m.info.gameStartTimestamp ?? m.info.gameCreation,
    durationS: m.info.gameDuration,
    remake: m.info.participants.some((p) => p.gameEndedInEarlySurrender),
    parts: m.info.participants.map((p) => {
      const styles = p.perks?.styles ?? [];
      const sp = p.perks?.statPerks;
      return {
        participantId: p.participantId,
        team: p.teamId,
        championId: p.championId,
        role: p.teamPosition ?? "",
        win: p.win,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter((i) => i > 0),
        perks: styles.length >= 2 && sp
          ? { primary: styles[0].style, sub: styles[1].style, selections: styles.flatMap((s) => s.selections.map((x) => x.perk)), shards: [sp.offense, sp.flex, sp.defense] }
          : null,
      };
    }),
  };
}

/** Items « terminés » (légendaires et bottes) et familiers : ce qui compte dans un ordre de build. */
const BUILD_ITEMS = new Set([...Object.keys(itemIndex), ...STARTER_ITEM_IDS]);
export const isBuildItem = (id: number): boolean => BUILD_ITEMS.has(String(id));

export interface TimelineEventsV5 {
  info: { frames: { events: { type: string; participantId?: number; itemId?: number; beforeId?: number; afterId?: number; timestamp: number }[] }[] };
}

export interface EarlyStats { kills15: number; assists15: number; teamKills15: number; gold15: number | null }

/**
 * Début de partie de chaque participant (anonyme) : kills et assists avant 15 min, kills de son équipe
 * avant 15 min, or à 15 min. `teams` : équipe de chaque participant.
 */
export function earlyStats(t: TimelineV5, teams: Map<number, number>): Map<number, EarlyStats> {
  const out = new Map<number, EarlyStats>();
  for (const [pid, team] of teams) {
    const mates = new Set([...teams].filter(([, tm]) => tm === team).map(([p]) => p));
    const e = early15(t, pid, mates)!;
    out.set(pid, { ...e, gold15: at15(t, pid).gold15 });
  }
  return out;
}

/**
 * Ordre d'achat des items terminés, par participant : achats dans l'ordre, annulations (ITEM_UNDO)
 * retirées, chaque item gardé une seule fois (le premier achat).
 */
export function buildOrders(t: TimelineEventsV5, participantIds: number[]): Map<number, number[]> {
  const raw = new Map<number, number[]>(participantIds.map((p) => [p, []]));
  for (const f of t.info.frames) {
    for (const e of f.events) {
      const list = e.participantId != null ? raw.get(e.participantId) : undefined;
      if (!list) continue;
      if (e.type === "ITEM_PURCHASED" && e.itemId) list.push(e.itemId);
      else if (e.type === "ITEM_UNDO" && e.beforeId) {
        const i = list.lastIndexOf(e.beforeId);
        if (i >= 0) list.splice(i, 1);
      }
    }
  }
  const out = new Map<number, number[]>();
  for (const [p, list] of raw) out.set(p, [...new Set(list.filter(isBuildItem))]);
  return out;
}
