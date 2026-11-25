import { describe, expect, it } from "vitest";
import { ceiling, difficultyGroup, firstGamesEffect, forceAtEqualMastery, isotonic, learningCurve, OWN_CURVE_MIN, potentialScore, profileFit, WEIGHTS, type MasteryRow } from "../desktop/reco/progress";

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
    expect(c.plateau).toBeCloseTo(55, 0);
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
  });

  it("accord : seulement tes axes forts comptent", () => {
    const me = [40, 50, 60, 45, 55, 50];
    expect(profileFit(me, [30, 50, 50, 30, 50, 50])).toBe(0); // fort là où tu es faible : sans effet
    expect(profileFit(me, [50, 50, 70, 50, 60, 50])).toBeGreaterThan(5);
  });

  it("plafond : non mesurable sous 20 parties à forte maîtrise", () => {
    expect(ceiling(rows(2, [[200_000, 10, 6]]), rows(1, [[200_000, 100, 50]])).measurable).toBe(false);
  });

  it("score pondéré 40 / 35 / 25", () => {
    expect(WEIGHTS).toEqual({ force: 0.4, fit: 0.35, learning: 0.25 });
    const s = potentialScore({ force: { raw: 50, games: 1000, margin: 3, mix: 0, adjusted: 50 }, fit: 0, curve: { points: [], plateau: 50, reach: 0, games: [3, 7], n: 0, own: false }, ceiling: { delta: 0, margin: 10, games: 0, measurable: false } });
    expect(s.force).toBe(50);
    expect(s.fit).toBe(50);
    expect(s.total).toBeCloseTo(0.4 * 50 + 0.35 * 50 + 0.25 * s.learning, 5);
  });

  it("tes 10 premières parties contre les suivantes", () => {
    const champ = (a: number, b: number) => [...Array(10).fill({ score: a }), ...Array(15).fill({ score: b })];
    const r = firstGamesEffect([champ(40, 50), champ(45, 50), champ(50, 52)])!;
    expect(r.champions).toBe(3);
    expect(r.diff).toBeCloseTo((10 + 5 + 2) / 3, 5);
    expect(firstGamesEffect([champ(40, 50)])).toBeNull();
  });
});
