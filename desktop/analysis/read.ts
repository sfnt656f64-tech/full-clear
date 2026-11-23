// Lecture pour l'onglet « Analyse » (lecture seule ; la collecte écrit en parallèle).
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { AnalysisGame, MetaMetricRow, MyEventRow } from "./analysis.ts";

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

/** Tes dernières parties relues (chronologie v6), de la plus récente à la plus ancienne, hors champions exclus. */
export function readAnalysisGames(dbFile: string, limit: number, excluded: number[]): AnalysisGame[] {
  return withDb(dbFile, [], (db) => {
    const rows = db.prepare(`select g.match_id, g.account, g.start_ms, g.duration_s, g.patch, g.champion_id, g.role, g.win, g.kills, g.deaths, g.assists,
        g.cs, g.gold15, g.cs15, g.cs10, g.team_kills, g.kills15, g.assists15, g.team_kills15, g.obj_team, g.obj_mine,
        (select count(*) from my_events e where e.match_id = g.match_id and e.account = g.account and e.kind = 'death' and e.t < ${MIN15}) deaths15
      from my_games g where g.timeline_v6 = 1 and g.remake = 0 and g.champion_id not in (${excluded.map(() => "?").join(",") || "0"})
      order by g.start_ms desc limit ?`).all(...excluded, limit) as Record<string, number | string | null>[];
    return rows.map((r) => ({
      matchId: String(r.match_id), account: String(r.account), startMs: Number(r.start_ms), durationS: Number(r.duration_s), patch: String(r.patch),
      championId: Number(r.champion_id), role: String(r.role), win: !!r.win, kills: Number(r.kills), deaths: Number(r.deaths), assists: Number(r.assists),
      cs: Number(r.cs), gold15: r.gold15 as number | null, cs15: r.cs15 as number | null, cs10: r.cs10 as number | null,
      teamKills: r.team_kills as number | null, kills15: r.kills15 as number | null, assists15: r.assists15 as number | null, teamKills15: r.team_kills15 as number | null,
      objTeam: r.obj_team as number | null, objMine: r.obj_mine as number | null, deaths15: Number(r.deaths15),
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

/** Méta (chronologies lues) : un rôle, et le détail par champion. */
export function readMetaMetrics(dbFile: string, patches: string[], role: string): MetaMetricRow[] {
  if (!patches.length) return [];
  return withDb(dbFile, [], (db) => {
    const marks = patches.map(() => "?").join(",");
    return (db.prepare(`select p.champion_id, p.win, p.cs10, p.cs15, p.gold15, p.deaths15, p.kills15, p.assists15, p.team_kills15, p.obj_team, p.obj_mine
      from meta_parts p join meta_games g on g.match_id = p.match_id
      where g.remake = 0 and g.patch in (${marks}) and p.role = ? and p.cs10 is not null`).all(...patches, role) as Record<string, number | null>[])
      .map((r) => ({
        championId: Number(r.champion_id), win: !!r.win, cs10: r.cs10, cs15: r.cs15, gold15: r.gold15, deaths15: r.deaths15,
        kills15: r.kills15, assists15: r.assists15, teamKills15: r.team_kills15, objTeam: r.obj_team, objMine: r.obj_mine,
      }));
  });
}
