import { describe, expect, it } from "vitest";
import { AXES, radarOf, radarHighlights } from "../desktop/analysis/radar";
import { MetaRef } from "../desktop/analysis/overview";
import { classifyPool, classifyTried, potentialGroups } from "../desktop/reco/potential";
import type { AnalysisGame, MetaMetricRow } from "../desktop/analysis/analysis";
import type { PoolPick } from "../desktop/reco/recommend";

let n = 0;
const game = (over: Partial<AnalysisGame> = {}): AnalysisGame => ({
  matchId: `G${n++}`, account: "A#1", startMs: 1, durationS: 1800, patch: "16.23", season: 2026, championId: 141, role: "JUNGLE", win: true,
  kills: 6, deaths: 3, assists: 8, cs: 200, gold15: 6000, cs15: 100, cs10: 60, teamKills: 30, kills15: 2, assists15: 3, teamKills15: 10,
  objTeam: 4, objMine: 2, deaths15: 1, damage: 20000, teamDamage: 100000, ...over,
});
/** Méta : valeurs réparties autour des mêmes médianes que `game()` par défaut. */
const meta: MetaMetricRow[] = Array.from({ length: 200 }, (_, i) => {
  const d = (i % 21) - 10; // −10 … +10
  return { championId: 1, win: i % 2 === 0, cs10: 60 + d, cs15: 100 + d, gold15: 6000 + d * 50, deaths15: 1 + Math.sign(d) * (Math.abs(d) > 5 ? 1 : 0),
    kills15: 2, assists15: 3 + Math.round(d / 4), teamKills15: 10, objTeam: 4, objMine: 2 + Math.round(d / 5), kills: 6, assists: 8 + Math.round(d / 3), teamKills: 30,
    deaths: 3 + Math.round(d / 4), durationS: 1800, damage: 20000 + d * 1000, teamDamage: 100000 };
});
const ref = new MetaRef(new Map([["JUNGLE", meta]]));
const pool = (games: number, wr: number): PoolPick => ({
  championId: 141, role: "JUNGLE", score: wr + 3, games, weightedGames: games, winRate: wr, adjustedWinRate: wr, masteryPoints: 0,
  breakdown: { winRate: wr, meta: 0, games: 3, mastery: 0 }, kda: 3, meta: null, seasons: [], reasons: [], provisional: false,
});

describe("radar", () => {
  it("6 axes ; un joueur dans la médiane est autour de 50 partout", () => {
    const r = radarOf(Array.from({ length: 8 }, () => game()), ref)!;
    expect(AXES.map((a) => a.label)).toEqual(["Farm", "Early", "Teamfight", "Objectifs", "Survie", "Or"]);
    for (const v of r.values) { expect(v).not.toBeNull(); expect(v!).toBeGreaterThan(35); expect(v!).toBeLessThan(65); }
    expect(r.games).toBe(8);
  });

  it("bon farm et peu de morts : axes Farm et Survie hauts", () => {
    const r = radarOf(Array.from({ length: 8 }, () => game({ cs10: 72, cs15: 112, deaths15: 0, deaths: 1 })), ref)!;
    const h = radarHighlights(r);
    expect(h.strong).toEqual(expect.arrayContaining(["Farm", "Survie"]));
    expect(r.score!).toBeGreaterThan(55);
  });

  it("pas de radar sous 5 parties", () => {
    expect(radarOf([game(), game()], ref)).toBeNull();
  });
});

describe("classement par potentiel", () => {
  const radar = (score: number) => ({ values: [score, score, score, score, score, score], games: 20, score });

  it("à garder : assez de parties, bon win rate lissé, bonnes stats", () => {
    expect(classifyPool(pool(40, 55), radar(60)).group).toBe("keep");
  });
  it("à garder malgré des stats faibles si tu gagnes : à consolider", () => {
    const e = classifyPool(pool(40, 55), radar(40));
    expect(e.group).toBe("keep");
    expect(e.text).toContain("à consolider");
  });
  it("potentiel : très bonnes stats, win rate moyen ou peu de parties", () => {
    expect(classifyPool(pool(40, 48), radar(62)).group).toBe("potential");
    expect(classifyPool(pool(12, 56), radar(62)).group).toBe("potential");
    expect(classifyPool(pool(12, 56), radar(62)).text).toContain("potentiel à développer");
  });
  it("à mettre de côté : beaucoup de parties, stats et win rate sous la médiane", () => {
    const e = classifyPool(pool(30, 46), radar(42));
    expect(e.group).toBe("shelve");
    expect(e.provisional).toBe(false);
    // Peu de parties et stats faibles : de côté pour l'instant, provisoire.
    expect(classifyPool(pool(12, 47), radar(40))).toMatchObject({ group: "shelve", provisional: true });
  });
  it("sans radar : provisoire, sur le win rate", () => {
    expect(classifyPool(pool(40, 55), null)).toMatchObject({ group: "keep", provisional: true });
  });
  it("champion joué 5 à 9 fois : potentiel seulement avec de très bonnes stats", () => {
    expect(classifyTried({ championId: 64, games: 6, wins: 4 }, radar(60))?.group).toBe("potential");
    expect(classifyTried({ championId: 64, games: 6, wins: 4 }, radar(52))).toBeNull();
    const g = potentialGroups([pool(40, 55)], [{ championId: 64, games: 6, wins: 4 }], new Map([[141, radar(60)], [64, radar(60)]]));
    expect(g.keep.map((e) => e.championId)).toEqual([141]);
    expect(g.potential.map((e) => e.championId)).toEqual([64]);
  });
});
