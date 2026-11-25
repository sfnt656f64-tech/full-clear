// Détail d'une de tes parties (analyses poussées) : la partie et sa chronologie, réduites à des chiffres
// anonymes. Aucun PUUID, Riot ID ni pseudo n'est gardé ; seul « me » indique ta ligne. Fonctions pures.
import { gzipSync, gunzipSync } from "node:zlib";

const PART = ["participantId", "teamId", "championId", "teamPosition", "win", "kills", "deaths", "assists", "totalMinionsKilled", "neutralMinionsKilled",
  "goldEarned", "champLevel", "visionScore", "wardsPlaced", "wardsKilled", "detectorWardsPlaced", "visionWardsBoughtInGame", "firstBloodKill", "firstBloodAssist",
  "totalDamageDealtToChampions", "challenges", "gameEndedInEarlySurrender", "summoner1Id", "summoner2Id"] as const;
const PF = ["totalGold", "xp", "level", "minionsKilled", "jungleMinionsKilled", "position"] as const;
const EV = new Set(["CHAMPION_KILL", "ELITE_MONSTER_KILL", "ITEM_PURCHASED", "ITEM_UNDO", "LEVEL_UP", "WARD_PLACED", "WARD_KILL", "CHAMPION_SPECIAL_KILL", "BUILDING_KILL"]);
const EVF = ["type", "timestamp", "participantId", "killerId", "victimId", "assistingParticipantIds", "position", "killerTeamId", "monsterType", "monsterSubType",
  "itemId", "beforeId", "level", "wardType", "creatorId", "killType", "teamId", "buildingType", "laneType"] as const;

type Obj = Record<string, unknown>;
const pick = (o: Obj, keys: readonly string[]): Obj => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

export interface DetailFrame { t: number; p: Record<string, Obj>; e: Obj[] }
export interface Detail {
  account: string;
  match: { matchId: string; duration: number; start: number; version: string; queue: number; teams: Obj[]; parts: (Obj & { me: boolean })[] };
  timeline: { frames: DetailFrame[] } | null;
}

interface RawMatch { metadata: { matchId: string }; info: { gameDuration: number; gameStartTimestamp?: number; gameCreation: number; gameVersion: string; queueId: number; teams: Obj[]; participants: Obj[] } }
interface RawTimeline { info: { frames: { timestamp: number; participantFrames: Record<string, Obj>; events?: Obj[] }[] } }

export function cleanDetail(account: string, m: RawMatch, t: RawTimeline | null, mePuuid: string): Detail {
  return {
    account,
    match: {
      matchId: m.metadata.matchId, duration: m.info.gameDuration, start: m.info.gameStartTimestamp ?? m.info.gameCreation, version: m.info.gameVersion, queue: m.info.queueId,
      teams: (m.info.teams ?? []).map((x) => pick(x, ["teamId", "win", "objectives"])),
      parts: m.info.participants.map((p) => ({ ...pick(p, PART), me: p.puuid === mePuuid })),
    },
    timeline: t ? {
      frames: t.info.frames.map((f) => ({
        t: f.timestamp,
        p: Object.fromEntries(Object.entries(f.participantFrames).map(([id, pf]) => [id, pick(pf, PF)])),
        e: (f.events ?? []).filter((e) => EV.has(String(e.type))).map((e) => pick(e, EVF)),
      })),
    } : null,
  };
}

export const packDetail = (d: Detail): Uint8Array => gzipSync(JSON.stringify(d));
export const unpackDetail = (b: Uint8Array): Detail => JSON.parse(gunzipSync(b).toString("utf8")) as Detail;

/** Méta : CS minute par minute (1 à 15) et minute du premier item légendaire, pour un participant. */
export function jungleCurve(t: RawTimeline, pid: number, isLegendary: (itemId: number) => boolean): { cs: (number | null)[]; firstItem: number | null } {
  const cs = Array.from({ length: 15 }, (_, i) => {
    const f = t.info.frames.find((x) => Math.abs(x.timestamp - (i + 1) * 60_000) <= 30_000);
    const p = f?.participantFrames[String(pid)] as { minionsKilled?: number; jungleMinionsKilled?: number } | undefined;
    return p ? (p.minionsKilled ?? 0) + (p.jungleMinionsKilled ?? 0) : null;
  });
  const first = t.info.frames.flatMap((f) => f.events ?? []).find((e) => e.type === "ITEM_PURCHASED" && e.participantId === pid && isLegendary(Number(e.itemId)));
  return { cs, firstItem: first ? Number(first.timestamp) / 60_000 : null };
}
