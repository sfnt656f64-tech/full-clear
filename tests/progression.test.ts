import { describe, expect, it } from "vitest";
import { isComfort, progressAdvice, progression, readiness, type ProgressInputs } from "../desktop/reco/progression";
import type { Radar } from "../desktop/analysis/radar";

const radar = (score: number, margin = 3): Radar => ({ values: [score, score, score, score, score, score], games: 20, score, margin });
const base = (over: Partial<ProgressInputs> = {}): ProgressInputs => ({
  metaRates: new Map([[1, { n: 500, w: 270 }], [2, { n: 500, w: 240 }], [3, { n: 500, w: 250 }], [4, { n: 500, w: 260 }]]),
  mastery: [], difficulty: () => 5, axisGames: new Map(), myRadar: radar(52), mine: new Map(),
  played: new Map([[3, 80]]), points: new Map([[4, 200_000]]), excluded: new Set(), flags: new Map(), tau: 2.5, ...over,
});

describe("progression : confort, candidats, tes choix", () => {
  it("chaque champion tombe dans un seul groupe : confort (≥ 50 parties ou ≥ 150 k points) ou candidat", () => {
    const p = progression(base());
    expect(p.comfort.map((c) => c.championId).sort()).toEqual([3, 4]);
    expect(p.candidates.map((c) => c.championId)).toEqual([1, 2]); // 54 % avant 48 %
    expect(isComfort(3, new Map([[3, 49]]), new Map())).toBe(false);
  });
  it("« Je veux progresser dessus » prime sur le seuil ; « Pas pour moi » écarte même un champion jamais joué", () => {
    const p = progression(base({ flags: new Map([[3, "progress"], [1, "notForMe"]]) }));
    expect(p.candidates[0].championId).toBe(3);
    expect(p.candidates.map((c) => c.championId)).not.toContain(1);
    expect(p.notForMe).toEqual([1]);
  });
  it("pool conseillé : 2 champions de progression et le meilleur « À garder » en confort, même sous le seuil", () => {
    const p = progression(base());
    const a = progressAdvice(p, [{ championId: 9, games: 26 }], 3);
    expect(a.picks.map((x) => x.championId)).toEqual([1, 2, 9]);
    expect(a.picks[2].why[0]).toMatch(/^Confort/);
  });
});

describe("repère « prêt pour la classée »", () => {
  it("en apprentissage, continuer en normale, prêt à tester", () => {
    expect(readiness({ experience: 12, standard: radar(55), ranked: null, rankedGames: 0 }).stage).toBe("learning");
    expect(readiness({ experience: 25, standard: radar(48), ranked: null, rankedGames: 2 }).stage).toBe("keepPracticing");
    // Score ≥ 50 sans compter la marge.
    expect(readiness({ experience: 20, standard: radar(50.5, 6), ranked: null, rankedGames: 0 }).stage).toBe("readyToTest");
  });
  it("après 20 parties classées : confirmé, retour en normale, ou à confirmer", () => {
    expect(readiness({ experience: 40, standard: radar(52), ranked: radar(51), rankedGames: 20 }).stage).toBe("confirmed");
    expect(readiness({ experience: 40, standard: radar(52), ranked: radar(44, 4), rankedGames: 20 }).stage).toBe("backToNormal");
    expect(readiness({ experience: 40, standard: radar(52), ranked: radar(48, 4), rankedGames: 20 }).stage).toBe("toConfirm");
  });
});
