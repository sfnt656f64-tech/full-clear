// Lectures pour le mode « Progresser » (base riot.db, lecture seule).
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { MasteryRow } from "./progress.ts";

function withDb<T>(dbFile: string, fallback: T, fn: (db: DatabaseSync) => T): T {
  if (!existsSync(dbFile)) return fallback;
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try { db.exec("pragma busy_timeout = 2000"); return fn(db); } catch { return fallback; } finally { db.close(); }
}
const hasTable = (db: DatabaseSync, t: string) => !!db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(t);

/** Victoires des junglers par champion sur ces patchs (méta, remakes exclus). */
export function readJungleMeta(dbFile: string, patches: string[]): Map<number, { n: number; w: number }> {
  const out = new Map<number, { n: number; w: number }>();
  if (!patches.length) return out;
  return withDb(dbFile, out, (db) => {
    const marks = patches.map(() => "?").join(",");
    for (const r of db.prepare(`select p.champion_id c, count(*) n, sum(p.win) w from meta_parts p join meta_games g on g.match_id = p.match_id
      where g.remake = 0 and p.role = 'JUNGLE' and g.patch in (${marks}) group by 1`).all(...patches) as { c: number; n: number; w: number }[]) out.set(r.c, { n: r.n, w: r.w });
    return out;
  });
}

/** Junglers de la méta avec leurs points de maîtrise sur le champion (joueur suivi, et les deux junglers depuis la v9). */
export function readJungleMastery(dbFile: string): MasteryRow[] {
  return withDb(dbFile, [] as MasteryRow[], (db) => {
    const rows = (db.prepare("select match_id m, champion_id c, win, points from meta_mastery where role = 'JUNGLE'").all() as { m: string; c: number; win: number; points: number }[]);
    // Partie déjà lue avec les deux junglers : on ne compte pas une 2ᵉ fois le joueur suivi.
    const both = hasTable(db, "meta_jungle_mastery")
      ? (db.prepare("select match_id m, champion_id c, win, points from meta_jungle_mastery").all() as { m: string; c: number; win: number; points: number }[]) : [];
    const seen = new Set(both.map((r) => r.m));
    return [...both, ...rows.filter((r) => !seen.has(r.m))].map((r) => ({ championId: r.c, win: !!r.win, points: r.points }));
  });
}

export interface OtherGame { matchId: string; account: string; startMs: number; queue: number; championId: number; role: string; win: boolean; remake: boolean }
/** Tes parties hors Solo/Duo (tous modes). */
export function readOtherGames(dbFile: string): OtherGame[] {
  return withDb(dbFile, [] as OtherGame[], (db) => hasTable(db, "my_other_games")
    ? (db.prepare("select match_id, account, start_ms, queue, champion_id, role, win, remake from my_other_games").all() as Record<string, string | number>[])
      .map((r) => ({ matchId: String(r.match_id), account: String(r.account), startMs: Number(r.start_ms), queue: Number(r.queue), championId: Number(r.champion_id), role: String(r.role), win: !!r.win, remake: !!r.remake }))
    : []);
}
