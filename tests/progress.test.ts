import { describe, expect, it } from "vitest";
import { axisImpact, ceiling, difficultyGroup, firstGamesEffect, forceAtEqualMastery, isotonic, learningCurve, MIX_MEASURED_MIN, OWN_CURVE_MIN, potentialScore, strengthFit, WEIGHTS, type AxisGame, type MasteryRow } from "../desktop/reco/progress";

const rows = (championId: number, spec: [points: number, n: number, wins: number][]): MasteryRow[] =>
  spec.flatMap(([points, n, wins]) => Array.from({ length: n }, (_, i) => ({ championId, points, win: i < wins })));

describe("potentiel de progression", () => {
  it("groupes de difficulté Riot", () => {
    expect([3, 4, 6, 7].map(difficultyGroup)).toEqual(["easy", "medium", "medium", "hard"]);
  });

  it("courbe croissante (régression isotone)", () => {
    expect(isotonic([40, 45, 43, 50], [1, 1, 1, 1])).toEqual([40, 44, 44, 50]);
  });

  it("peu de parties avec maîtrise : courbe du groupe seule ; assez : courbe propre", () => {
    const group = rows(1, [[5_000, 100, 40], [20_000, 100, 45], [40_000, 100, 48], [80_000, 100, 50], [150_000, 100, 52], [300_000, 100, 55]]);
    const few = rows(2, [[300_000, 10, 10]]); // 10 victoires sur 10 : le hasard
    const c = learningCurve(few, group);
    expect(c.own).toBe(false);
    expect(c.plateau).toBeCloseTo(52, 0); // tranche 100–200 k : la tranche ≥ 200 k (sélection) n'entre pas dans le plateau
    const many = rows(3, [[5_000, 40, 20], [20_000, 40, 21], [40_000, 40, 21], [80_000, 40, 21], [150_000, 40, 21], [300_000, OWN_CURVE_MIN, 54]]);
    expect(learningCurve(many, group).own).toBe(true);
    // Parties en fourchette (1 000 à 1 500 points par partie).
    expect(c.games[0]).toBeLessThanOrEqual(c.games[1]);
  });

  it("force à maîtrise égale : beaucoup de débutants → le brut sous-estime le champion ; rapprochée de 50 % avec peu de parties", () => {
    const group = rows(1, [[5_000, 200, 80], [300_000, 200, 110]]);
    const novices = rows(2, [[5_000, 90, 40], [300_000, 10, 5]]);
    const f = forceAtEqualMastery({ n: 1000, w: 520 }, novices, group);
    expect(f.mix).toBeLessThan(0);
    expect(f.adjusted).toBeGreaterThan(50);
    const small = forceAtEqualMastery({ n: 30, w: 21 }, [], group);
    expect(small.raw).toBeCloseTo(70, 0);
    expect(small.adjusted).toBeLessThan(53);
    // Part de débutants tirée du groupe (moins de 100 parties avec maîtrise sur le champion) : « à confirmer ».
    expect(f.mixMeasured).toBe(MIX_MEASURED_MIN <= 100);
    expect(small.mixMeasured).toBe(false);
  });

  it("accord : à quel point tes axes forts font gagner sur ce champion, par rapport aux autres junglers", () => {
    // Axe 0 : être fort fait gagner 70 % contre 30 % sur ce champion ; 55 % contre 45 % pour tous les junglers.
    const games = (hi: number, lo: number, n: number): AxisGame[] => [
      ...Array.from({ length: n }, (_, i) => ({ win: i < hi * n, axes: [80, 50] })),
      ...Array.from({ length: n }, (_, i) => ({ win: i < lo * n, axes: [20, 50] })),
    ];
    const champ = axisImpact(games(0.7, 0.3, 500), 2), all = axisImpact(games(0.55, 0.45, 5000), 2);
    const strongOnAxis0 = strengthFit([60, 40], champ, all);
    expect(strongOnAxis0.value).toBeGreaterThan(15); // (40 − 10) points, rapprochés de 0 (500 + 500 parties contre 300)
    expect(strongOnAxis0.margin).toBeGreaterThan(0);
    // Tes axes faibles ne comptent pas : fort seulement sur l'axe 1 (sans effet) → 0.
    expect(strengthFit([40, 60], champ, all).value).toBe(0);
    // Peu de parties : rapproché de 0.
    expect(Math.abs(strengthFit([60, 40], axisImpact(games(0.7, 0.3, 10), 2), all).value)).toBeLessThan(5);
  });

  it("plafond : non mesurable sous 20 parties à forte maîtrise", () => {
    expect(ceiling(rows(2, [[200_000, 10, 6]]), rows(1, [[200_000, 100, 50]])).measurable).toBe(false);
  });

  it("score pondéré 55 / 45 (durée d'apprentissage à 0 % pour l'instant)", () => {
    expect(WEIGHTS).toEqual({ force: 0.55, fit: 0.45, learning: 0 });
    const parts = { force: { raw: 55, games: 1000, margin: 3, mix: 0, adjusted: 54, mixMeasured: true }, fit: { value: 0, margin: 1, games: 1000, axes: [] }, curve: { points: [], plateau: 50, reach: 0, games: [3, 7] as [number, number], n: 0, own: false }, ceiling: { delta: 0, margin: 10, games: 0, measurable: false } };
    const s = potentialScore(parts);
    expect(s.force).toBe(70);
    expect(s.fit).toBe(50);
    expect(s.total).toBeCloseTo(0.55 * 70 + 0.45 * 50, 5); // durée d'apprentissage à 0 %
    // Tes résultats sur le champion : moitié-moitié à 20 parties.
    const m = potentialScore(parts, { stats: 42, games: 20 });
    expect(m.mine).toMatchObject({ score: 10, games: 20, weight: 0.5 });
    expect(m.total).toBeCloseTo(0.5 * 10 + 0.5 * s.potential, 5);
  });

  it("tes 10 premières parties contre les suivantes", () => {
    const champ = (a: number, b: number) => [...Array(10).fill({ score: a }), ...Array(15).fill({ score: b })];
    const r = firstGamesEffect([champ(40, 50), champ(45, 50), champ(50, 52)])!;
    expect(r.champions).toBe(3);
    expect(r.diff).toBeCloseTo((10 + 5 + 2) / 3, 5);
    expect(firstGamesEffect([champ(40, 50)])).toBeNull();
  });
});
