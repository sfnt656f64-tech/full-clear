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
  objTeam: 4, objMine: 2, deaths15: 1, damage: 20000, teamDamage: 100000, gd10: 0, xd10: 0, fb: 0.5, gd15: 0, solo15: 0.5, obj20: 50, conc20: 1, ...over,
});
/** Méta : valeurs réparties autour des mêmes médianes que `game()` par défaut. */
const meta: MetaMetricRow[] = Array.from({ length: 200 }, (_, i) => {
  const d = (i % 21) - 10; // −10 … +10
  return { championId: 1, win: i % 2 === 0, cs10: 60 + d, cs15: 100 + d, gold15: 6000 + d * 50, deaths15: 1 + Math.sign(d) * (Math.abs(d) > 5 ? 1 : 0),
    kills15: 2, assists15: 3 + Math.round(d / 4), teamKills15: 10, objTeam: 4, objMine: 2 + Math.round(d / 5), kills: 6, assists: 8 + Math.round(d / 3), teamKills: 30,
    deaths: 3 + Math.round(d / 4), durationS: 1800, damage: 20000 + d * 1000, teamDamage: 100000,
    gd10: d * 40, xd10: d * 30, fb: i % 2, gd15: d * 60, solo15: Math.abs(d) > 5 ? 1 : 0, obj20: 50 + d * 4, conc20: 1 + Math.sign(d) };
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
  const radar = (score: number, margin = 2) => ({ values: [score, score, score, score, score, score], games: 20, score, margin });

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
    expect(classifyPool(pool(12, 48), radar(62))).toMatchObject({ group: "potential", provisional: true });
    expect(classifyPool(pool(12, 48), radar(62)).text).toContain("potentiel à développer");
    // Bon win rate lissé mais moins de 15 parties : pas encore « À garder ».
    expect(classifyPool(pool(12, 56), radar(62))).toMatchObject({ group: "potential", provisional: true });
    expect(classifyPool(pool(16, 56), radar(62))).toMatchObject({ group: "keep", provisional: true });
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

describe("groupe neutre", () => {
  const radar = (score: number, margin = 2) => ({ values: [score, score, score, score, score, score], games: 20, score, margin });
  it("au moins 20 parties, stats 50–55, win rate lissé sous 50 % : neutre, pas prioritaire", () => {
    expect(classifyPool(pool(63, 48), radar(50)).group).toBe("neutral"); // Jarvan IV
    expect(classifyPool(pool(25, 36), radar(52)).group).toBe("neutral"); // Bel'Veth
  });
  it("moins de 20 parties, stats 50–55 : potentiel à confirmer", () => {
    expect(classifyPool(pool(15, 46), radar(52))).toMatchObject({ group: "potential", provisional: true });
  });
  it("stats ≥ 55 et win rate correct : à garder ; stats ≥ 55 et win rate moyen : potentiel", () => {
    expect(classifyPool(pool(26, 55), radar(55)).group).toBe("keep"); // Nocturne
    expect(classifyPool(pool(26, 49), radar(56)).group).toBe("potential");
  });
});

describe("marge d'erreur des stats", () => {
  const radar = (score: number, margin: number) => ({ values: [score, score, score, score, score, score], games: 30, score, margin });
  it("au-dessus de la médiane seulement si toute la marge est au-dessus de 50", () => {
    expect(classifyPool(pool(30, 49), radar(53, 2)).group).toBe("potential");
    expect(classifyPool(pool(30, 49), radar(53, 5))).toMatchObject({ group: "neutral" });
    expect(classifyPool(pool(30, 49), radar(53, 5)).text).toContain("stats 53,0 ± 5,0 (50 = médiane Émeraude)");
  });
  it("sous la médiane seulement si toute la marge est sous 50", () => {
    expect(classifyPool(pool(30, 46), radar(46, 3)).group).toBe("shelve");
    expect(classifyPool(pool(30, 46), radar(46, 6)).group).toBe("neutral");
  });
  it("le radar calcule la marge à partir des parties", () => {
    const r = radarOf(Array.from({ length: 10 }, (_, i) => game({ cs10: i % 2 ? 70 : 50, cs15: i % 2 ? 110 : 90 })), ref)!;
    expect(r.margin).not.toBeNull();
    expect(r.margin!).toBeGreaterThan(0);
  });
});

describe("seuil de 15 parties pour « À garder »", () => {
  const radar = (score: number, margin: number) => ({ values: [score, score, score, score, score, score], games: 10, score, margin });
  it("Sylas (10 parties, 52,4 % lissé, stats 41,8 ± 12,8) : pas « À garder », et le texte dit pourquoi", () => {
    const e = classifyPool(pool(10, 52.4), radar(41.8, 12.8));
    expect(e.group).toBe("potential");
    expect(e.provisional).toBe(true);
    expect(e.text).toContain("moins de 15 parties : pas encore « À garder »");
  });
  it("15 parties et win rate lissé ≥ 51 % : À garder", () => {
    expect(classifyPool(pool(15, 52), radar(48, 5)).group).toBe("keep");
    expect(classifyPool(pool(14, 52), radar(42, 3)).group).toBe("neutral");
    expect(classifyPool(pool(14, 52), null).group).toBe("neutral");
  });
});

describe("règles sans trou", () => {
  const radar = (score: number, margin = 2) => ({ values: [score, score, score, score, score, score], games: 20, score, margin });
  const axes = (v: number[], margin = 0.5) => ({ values: v, games: 20, score: v.reduce((a, b) => a + b) / v.length, margin });
  it("Volibear (28 parties, 50,4 % lissé, stats 47) : neutre, avec les axes faibles cités", () => {
    const e = classifyPool(pool(28, 50.4), axes([40, 52, 45, 44, 55, 49]));
    expect(e.group).toBe("neutral");
    expect(e.provisional).toBe(false);
    expect(e.text).toContain("Farm (40,0)");
    expect(e.text).not.toContain("peu de parties");
  });
  it("Nocturne (19 parties, 50,85 % lissé, stats 54,6) : potentiel à confirmer, pas « À garder » (seuil 51 %)", () => {
    expect(classifyPool(pool(19, 50.85), radar(54.6))).toMatchObject({ group: "potential", provisional: true });
  });
  it("« à consolider » cite toujours au moins un axe", () => {
    expect(classifyPool(pool(60, 54), axes([48, 55, 44, 50, 46, 52])).text).toContain("à consolider sur Teamfight (44,0) et Survie (46,0)");
  });
  it("chaque combinaison tombe dans un groupe", () => {
    for (const wr of [45, 49.9, 50, 50.5, 51, 55]) for (const st of [40, 49.9, 50, 54.9, 55, 60]) for (const g of [10, 19, 20, 60]) {
      const e = classifyPool(pool(g, wr), radar(st));
      expect(["keep", "potential", "neutral", "shelve"]).toContain(e.group);
      expect(e.provisional).toBe(g < 20);
      if (g < 20) expect(e.text).toMatch(/confirmer/);
      else expect(e.text).not.toMatch(/peu de parties|moins de 20/);
    }
  });
});
