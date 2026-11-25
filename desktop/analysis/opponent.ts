// Mesures d'un participant tirées du détail anonyme d'une partie : sert de référence « adversaire direct »
// (même rôle, même partie) pour les saisons sans méta. Fonctions pures.
import type { Detail } from "../collector/detail.ts";
import type { AnalysisGame, DuelValues, Values } from "./analysis.ts";
import { OBJECTIVES, trades } from "./goals.ts";

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
    ...(p.teamPosition ? duelValues(d.timeline, partsOf(d), pid) : {}),
  };
}

/**
 * Mesures de duel d'un participant face à l'adversaire direct (même poste, autre équipe), tirées de la chronologie.
 * `parts` : participant, équipe et poste (le détail de la méta ne garde que la chronologie).
 */
export function duelValues(timeline: NonNullable<Detail["timeline"]>, parts: { participantId: number; teamId: number; teamPosition: string }[], pid: number): DuelValues {
  const p = parts.find((x) => x.participantId === pid);
  if (!p) return {};
  const opp = parts.find((x) => x.teamId !== p.teamId && x.teamPosition === p.teamPosition);
  const at = (min: number) => timeline.frames.find((f) => Math.abs(f.t - min * MIN) <= 30_000);
  const diff = (min: number, k: string) => {
    const f = at(min);
    const a = f?.p[String(pid)], b = opp ? f?.p[String(opp.participantId)] : undefined;
    return a && b ? n(a[k]) - n(b[k]) : null;
  };
  const ev = timeline.frames.flatMap((f) => f.e);
  const kills = ev.filter((e) => e.type === "CHAMPION_KILL").sort((a, b) => n(a.timestamp) - n(b.timestamp));
  const helpers = (e: Record<string, unknown>) => (e.assistingParticipantIds as number[] | undefined) ?? [];
  const first = kills[0];
  // Objectifs neutres avant 15 min (dragons, larves regroupées, héraut), mêmes règles que l'objectif de la semaine
  // « objectifs cédés avant 15 min sans contrepartie » (goals.ts) : contrepartie dans la minute (objectif, tour ou
  // plus de kills que l'adversaire).
  const objs: { t: number; type: string; team: number }[] = [];
  for (const e of ev) {
    if (e.type !== "ELITE_MONSTER_KILL" || !OBJECTIVES.has(String(e.monsterType)) || n(e.killerTeamId) <= 0 || n(e.timestamp) >= 15 * MIN) continue;
    let last: (typeof objs)[number] | undefined;
    for (const o of objs) if (o.team === n(e.killerTeamId)) last = o;
    if (last && last.type === e.monsterType && n(e.timestamp) - last.t < 90_000) continue;
    objs.push({ t: n(e.timestamp), type: String(e.monsterType), team: n(e.killerTeamId) });
  }
  const t15 = trades(ev, p.teamId, new Map(parts.map((x) => [x.participantId, x.teamId])), 15 * MIN);
  return {
    gd10: diff(10, "totalGold"), xd10: diff(10, "xp"), gd15: diff(15, "totalGold"),
    fb: first ? (n(first.killerId) === pid || helpers(first).includes(pid) ? 1 : 0) : null,
    solo15: kills.filter((e) => n(e.victimId) === pid && n(e.timestamp) < 15 * MIN && !helpers(e).length).length,
    obj15: objs.length ? (objs.filter((o) => o.team === p.teamId).length / objs.length) * 100 : null,
    unc15: t15.ceded ? (t15.uncompensated / t15.ceded) * 100 : null,
  };
}

const partsOf = (d: Detail) => d.match.parts.map((x) => ({ participantId: n(x.participantId), teamId: n(x.teamId), teamPosition: String(x.teamPosition ?? "") }));

/** Tes mesures de duel dans une de tes parties. */
export function myDuelValues(d: Detail): DuelValues {
  const me = d.match.parts.find((x) => x.me);
  return me && d.timeline && me.teamPosition ? duelValues(d.timeline, partsOf(d), n(me.participantId)) : {};
}

/** Ta partie reconstruite depuis son détail (normales en draft : elles ne sont pas dans tes parties classées). */
export function myGameFromDetail(d: Detail): AnalysisGame | null {
  const me = d.match.parts.find((x) => x.me);
  if (!me || !d.timeline) return null;
  const v = valuesOf(d, n(me.participantId));
  if (!v) return null;
  const [major, minor] = d.match.version.split(".");
  return {
    ...v, matchId: d.match.matchId, account: d.account, startMs: d.match.start, durationS: d.match.duration,
    patch: `${major}.${minor}`, season: 2010 + Number(major), championId: n(me.championId), role: String(me.teamPosition ?? ""), win: !!me.win,
    kills: n(me.kills), deaths: n(me.deaths), assists: n(me.assists), cs: n(me.totalMinionsKilled) + n(me.neutralMinionsKilled),
    teamKills: v.teamKills ?? null, deaths15: v.deaths15 ?? 0, opp: opponentValues(d),
  };
}

/** Mesures de ton adversaire direct (même rôle, autre équipe) dans une de tes parties. */
export function opponentValues(d: Detail): Values | null {
  const me = d.match.parts.find((x) => x.me);
  if (!me?.teamPosition) return null;
  const opp = d.match.parts.find((x) => n(x.teamId) !== n(me.teamId) && x.teamPosition === me.teamPosition);
  return opp ? valuesOf(d, n(opp.participantId)) : null;
}
