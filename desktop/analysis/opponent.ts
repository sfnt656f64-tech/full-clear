// Mesures d'un participant tirées du détail anonyme d'une partie : sert de référence « adversaire direct »
// (même rôle, même partie) pour les saisons sans méta. Fonctions pures.
import type { Detail } from "../collector/detail.ts";
import type { Values } from "./analysis.ts";

const MIN = 60_000;
const n = (v: unknown) => (typeof v === "number" ? v : 0);

/** Mesures d'un participant (mêmes définitions que tes parties). null sans chronologie. */
export function valuesOf(d: Detail, pid: number): Values | null {
  if (!d.timeline) return null;
  const p = d.match.parts.find((x) => n(x.participantId) === pid);
  if (!p) return null;
  const team = n(p.teamId);
  const mates = d.match.parts.filter((x) => n(x.teamId) === team);
  const mateIds = new Set(mates.map((x) => n(x.participantId)));
  const events = d.timeline.frames.flatMap((f) => f.e);
  const kills = events.filter((e) => e.type === "CHAMPION_KILL");
  const at = (min: number) => d.timeline!.frames.find((f) => Math.abs(f.t - min * MIN) <= 30_000)?.p[String(pid)];
  const f10 = at(10), f15 = at(15);
  const early = kills.filter((e) => n(e.timestamp) < 15 * MIN);
  const obj = events.filter((e) => e.type === "ELITE_MONSTER_KILL" && n(e.killerTeamId) === team);
  return {
    cs10: f10 ? n(f10.minionsKilled) + n(f10.jungleMinionsKilled) : null,
    cs15: f15 ? n(f15.minionsKilled) + n(f15.jungleMinionsKilled) : null,
    gold15: f15 ? n(f15.totalGold) : null,
    kills15: early.filter((e) => n(e.killerId) === pid).length,
    assists15: early.filter((e) => (e.assistingParticipantIds as number[] | undefined)?.includes(pid)).length,
    teamKills15: early.filter((e) => mateIds.has(n(e.killerId))).length,
    objTeam: obj.length,
    objMine: obj.filter((e) => n(e.killerId) === pid || (e.assistingParticipantIds as number[] | undefined)?.includes(pid)).length,
    deaths15: early.filter((e) => n(e.victimId) === pid).length,
    kills: n(p.kills),
    assists: n(p.assists),
    teamKills: mates.reduce((s, x) => s + n(x.kills), 0),
    deaths: n(p.deaths),
    durationS: d.match.duration,
    damage: p.totalDamageDealtToChampions == null ? null : n(p.totalDamageDealtToChampions),
    teamDamage: p.totalDamageDealtToChampions == null ? null : mates.reduce((s, x) => s + n(x.totalDamageDealtToChampions), 0),
  };
}

/** Mesures de ton adversaire direct (même rôle, autre équipe) dans une de tes parties. */
export function opponentValues(d: Detail): Values | null {
  const me = d.match.parts.find((x) => x.me);
  if (!me?.teamPosition) return null;
  const opp = d.match.parts.find((x) => n(x.teamId) !== n(me.teamId) && x.teamPosition === me.teamPosition);
  return opp ? valuesOf(d, n(opp.participantId)) : null;
}
