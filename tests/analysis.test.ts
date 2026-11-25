import { describe, expect, it } from "vitest";
import { MetaRef } from "../desktop/analysis/overview";
import { analyseGame, MIN_META_CHAMP, type AnalysisGame, type MetaMetricRow } from "../desktop/analysis/analysis";

let n = 0;
const game = (over: Partial<AnalysisGame> = {}): AnalysisGame => ({
  matchId: `G${n++}`, account: "Moi#EUW", startMs: 1, durationS: 1800, patch: "16.23", championId: 141, role: "JUNGLE", win: true,
  kills: 5, deaths: 3, assists: 7, cs: 200, gold15: 5500, cs15: 90, cs10: 55, teamKills: 25, kills15: 2, assists15: 3, teamKills15: 10,
  objTeam: 4, objMine: 2, deaths15: 2, ...over,
});
const meta = (championId: number, k: number, over: Partial<MetaMetricRow> = {}): MetaMetricRow[] =>
  Array.from({ length: k }, (_, i) => ({ championId, win: i % 2 === 0, cs10: 60 + (i % 11) - 5, cs15: 100 + (i % 21) - 10, gold15: 6000, deaths15: 1,
    kills15: 2, assists15: 3, teamKills15: 10, objTeam: 4, objMine: 3, ...over }));

const ref = (rows: MetaMetricRow[]) => new MetaRef(new Map([["JUNGLE", rows]]));

describe("analyse d'après-partie", () => {
  it("compare au même champion s'il y a assez de parties, sinon à tout le rôle", () => {
    const g = game();
    const a = analyseGame(g, [], [g], ref(meta(141, MIN_META_CHAMP)));
    expect(a.comparedTo).toBe("champion");
    const b = analyseGame(g, [], [g], ref([...meta(141, 5), ...meta(64, 100)]));
    expect(b.comparedTo).toBe("role");
    expect(b.metaGames).toBe(105);
  });

  it("position (100 = meilleur) dans le bon sens, y compris pour les morts", () => {
    const g = game({ cs10: 70, deaths15: 0 });
    const a = analyseGame(g, [], [g], ref(meta(141, 100)));
    const cs10 = a.metrics.find((m) => m.key === "cs10")!;
    const d = a.metrics.find((m) => m.key === "deaths15")!;
    expect(cs10.rank).toBeGreaterThan(90);
    expect(cs10.median).toBe(60);
    expect(d.rank).toBeGreaterThan(90); // 0 mort contre 1 : mieux
    expect(a.metrics.find((m) => m.key === "kp15")!.mine).toBe(50);
    expect(a.metrics.find((m) => m.key === "obj")!.mine).toBe(50);
  });

  it("points à travailler : les plus gros écarts, avec l'évolution sur tes dernières parties", () => {
    // 10 parties (la plus récente d'abord) : CS bas mais en progrès, morts nombreuses.
    const recent = Array.from({ length: 10 }, (_, i) => game({ cs10: 52 - i, deaths15: 3, gold15: 6000, objMine: 3, cs15: 100 }));
    const a = analyseGame(recent[0], [], recent, ref(meta(141, 100)));
    const keys = a.focus.map((f) => f.key);
    expect(keys).toContain("cs10");
    expect(keys).toContain("deaths15");
    expect(a.focus.length).toBeLessThanOrEqual(3);
    const cs = a.focus.find((f) => f.key === "cs10")!;
    expect(cs.trend).toEqual([43, 44, 45, 46, 47, 48, 49, 50, 51, 52]); // de la plus ancienne à la plus récente
    expect(cs.progress).toBeGreaterThan(0);
    expect(cs.text).toMatch(/CS à 10 min : 47,5 en moyenne, contre 60 en Émeraude\+.*En progrès/);
    expect(a.focusGames).toBe(10);
  });
});
