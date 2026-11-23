// Lecture de la méta collectée (lecture seule ; le processus de collecte écrit en parallèle).
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { MetaInput, RunePage } from "./meta-stats.ts";

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

/** Données de méta des patchs demandés (hors remakes). */
export function readMeta(dbFile: string, patches: string[]): MetaInput {
  const empty: MetaInput = { matches: 0, parts: [], builds: [], mastery: [], patches };
  if (!patches.length) return empty;
  return withDb(dbFile, empty, (db) => {
    const marks = patches.map(() => "?").join(",");
    const sel = `select match_id from meta_games where remake = 0 and patch in (${marks})`;
    const matches = (db.prepare(`select count(*) n from meta_games where remake = 0 and patch in (${marks})`).get(...patches) as { n: number }).n;
    const parts = (db.prepare(`select match_id, champion_id, role, win, items, perks from meta_parts where match_id in (${sel})`).all(...patches) as
      { match_id: string; champion_id: number; role: string; win: number; items: string; perks: string | null }[])
      .map((r) => ({ matchId: r.match_id, championId: r.champion_id, role: r.role, win: !!r.win, items: JSON.parse(r.items) as number[], perks: r.perks ? (JSON.parse(r.perks) as RunePage) : null }));
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
