import { describe, expect, it } from "vitest";
import { compoKinds, poolAdvice, wilson } from "../desktop/reco/pool-advice";
import type { PotentialEntry } from "../desktop/reco/potential";
import type { PoolPick } from "../desktop/reco/recommend";
import { champ } from "../src/data/champions";

const K = (id: string) => champ(id).key!;
const entry = (id: string, group: "keep" | "potential", score: number, games = 40): PotentialEntry => ({ championId: K(id), group, games, winRate: 52, radar: null, text: "", provisional: false, score });
const pick = (id: string): PoolPick => ({ championId: K(id), role: "JUNGLE", score: 55, games: 40, weightedGames: 40, winRate: 55, adjustedWinRate: 52, masteryPoints: 0,
  breakdown: { winRate: 52, meta: 0, games: 3, mastery: 0 }, kda: 3, meta: null, seasons: [], reasons: [], provisional: false });

describe("pool conseillé", () => {
  it("préfère un champion aux dégâts différents ; couverture et win rate dedans / dehors", () => {
    const groups = { keep: [entry("Kayn", "keep", 60), entry("Viego", "keep", 58)], potential: [entry("Diana", "potential", 55)], neutral: [], shelve: [] };
    const myGames = [...Array.from({ length: 30 }, (_, i) => ({ championId: K("Kayn"), win: i < 18 })), ...Array.from({ length: 30 }, (_, i) => ({ championId: K("Shyvana"), win: i < 12 }))];
    const a = poolAdvice({ role: "JUNGLE", groups, pool: ["Kayn", "Viego", "Diana"].map(pick), tryList: [], myGames, earlyIndex: new Map(), compo: new Map() });
    expect(a.fromMeta).toBe(false);
    expect(a.picks.map((p) => p.championId).slice(0, 2)).toEqual([K("Kayn"), K("Diana")]); // Diana : dégâts magiques
    expect(a.picks[1].why.join(" ")).toContain("dégâts magiques");
    expect(a.coverage).toMatchObject({ games: 30, total: 60, inPool: { w: 18, n: 30 }, outside: { w: 12, n: 30 } });
    expect(a.text).toContain("50 % de tes parties du rôle sur la saison en cours");
    expect(a.text).toMatch(/60 % ± \d+ \(30 parties\)/);
  });

  it("trop peu de champions joués dans le rôle : proposés d'après la méta, et c'est signalé", () => {
    const groups = { keep: [], potential: [], neutral: [], shelve: [] };
    const tryList = [{ championId: K("Ahri"), role: "MIDDLE", score: 70, meta: { games: 400, winRate: 52 }, similarTo: [], learning: { games: null, novice: null, expert: null }, tried: null, reasons: ["Proche de Kayn"], provisional: false }];
    const a = poolAdvice({ role: "MIDDLE", groups, pool: [], tryList, myGames: [], earlyIndex: new Map(), compo: new Map() });
    expect(a.fromMeta).toBe(true);
    expect(a.picks.map((p) => p.championId)).toEqual([K("Ahri")]);
    expect(a.text).toContain("ressemblance avec tes meilleurs champions de jungle");
  });

  it("types de compos et marge de Wilson", () => {
    expect(compoKinds(["Ornn", "Sejuani", "Ahri", "Jinx", "Lulu"].map(champ))).toContain("tanks");
    expect(wilson(50, 100)).toBeCloseTo(9.6, 0);
  });
});
