// Lecture pour l'onglet « Analyse » (lecture seule ; la collecte écrit en parallèle).
import { unpackDetail, type Detail } from "../collector/detail.ts";
import { duelValues } from "./opponent.ts";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { AnalysisGame, DuelValues, MetaMetricRow, MyEventRow } from "./analysis.ts";

const MIN15 = 15 * 60_000;

function withDb<T>(dbFile: string, fallback: T, fn: (db: DatabaseSync) => T): T {
  if (!existsSync(dbFile)) return fallback;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbFile, { readOnly: true });
    db.exec("pragma busy_timeout = 2000");
    return fn(db);
  } catch {
    return fallback; // base pas encore migrée (v6) ou verrouillage passager
  } finally {
    db?.close();
  }
}

/**
 * Tes parties relues (chronologie v6), de la plus récente à la plus ancienne, hors champions exclus.
 * `limit` : -1 pour toutes.
 */
export function readAnalysisGames(dbFile: string, limit: number, excluded: number[]): AnalysisGame[] {
  return withDb(dbFile, [], (db) => {
    const rows = db.prepare(`select g.match_id, g.account, g.start_ms, g.duration_s, g.patch, g.season, g.champion_id, g.role, g.win, g.kills, g.deaths, g.assists,
        g.cs, g.gold15, g.cs15, g.cs10, g.team_kills, g.kills15, g.assists15, g.team_kills15, g.obj_team, g.obj_mine, g.damage, g.team_damage,
        (select count(*) from my_events e where e.match_id = g.match_id and e.account = g.account and e.kind = 'death' and e.t < ${MIN15}) deaths15
      from my_games g where g.timeline_v6 = 1 and g.remake = 0 and g.champion_id not in (${excluded.map(() => "?").join(",") || "0"})
      order by g.start_ms desc limit ?`).all(...excluded, limit) as Record<string, number | string | null>[];
    return rows.map((r) => ({
      matchId: String(r.match_id), account: String(r.account), startMs: Number(r.start_ms), durationS: Number(r.duration_s), patch: String(r.patch), season: Number(r.season),
      championId: Number(r.champion_id), role: String(r.role), win: !!r.win, kills: Number(r.kills), deaths: Number(r.deaths), assists: Number(r.assists),
      cs: Number(r.cs), gold15: r.gold15 as number | null, cs15: r.cs15 as number | null, cs10: r.cs10 as number | null,
      teamKills: r.team_kills as number | null, kills15: r.kills15 as number | null, assists15: r.assists15 as number | null, teamKills15: r.team_kills15 as number | null,
      objTeam: r.obj_team as number | null, objMine: r.obj_mine as number | null, deaths15: Number(r.deaths15),
      damage: r.damage as number | null, teamDamage: r.team_damage as number | null,
    }));
  });
}

/** Tes kills, morts et assists d'une partie (positions ; l'autre participant n'est connu que par son champion). */
export function readMyEvents(dbFile: string, matchId: string, account: string): MyEventRow[] {
  return withDb(dbFile, [], (db) =>
    (db.prepare("select t, kind, x, y, other_champ from my_events where match_id = ? and account = ? order by t").all(matchId, account) as
      { t: number; kind: MyEventRow["kind"]; x: number; y: number; other_champ: number }[])
      .map((r) => ({ t: r.t, kind: r.kind, x: r.x, y: r.y, otherChamp: r.other_champ })));
}

/** Tous tes kills, morts et assists (carte de chaleur), par partie (« matchId|compte »). */
export function readAllMyEvents(dbFile: string): Map<string, MyEventRow[]> {
  return withDb(dbFile, new Map(), (db) => {
    const out = new Map<string, MyEventRow[]>();
    for (const r of db.prepare("select match_id, account, t, kind, x, y, other_champ from my_events").all() as
      { match_id: string; account: string; t: number; kind: MyEventRow["kind"]; x: number; y: number; other_champ: number }[]) {
      const k = `${r.match_id}|${r.account}`;
      (out.get(k) ?? out.set(k, []).get(k)!).push({ t: r.t, kind: r.kind, x: r.x, y: r.y, otherChamp: r.other_champ });
    }
    return out;
  });
}

/** Méta : mesures de duel tirées des chronologies gardées (meta_detail), par « partie|participant ». */
export function readMetaDuels(dbFile: string, patches: string[], role: string, tier: string): Map<string, DuelValues> {
  const out = new Map<string, DuelValues>();
  if (!patches.length) return out;
  return withDb(dbFile, out, (db) => {
    const marks = patches.map(() => "?").join(",");
    const parts = db.prepare("select participant_id, team, role from meta_parts where match_id = ?");
    for (const r of db.prepare(`select d.match_id, d.data from meta_detail d join meta_games g on g.match_id = d.match_id where g.remake = 0 and g.tier = ? and g.patch in (${marks})`).all(tier, ...patches) as { match_id: string; data: Uint8Array }[]) {
      const timeline = (unpackDetail(r.data) as unknown as { timeline: Detail["timeline"] }).timeline;
      if (!timeline) continue;
      const ps = (parts.all(r.match_id) as { participant_id: number; team: number; role: string }[]).map((p) => ({ participantId: p.participant_id, teamId: p.team, teamPosition: p.role }));
      for (const p of ps) if (p.teamPosition === role) out.set(`${r.match_id}|${p.participantId}`, duelValues(timeline, ps, p.participantId));
    }
    return out;
  });
}

/** Méta (chronologies lues) : un rôle, et le détail par champion. */
export function readMetaMetrics(dbFile: string, patches: string[], role: string, tier: string): MetaMetricRow[] {
  if (!patches.length) return [];
  return withDb(dbFile, [], (db) => {
    const marks = patches.map(() => "?").join(",");
    return (db.prepare(`select p.match_id, p.participant_id, p.champion_id, p.win, p.cs10, p.cs15, p.gold15, p.deaths15, p.kills15, p.assists15, p.team_kills15, p.obj_team, p.obj_mine,
        p.kills, p.assists, p.deaths, g.duration_s, p.damage,
        (select sum(q.kills) from meta_parts q where q.match_id = p.match_id and q.team = p.team) team_kills,
        (select sum(q.damage) from meta_parts q where q.match_id = p.match_id and q.team = p.team) team_damage,
        p.gold15 - (select q.gold15 from meta_parts q where q.match_id = p.match_id and q.team <> p.team and q.role = p.role) gd15
      from meta_parts p join meta_games g on g.match_id = p.match_id
      where g.remake = 0 and g.tier = ? and g.patch in (${marks}) and p.role = ? and p.cs10 is not null`).all(tier, ...patches, role) as Record<string, number | null>[])
      .map((r) => ({
        championId: Number(r.champion_id), win: !!r.win, cs10: r.cs10, cs15: r.cs15, gold15: r.gold15, deaths15: r.deaths15,
        kills15: r.kills15, assists15: r.assists15, teamKills15: r.team_kills15, objTeam: r.obj_team, objMine: r.obj_mine,
        kills: Number(r.kills), assists: Number(r.assists), teamKills: r.team_kills,
        deaths: Number(r.deaths), durationS: Number(r.duration_s), damage: r.damage, teamDamage: r.team_damage, gd15: r.gd15,
        matchId: String(r.match_id), participantId: Number(r.participant_id),
      }));
  });
}
