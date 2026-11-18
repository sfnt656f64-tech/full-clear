import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CollectorStore, type MyGame } from "../desktop/collector/store";
import { comparePatch, myStats, type MyGameRow } from "../desktop/stats/my-stats";
import { readMyGames } from "../desktop/stats/read";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 18);
let n = 0;
const g = (over: Partial<MyGameRow> = {}): MyGameRow => ({
  matchId: `EUW1_${n++}`, account: "Moi#EUW", startMs: NOW - DAY, durationS: 1800, patch: "16.23", championId: 141, role: "JUNGLE",
  win: true, remake: false, kills: 6, deaths: 3, assists: 9, cs: 180, vision: 30, gold15: 6000, cs15: 100, ...over,
});

describe("mes stats par champion et par rôle", () => {
  const games = [
    g(), g({ win: false, kills: 2, deaths: 6, assists: 4, gold15: 5000, cs15: 90 }), g({ gold15: null, cs15: null, durationS: 14 * 60 }),
    g({ championId: 1, role: "MIDDLE", account: "Smurf#EUW", win: false }),
    g({ role: "MIDDLE" }),
    g({ remake: true, win: false }),
    g({ patch: "16.9", startMs: NOW - 60 * DAY }),
  ];

  it("regroupe par (champion, rôle), exclut les remakes et calcule les moyennes", () => {
    const r = myStats(games, { account: "all", role: "all", period: "season", minGames: 1 }, NOW);
    expect(r.games).toBe(6);
    expect(r.remakes).toBe(1);
    expect(r.patch).toBe("16.23");
    expect(r.accounts).toEqual(["Moi#EUW", "Smurf#EUW"]);
    const kaynJungle = r.lines.find((l) => l.championId === 141 && l.role === "JUNGLE")!;
    expect(kaynJungle.games).toBe(4);
    expect(kaynJungle.wins).toBe(3);
    expect(kaynJungle.winRate).toBe(75);
    // K = 6+2+6+6 = 20, M = 3+6+3+3 = 15, A = 9+4+9+9 = 31 → (20+31)/15
    expect(kaynJungle.kda).toBeCloseTo(51 / 15);
    // Or à 15 min : seulement les parties qui en ont une valeur.
    expect(kaynJungle.gold15).toBeCloseTo((6000 + 5000 + 6000) / 3);
    expect(kaynJungle.cs15).toBeCloseTo((100 + 90 + 100) / 3);
    expect(kaynJungle.csPerMin).toBeCloseTo((180 * 4) / ((1800 * 3 + 14 * 60) / 60));
    expect(r.lines[0]).toBe(kaynJungle); // trié par nombre de parties
    expect(r.total?.games).toBe(6);
  });

  it("filtre par compte, rôle, période et minimum de parties", () => {
    expect(myStats(games, { account: "Smurf#EUW", role: "all", period: "season", minGames: 1 }, NOW).games).toBe(1);
    expect(myStats(games, { account: "all", role: "MIDDLE", period: "season", minGames: 1 }, NOW).lines.map((l) => l.championId).sort()).toEqual([1, 141]);
    expect(myStats(games, { account: "all", role: "all", period: "30d", minGames: 1 }, NOW).games).toBe(5);
    expect(myStats(games, { account: "all", role: "all", period: "patch", minGames: 1 }, NOW).games).toBe(5);
    expect(myStats(games, { account: "all", role: "all", period: "season", minGames: 2 }, NOW).lines).toHaveLength(1);
    expect(myStats([], undefined, NOW)).toMatchObject({ lines: [], total: null, games: 0, patch: null });
  });

  it("compare les patchs numériquement", () => {
    expect(["16.10", "16.9", "16.23", "15.24"].sort(comparePatch)).toEqual(["15.24", "16.9", "16.10", "16.23"]);
  });
});

describe("lecture de la base", () => {
  it("lit les parties enregistrées par la collecte, sans rien écrire", () => {
    const dir = mkdtempSync(join(tmpdir(), "kayn-stats-"));
    const file = join(dir, "riot.db");
    try {
      expect(readMyGames(file)).toEqual([]); // pas encore de base
      const store = new CollectorStore(file);
      const game: MyGame = {
        matchId: "EUW1_1", account: "Moi#EUW", startMs: 5, durationS: 1500, patch: "16.23", championId: 141, role: "JUNGLE",
        win: true, remake: false, kills: 1, deaths: 2, assists: 3, cs: 150, vision: 20, gold15: 5500, cs15: 95, items: [6699], perks: null,
      };
      store.putGame(game);
      // Lecture pendant que la collecte a la base ouverte (WAL).
      expect(readMyGames(file)).toEqual([{
        matchId: "EUW1_1", account: "Moi#EUW", startMs: 5, durationS: 1500, patch: "16.23", championId: 141, role: "JUNGLE",
        win: true, remake: false, kills: 1, deaths: 2, assists: 3, cs: 150, vision: 20, gold15: 5500, cs15: 95,
      }]);
      store.close();
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* fichier encore verrouillé */ }
    }
  });
});
