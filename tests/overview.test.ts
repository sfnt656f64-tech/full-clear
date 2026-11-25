import { describe, expect, it } from "vitest";
import { championTable, evolution, filterGames, MetaRef, overview, percentile, type OverviewFilter } from "../desktop/analysis/overview";
import type { AnalysisGame, MetaMetricRow } from "../desktop/analysis/analysis";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20);
let n = 0;
const game = (over: Partial<AnalysisGame> = {}): AnalysisGame => ({
  matchId: `G${n++}`, account: "A#1", startMs: NOW - DAY, durationS: 1800, patch: "16.23", season: 2026, championId: 141, role: "JUNGLE", win: true,
  kills: 6, deaths: 3, assists: 8, cs: 200, gold15: 6000, cs15: 100, cs10: 60, teamKills: 30, kills15: 2, assists15: 3, teamKills15: 10,
  objTeam: 4, objMine: 3, deaths15: 1, ...over,
});
const meta = (championId: number, k: number, over: Partial<MetaMetricRow> = {}): MetaMetricRow[] =>
  Array.from({ length: k }, (_, i) => ({ championId, win: i % 2 === 0, cs10: 50 + (i % 21), cs15: 90 + (i % 21), gold15: 5500 + (i % 11) * 100, deaths15: i % 3,
    kills15: 2, assists15: 3, teamKills15: 10, objTeam: 4, objMine: 2, kills: 6, assists: 8, teamKills: 30, ...over }));
const ALL: OverviewFilter = { championId: null, role: null, period: { kind: "all" }, account: null };

describe("filtres", () => {
  const gs = [
    game({ championId: 141 }), game({ championId: 233, account: "B#2" }), game({ role: "MIDDLE", championId: 103 }),
    game({ season: 2025, patch: "15.20", startMs: NOW - 300 * DAY }), game({ patch: "16.22", startMs: NOW - 40 * DAY }),
  ];
  it("champion, rôle, compte, saison, 30 jours, dernier patch", () => {
    expect(filterGames(gs, { ...ALL, championId: 233 })).toHaveLength(1);
    expect(filterGames(gs, { ...ALL, role: "JUNGLE" })).toHaveLength(4);
    expect(filterGames(gs, { ...ALL, account: "B#2" })).toHaveLength(1);
    expect(filterGames(gs, { ...ALL, period: { kind: "season", season: 2025 } })).toHaveLength(1);
    expect(filterGames(gs, { ...ALL, period: { kind: "30d" } }, NOW)).toHaveLength(3);
    expect(filterGames(gs, { ...ALL, period: { kind: "patch" } })).toHaveLength(3);
  });
});

describe("vue d'ensemble", () => {
  it("position dans le bon sens (morts : moins = mieux)", () => {
    const xs = [0, 1, 1, 2, 3].sort((a, b) => a - b);
    expect(percentile(0, xs, "-")).toBe(90);
    expect(percentile(3, xs, "+")).toBe(90);
    expect(percentile(1, xs, "+")).toBe(40);
  });

  it("moyennes, position, points forts et faibles, win rate de la méta", () => {
    const gs = Array.from({ length: 10 }, (_, i) => game({ cs10: 72, deaths15: 0, objMine: 1, win: i < 6 }));
    const ref = new MetaRef(new Map([["JUNGLE", meta(141, 100)]]));
    const o = overview(gs, ref, { ...ALL, championId: 141, role: "JUNGLE" }, 2026);
    expect(o.games).toBe(10);
    expect(o.winRate).toBe(60);
    expect(o.metaWinRate).toBe(50);
    expect(o.comparedTo).toBe("champion");
    const cs10 = o.metrics.find((m) => m.key === "cs10")!;
    expect(cs10.mine).toBe(72);
    expect(cs10.rank).toBeGreaterThan(95);
    expect(o.strengths.map((m) => m.key)).toContain("cs10");
    expect(o.strengths.map((m) => m.key)).toContain("deaths15");
    expect(o.weaknesses.map((m) => m.key)).toContain("obj");
    expect(o.oldSeasons).toBe(false);
    expect(o.metrics.find((m) => m.key === "kpLate")!.mine).toBeCloseTo(((6 + 8 - 2 - 3) / 20) * 100);
  });

  it("plusieurs rôles : chaque partie comparée à son rôle, pas de médiane unique", () => {
    const ref = new MetaRef(new Map([["JUNGLE", meta(141, 50)], ["MIDDLE", meta(103, 50, { cs10: 80 })]]));
    const o = overview([game(), game({ role: "MIDDLE", championId: 103, cs10: 70, season: 2025 })], ref, ALL, 2026);
    expect(o.comparedTo).toBe("mixed");
    expect(o.metrics.find((m) => m.key === "cs10")!.median).toBeNull();
    expect(o.oldSeasons).toBe(true);
  });
});

describe("évolution et tableau", () => {
  it("patch par patch sur une courte période, mois par mois au-delà de 3 mois", () => {
    const short = [game({ patch: "16.22", win: false }), game({ patch: "16.23" }), game({ patch: "16.23", cs10: 70 })];
    const e = evolution(short);
    expect(e.by).toBe("patch");
    expect(e.points.map((p) => [p.label, p.games, p.winRate])).toEqual([["16.22", 1, 0], ["16.23", 2, 100]]);
    expect(e.points[1].values.cs10).toBe(65);
    const long = [game({ startMs: Date.UTC(2026, 0, 10) }), game({ startMs: Date.UTC(2026, 5, 10) })];
    expect(evolution(long).points.map((p) => p.label)).toEqual(["janv. 26", "juin 26"]);
  });

  it("tes champions entre eux (au moins 3 parties)", () => {
    const gs = [...Array.from({ length: 4 }, () => game({ championId: 141, cs10: 60 })), ...Array.from({ length: 3 }, () => game({ championId: 233, cs10: 70 })), game({ championId: 64 })];
    const t = championTable(gs, new MetaRef(new Map([["JUNGLE", meta(141, 40)]])));
    expect(t.map((r) => [r.championId, r.games, r.values.cs10])).toEqual([[141, 4, 60], [233, 3, 70]]);
    expect(t[0].medians.cs10).not.toBeNull(); // assez de méta sur Kayn
    expect(t[1].medians.cs10).toBeNull();
  });
});
