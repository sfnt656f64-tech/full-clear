import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { CollectorStore, SCHEMA_V1, type MyGame } from "../desktop/collector/store";
import { comparePatch, DEFAULT_FILTER, myStats, seasonWeight, type MyGameRow, type StatsFilter } from "../desktop/stats/my-stats";
import { readMyGames } from "../desktop/stats/read";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 18);
let n = 0;
const g = (over: Partial<MyGameRow> = {}): MyGameRow => ({
  matchId: `EUW1_${n++}`, account: "Moi#EUW", startMs: NOW - DAY, durationS: 1800, patch: "16.23", season: 2026, championId: 141, role: "JUNGLE",
  win: true, remake: false, kills: 6, deaths: 3, assists: 9, cs: 180, vision: 30, gold15: 6000, cs15: 100, ...over,
});
const F = (over: Partial<StatsFilter> = {}): StatsFilter => ({ ...DEFAULT_FILTER, ...over });

const JAX = 24, FIORA = 114, CAMILLE = 164;

describe("mes stats par champion et par rôle", () => {
  const games = [
    g(), g({ win: false, kills: 2, deaths: 6, assists: 4, gold15: 5000, cs15: 90 }), g({ gold15: null, cs15: null, durationS: 14 * 60 }),
    g({ championId: 1, role: "MIDDLE", account: "Smurf#EUW", win: false }),
    g({ role: "MIDDLE" }),
    g({ remake: true, win: false }),
    g({ patch: "16.9", startMs: NOW - 60 * DAY }),
    // Saison précédente
    g({ patch: "15.24", season: 2025, startMs: NOW - 300 * DAY }),
    g({ patch: "15.10", season: 2025, startMs: NOW - 400 * DAY, championId: 1, role: "MIDDLE" }),
    // Champions joués par quelqu'un d'autre
    g({ championId: JAX, role: "TOP" }), g({ championId: FIORA, role: "TOP", season: 2025, patch: "15.3" }),
  ];

  it("regroupe par (champion, rôle) sur la saison en cours, exclut les remakes et calcule les moyennes", () => {
    const r = myStats(games, F(), NOW);
    expect(r.season).toBe(2026);
    expect(r.seasons).toEqual([2026, 2025]);
    expect(r.games).toBe(7);
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
    expect(r.total?.games).toBe(7);
  });

  it("filtre par saison", () => {
    expect(myStats(games, F({ season: 2025 }), NOW)).toMatchObject({ season: 2025, games: 3, patch: "15.24" });
    expect(myStats(games, F({ season: "all" }), NOW)).toMatchObject({ season: null, games: 10 });
  });

  it("écarte les champions exclus et compte les parties écartées", () => {
    const ex = F({ excluded: [JAX, FIORA, CAMILLE] });
    const r = myStats(games, ex, NOW);
    expect(r.lines.map((l) => l.championId)).not.toContain(JAX);
    expect(r.games).toBe(6);
    expect(r.excludedGames).toBe(1);
    const all = myStats(games, { ...ex, season: "all" }, NOW);
    expect(all.excludedGames).toBe(2);
    expect(all.lines.map((l) => l.championId)).not.toContain(FIORA);
  });

  it("filtre par compte, rôle, période et minimum de parties", () => {
    expect(myStats(games, F({ account: "Smurf#EUW" }), NOW).games).toBe(1);
    expect(myStats(games, F({ role: "MIDDLE" }), NOW).lines.map((l) => l.championId).sort()).toEqual([1, 141]);
    expect(myStats(games, F({ period: "30d" }), NOW).games).toBe(6);
    expect(myStats(games, F({ period: "patch" }), NOW).games).toBe(6);
    expect(myStats(games, F({ minGames: 2 }), NOW).lines).toHaveLength(1);
    expect(myStats([], undefined, NOW)).toMatchObject({ lines: [], total: null, games: 0, patch: null, season: null, seasons: [] });
  });

  it("compare les patchs numériquement", () => {
    expect(["16.10", "16.9", "16.23", "15.24"].sort(comparePatch)).toEqual(["15.24", "16.9", "16.10", "16.23"]);
  });

  it("donne moins de poids aux anciennes saisons", () => {
    expect([2026, 2025, 2024, 2021].map((s) => seasonWeight(s, 2026))).toEqual([1, 0.5, 0.25, 0.25]);
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
        matchId: "EUW1_1", account: "Moi#EUW", startMs: 5, durationS: 1500, patch: "16.23", season: 2026, championId: 141, role: "JUNGLE",
        win: true, remake: false, kills: 1, deaths: 2, assists: 3, cs: 150, vision: 20, gold15: 5500, cs15: 95, items: [6699], perks: null,
      };
      store.putGame(game);
      // Lecture pendant que la collecte a la base ouverte (WAL).
      expect(readMyGames(file)).toEqual([{
        matchId: "EUW1_1", account: "Moi#EUW", startMs: 5, durationS: 1500, patch: "16.23", season: 2026, championId: 141, role: "JUNGLE",
        win: true, remake: false, kills: 1, deaths: 2, assists: 3, cs: 150, vision: 20, gold15: 5500, cs15: 95,
      }]);
      store.close();
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* fichier encore verrouillé */ }
    }
  });

  it("migre une base v1 : la saison est déduite du patch des parties déjà enregistrées", () => {
    const dir = mkdtempSync(join(tmpdir(), "kayn-mig-"));
    const file = join(dir, "riot.db");
    try {
      // Base telle que créée par l'étape 1 (schéma v1, sans saison).
      const v1 = new DatabaseSync(file);
      v1.exec(SCHEMA_V1 + `
        insert into my_games values ('EUW1_1', 'Moi#EUW', 1, 1800, '16.23', 141, 'JUNGLE', 1, 0, 1, 1, 1, 100, 10, null, null, '[]', null);
        insert into my_games values ('EUW1_2', 'Moi#EUW', 1, 1800, '15.4', 141, 'JUNGLE', 0, 0, 1, 1, 1, 100, 10, null, null, '[]', null);
        pragma user_version = 1;`);
      v1.close();
      const store = new CollectorStore(file);
      store.close();
      expect(readMyGames(file).map((x) => [x.matchId, x.season])).toEqual([["EUW1_1", 2026], ["EUW1_2", 2025]]);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* fichier encore verrouillé */ }
    }
  });
});
