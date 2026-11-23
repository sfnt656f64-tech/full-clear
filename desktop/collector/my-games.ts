// Tes parties : match-v5 + chronologie → enregistrement compact (MyGame). Fonctions pures.
import type { MyGame } from "./store.ts";
import { csAt, myEvents, objectives, type TimelineFull } from "./timeline-parse.ts";

/** Sous-ensemble utile de match-v5. */
export interface MatchV5 {
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
      teamId?: number;
      championId: number;
      teamPosition?: string;
      win: boolean;
      gameEndedInEarlySurrender?: boolean;
      kills: number; deaths: number; assists: number;
      totalMinionsKilled: number; neutralMinionsKilled: number;
      visionScore: number;
      item0: number; item1: number; item2: number; item3: number; item4: number; item5: number; item6: number;
      perks?: {
        statPerks?: { offense: number; flex: number; defense: number };
        styles?: { style: number; selections: { perk: number }[] }[];
      };
    }[];
  };
}

/** Sous-ensemble utile de la chronologie : une image par minute. */
export type TimelineV5 = TimelineFull;

/** « 16.23.734.1234 » → « 16.23 ». */
export const patchOf = (gameVersion: string): string => gameVersion.split(".").slice(0, 2).join(".");

/** Saison (année) d'un patch : 16.x → 2026, 15.x → 2025, 11.x → 2021. */
export const seasonOf = (patch: string): number => 2010 + Number(patch.split(".")[0]);

const MIN15 = 15 * 60_000;

/** Or et CS à 15 min : image de la chronologie la plus proche de 15:00 (à 30 s près). */
export function at15(t: TimelineV5 | null, participantId: number): { gold15: number | null; cs15: number | null } {
  const f = t?.info.frames.find((fr) => Math.abs(fr.timestamp - MIN15) <= 30_000);
  const p = f?.participantFrames[String(participantId)];
  return p ? { gold15: p.totalGold ?? 0, cs15: (p.minionsKilled ?? 0) + (p.jungleMinionsKilled ?? 0) } : { gold15: null, cs15: null };
}

/**
 * Participation aux éliminations avant 15 min : tes kills et assists, et les kills de ton équipe
 * (événements CHAMPION_KILL de la chronologie). null sans chronologie.
 */
export function early15(t: TimelineV5 | null, participantId: number, team: Set<number>): { kills15: number; assists15: number; teamKills15: number } | null {
  if (!t) return null;
  let kills15 = 0, assists15 = 0, teamKills15 = 0;
  for (const fr of t.info.frames) {
    for (const e of fr.events ?? []) {
      if (e.type !== "CHAMPION_KILL" || e.timestamp >= MIN15 || !e.killerId || !team.has(e.killerId)) continue;
      teamKills15++;
      if (e.killerId === participantId) kills15++;
      else if (e.assistingParticipantIds?.includes(participantId)) assists15++;
    }
  }
  return { kills15, assists15, teamKills15 };
}

function timelineExtras(t: TimelineV5, pid: number, team: number, m: MatchV5): Pick<MyGame, "cs10" | "objTeam" | "objMine" | "events"> {
  const champOf = new Map(m.info.participants.map((x) => [x.participantId, x.championId]));
  const o = objectives(t, pid, team);
  return {
    cs10: csAt(t, pid, 10),
    objTeam: o.team,
    objMine: o.mine,
    events: myEvents(t, pid).map((e) => ({ t: e.t, kind: e.kind, x: e.x, y: e.y, otherChamp: champOf.get(e.other) ?? 0 })),
  };
}

/** Résumé de ta partie ; null si tu n'y apparais pas. */
export function summarizeMyGame(m: MatchV5, t: TimelineV5 | null, puuid: string, account: string): MyGame | null {
  const p = m.info.participants.find((x) => x.puuid === puuid);
  if (!p) return null;
  const styles = p.perks?.styles ?? [];
  const sp = p.perks?.statPerks;
  const mates = m.info.participants.filter((x) => p.teamId == null || x.teamId === p.teamId);
  const e15 = early15(t, p.participantId, new Set(mates.map((x) => x.participantId)));
  return {
    matchId: m.metadata.matchId,
    account,
    startMs: m.info.gameStartTimestamp ?? m.info.gameCreation,
    durationS: m.info.gameDuration,
    patch: patchOf(m.info.gameVersion),
    season: seasonOf(patchOf(m.info.gameVersion)),
    championId: p.championId,
    role: p.teamPosition ?? "",
    win: p.win,
    remake: !!p.gameEndedInEarlySurrender,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    cs: p.totalMinionsKilled + p.neutralMinionsKilled,
    vision: p.visionScore,
    ...(m.info.gameDuration >= 15 * 60 ? at15(t, p.participantId) : { gold15: null, cs15: null }),
    teamKills: mates.reduce((n, x) => n + x.kills, 0),
    // Chronologie (v6) : CS à 10 min, objectifs, tes kills / morts / assists (positions ; l'autre participant
    // n'est gardé que par son champion).
    ...(t ? timelineExtras(t, p.participantId, p.teamId ?? (p.participantId <= 5 ? 100 : 200), m) : {}),
    kills15: e15?.kills15 ?? null,
    assists15: e15?.assists15 ?? null,
    teamKills15: e15?.teamKills15 ?? null,
    items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter((i) => i > 0),
    perks: styles.length >= 2 && sp
      ? { primary: styles[0].style, sub: styles[1].style, selections: styles.flatMap((s) => s.selections.map((x) => x.perk)), shards: [sp.offense, sp.flex, sp.defense] }
      : null,
  };
}
