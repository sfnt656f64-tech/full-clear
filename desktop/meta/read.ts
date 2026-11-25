// Lecture de la méta collectée (lecture seule ; le processus de collecte écrit en parallèle).
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { MetaInput, MetaMasteryRow, RunePage } from "./meta-stats.ts";

export interface MetaPatchInfo { patch: string; games: number }

const cmpPatchDesc = (a: string, b: string) => {
  const [a1, a2] = a.split(".").map(Number);
  const [b1, b2] = b.split(".").map(Number);
  return b1 - a1 || b2 - a2;
};

/** Patchs présents (du plus récent au plus ancien), parties hors remakes. */
export function readMetaPatches(dbFile: string): MetaPatchInfo[] {
  return withDb(dbFile, [], (db) =>
    (db.prepare("select patch, count(*) n from meta_games where remake = 0 group by patch").all() as { patch: string; n: number }[])
      .map((r) => ({ patch: r.patch, games: r.n }))
      .sort((a, b) => cmpPatchDesc(a.patch, b.patch)));
}

/** Maîtrise des joueurs sources, tous patchs en base (difficulté de prise en main : il faut beaucoup de parties). */
export function readMetaMastery(dbFile: string): MetaMasteryRow[] {
  return withDb(dbFile, [], (db) =>
    (db.prepare("select m.champion_id, m.role, m.win, m.points from meta_mastery m join meta_games g on g.match_id = m.match_id where g.remake = 0").all() as
      { champion_id: number; role: string; win: number; points: number }[])
      .map((r) => ({ championId: r.champion_id, role: r.role, win: !!r.win, points: r.points })));
}

/** Kill de début de partie (méta, anonyme) pour le plan d'avant-partie. */
export interface GankKillRow { matchId: string; t: number; lane: string; killerTeam: number; killerRole: string; victimChamp: number; victimRole: string; assistRoles: string[] }
/** Participant d'une partie dont la chronologie a été lue. */
export interface TimelinePartRow { matchId: string; team: number; championId: number; role: string; win: boolean; startSide: string | null }

/** Kills avant 10 min et participants des parties avec chronologie (patchs demandés). */
export function readGankData(dbFile: string, patches: string[]): { kills: GankKillRow[]; parts: TimelinePartRow[] } {
  const empty = { kills: [], parts: [] };
  if (!patches.length) return empty;
  return withDb(dbFile, empty, (db) => {
    const marks = patches.map(() => "?").join(",");
    const sel = `select match_id from meta_games where remake = 0 and patch in (${marks})`;
    const kills = (db.prepare(`select match_id, t, lane, killer_team, killer_role, victim_champ, victim_role, assist_roles from meta_early_kills
      where t < 600000 and match_id in (${sel})`).all(...patches) as
      { match_id: string; t: number; lane: string; killer_team: number; killer_role: string; victim_champ: number; victim_role: string; assist_roles: string }[])
      .map((r) => ({ matchId: r.match_id, t: r.t, lane: r.lane, killerTeam: r.killer_team, killerRole: r.killer_role, victimChamp: r.victim_champ, victimRole: r.victim_role, assistRoles: JSON.parse(r.assist_roles) as string[] }));
    const parts = (db.prepare(`select match_id, team, champion_id, role, win, start_side from meta_parts where cs10 is not null and match_id in (${sel})`).all(...patches) as
      { match_id: string; team: number; champion_id: number; role: string; win: number; start_side: string | null }[])
      .map((r) => ({ matchId: r.match_id, team: r.team, championId: r.champion_id, role: r.role, win: !!r.win, startSide: r.start_side }));
    return { kills, parts };
  });
}

/** Données de méta des patchs demandés (hors remakes). */
export function readMeta(dbFile: string, patches: string[]): MetaInput {
  const empty: MetaInput = { matches: 0, parts: [], builds: [], mastery: [], patches };
  if (!patches.length) return empty;
  return withDb(dbFile, empty, (db) => {
    const marks = patches.map(() => "?").join(",");
    const sel = `select match_id from meta_games where remake = 0 and patch in (${marks})`;
    const matches = (db.prepare(`select count(*) n from meta_games where remake = 0 and patch in (${marks})`).get(...patches) as { n: number }).n;
    const parts = (db.prepare(`select p.match_id, p.team, p.champion_id, p.role, p.win, p.kills, p.deaths, p.assists, p.items, p.perks,
        p.kills15, p.assists15, p.team_kills15, p.gold15, g.duration_s
        from meta_parts p join meta_games g on g.match_id = p.match_id where g.remake = 0 and g.patch in (${marks})`).all(...patches) as
      { match_id: string; team: number; champion_id: number; role: string; win: number; kills: number; deaths: number; assists: number; items: string; perks: string | null;
        kills15: number | null; assists15: number | null; team_kills15: number | null; gold15: number | null; duration_s: number }[])
      .map((r) => ({
        matchId: r.match_id, championId: r.champion_id, role: r.role, win: !!r.win, items: JSON.parse(r.items) as number[], perks: r.perks ? (JSON.parse(r.perks) as RunePage) : null,
        team: r.team, kills: r.kills, deaths: r.deaths, assists: r.assists, durationS: r.duration_s,
        kills15: r.kills15, assists15: r.assists15, teamKills15: r.team_kills15, gold15: r.gold15,
      }));
    const builds = (db.prepare(`select champion_id, role, win, items from meta_builds where match_id in (${sel})`).all(...patches) as
      { champion_id: number; role: string; win: number; items: string }[])
      .map((r) => ({ championId: r.champion_id, role: r.role, win: !!r.win, items: JSON.parse(r.items) as number[] }));
    const mastery = (db.prepare(`select champion_id, role, win, points from meta_mastery where match_id in (${sel})`).all(...patches) as
      { champion_id: number; role: string; win: number; points: number }[])
      .map((r) => ({ championId: r.champion_id, role: r.role, win: !!r.win, points: r.points }));
    return { matches, parts, builds, mastery, patches };
  });
}

function withDb<T>(dbFile: string, fallback: T, fn: (db: DatabaseSync) => T): T {
  if (!existsSync(dbFile)) return fallback;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbFile, { readOnly: true });
    db.exec("pragma busy_timeout = 2000");
    return fn(db);
  } catch {
    return fallback; // tables pas encore créées (ancienne base) ou verrouillage passager
  } finally {
    db?.close();
  }
}
