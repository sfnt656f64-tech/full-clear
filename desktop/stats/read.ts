// Lecture de tes parties dans la base de collecte, en lecture seule (le processus de collecte écrit en parallèle).
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { MyGameRow } from "./my-stats.ts";

interface Raw {
  match_id: string; account: string; start_ms: number; duration_s: number; patch: string; champion_id: number; role: string;
  win: number; remake: number; kills: number; deaths: number; assists: number; cs: number; vision: number; gold15: number | null; cs15: number | null;
}

export function readMyGames(dbFile: string): MyGameRow[] {
  if (!existsSync(dbFile)) return [];
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbFile, { readOnly: true });
    db.exec("pragma busy_timeout = 2000");
    const rows = db.prepare(`select match_id, account, start_ms, duration_s, patch, champion_id, role, win, remake,
      kills, deaths, assists, cs, vision, gold15, cs15 from my_games`).all() as unknown as Raw[];
    return rows.map((r) => ({
      matchId: r.match_id, account: r.account, startMs: r.start_ms, durationS: r.duration_s, patch: r.patch,
      championId: r.champion_id, role: r.role, win: !!r.win, remake: !!r.remake,
      kills: r.kills, deaths: r.deaths, assists: r.assists, cs: r.cs, vision: r.vision, gold15: r.gold15, cs15: r.cs15,
    }));
  } catch {
    // Base pas encore créée (table absente) ou verrouillée un instant : rien à afficher pour l'instant.
    return [];
  } finally {
    db?.close();
  }
}
