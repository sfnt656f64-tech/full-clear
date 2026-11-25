// Chronologie match-v5 → données de début de partie, de position et d'objectifs. Fonctions pures.
// Aucune identité : uniquement des numéros de participant (1–10), des champions et des rôles.

export interface Pos { x: number; y: number }

/** Sous-ensemble utile de la chronologie (images d'une minute). */
export interface TimelineFull {
  metadata?: { participants?: string[] };
  info: {
    frames: {
      timestamp: number;
      participantFrames: Record<string, { totalGold?: number; minionsKilled?: number; jungleMinionsKilled?: number; position?: Pos }>;
      events?: {
        type: string;
        timestamp: number;
        killerId?: number;
        victimId?: number;
        assistingParticipantIds?: number[];
        position?: Pos;
        killerTeamId?: number;
        monsterType?: string;
      }[];
    }[];
  };
}

export type MapLane = "TOP" | "MIDDLE" | "BOTTOM" | "JUNGLE" | "BASE";

/**
 * Zone de la carte (Faille de l'invocateur, coordonnées 0–15 000, base bleue en bas à gauche) :
 * couloirs de lane, bases, et tout le reste (jungle et rivière).
 */
export function laneOf(p: Pos): MapLane {
  const { x, y } = p;
  if ((x < 3500 && y < 3500) || (x > 11300 && y > 11300)) return "BASE";
  if ((x < 3000 && y > 4500) || (y > 12000 && x < 10300)) return "TOP";
  if ((y < 3000 && x > 4500) || (x > 12000 && y < 10300)) return "BOTTOM";
  if (Math.abs(x - y) < 1600) return "MIDDLE";
  return "JUNGLE";
}

/** Côté de la carte par rapport à la diagonale mid : « top » au-dessus, « bot » en dessous. */
export const sideOf = (p: Pos): "top" | "bot" => (p.y > p.x ? "top" : "bot");

const MIN = 60_000;
const frameAt = (t: TimelineFull, ms: number) => t.info.frames.find((f) => Math.abs(f.timestamp - ms) <= 30_000);

/** CS (minions + monstres) à la minute donnée, ou null si la partie n'est pas allée jusque-là. */
export function csAt(t: TimelineFull, pid: number, minute: number): number | null {
  const p = frameAt(t, minute * MIN)?.participantFrames[String(pid)];
  return p ? (p.minionsKilled ?? 0) + (p.jungleMinionsKilled ?? 0) : null;
}

/** Côté de départ d'un jungler : sa position à 2 min (premier camp fini). */
export function startSide(t: TimelineFull, pid: number): "top" | "bot" | null {
  const p = frameAt(t, 2 * MIN)?.participantFrames[String(pid)]?.position;
  return p ? sideOf(p) : null;
}

const events = (t: TimelineFull) => t.info.frames.flatMap((f) => f.events ?? []);

/** Morts avant `ms`. */
export function deathsBefore(t: TimelineFull, pid: number, ms: number): number {
  return events(t).filter((e) => e.type === "CHAMPION_KILL" && e.victimId === pid && e.timestamp < ms).length;
}

/** Objectifs (dragons, Voidgrubs, Héraut, Baron, Atakhan) pris par ton équipe, et ceux auxquels tu as participé. */
export function objectives(t: TimelineFull, pid: number, team: number): { team: number; mine: number } {
  let teamN = 0, mine = 0;
  for (const e of events(t)) {
    if (e.type !== "ELITE_MONSTER_KILL" || e.killerTeamId !== team) continue;
    teamN++;
    if (e.killerId === pid || e.assistingParticipantIds?.includes(pid)) mine++;
  }
  return { team: teamN, mine };
}

export interface MyEvent { t: number; kind: "kill" | "death" | "assist"; x: number; y: number; other: number }

/** Tes kills, morts et assists avec leur position ; `other` : participant tué (ou tueur pour une mort). */
export function myEvents(t: TimelineFull, pid: number): MyEvent[] {
  const out: MyEvent[] = [];
  for (const e of events(t)) {
    if (e.type !== "CHAMPION_KILL" || !e.position) continue;
    const base = { t: e.timestamp, x: e.position.x, y: e.position.y };
    if (e.killerId === pid) out.push({ ...base, kind: "kill", other: e.victimId ?? 0 });
    else if (e.victimId === pid) out.push({ ...base, kind: "death", other: e.killerId ?? 0 });
    else if (e.assistingParticipantIds?.includes(pid)) out.push({ ...base, kind: "assist", other: e.victimId ?? 0 });
  }
  return out;
}

export interface RosterEntry { team: number; role: string; championId: number }

export interface EarlyKill {
  t: number;
  x: number;
  y: number;
  lane: MapLane;
  killerChamp: number;
  killerRole: string;
  killerTeam: number;
  victimChamp: number;
  victimRole: string;
  /** Rôles des assistants (équipe du tueur). */
  assistRoles: string[];
}

/** Kills avant `maxMs` (anonymes : champions et rôles), pour mesurer les ganks par lane. */
export function earlyKills(t: TimelineFull, roster: Map<number, RosterEntry>, maxMs: number): EarlyKill[] {
  const out: EarlyKill[] = [];
  for (const e of events(t)) {
    if (e.type !== "CHAMPION_KILL" || e.timestamp >= maxMs || !e.position) continue;
    const k = roster.get(e.killerId ?? 0), v = roster.get(e.victimId ?? 0);
    if (!v) continue; // tueur absent du roster (tourelle, sbire) : le kill reste compté, sans champion tueur
    out.push({
      t: e.timestamp, x: e.position.x, y: e.position.y, lane: laneOf(e.position),
      killerChamp: k?.championId ?? 0, killerRole: k?.role ?? "", killerTeam: k?.team ?? (v.team === 100 ? 200 : 100),
      victimChamp: v.championId, victimRole: v.role,
      assistRoles: (e.assistingParticipantIds ?? []).map((a) => roster.get(a)?.role ?? "").filter(Boolean),
    });
  }
  return out;
}

export interface PartExtra { cs10: number | null; cs15: number | null; deaths15: number; objTeam: number; objMine: number; startSide: "top" | "bot" | null }

/** Données de chronologie de chaque participant (méta, anonyme). */
export function partExtras(t: TimelineFull, roster: Map<number, RosterEntry>): Map<number, PartExtra> {
  const out = new Map<number, PartExtra>();
  for (const [pid, r] of roster) {
    const o = objectives(t, pid, r.team);
    out.set(pid, {
      cs10: csAt(t, pid, 10), cs15: csAt(t, pid, 15), deaths15: deathsBefore(t, pid, 15 * MIN),
      objTeam: o.team, objMine: o.mine, startSide: r.role === "JUNGLE" ? startSide(t, pid) : null,
    });
  }
  return out;
}
