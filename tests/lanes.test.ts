import { describe, expect, it } from "vitest";
import { assignLanes, laneRows, roleShares } from "../desktop/reco/lanes";
import { draftPicks, pairIndex } from "../desktop/reco/draft-pick";
import type { MetaPartRow } from "../desktop/meta/meta-stats";
import type { PoolPick } from "../desktop/reco/recommend";
import { champ } from "../src/data/champions";

const K = (id: string) => champ(id).key!;
const parts = (id: string, roles: Record<string, number>) =>
  Object.entries(roles).flatMap(([role, n]) => Array.from({ length: n }, () => ({ championId: K(id), role })));
const SHARES = roleShares([
  ...parts("LeeSin", { JUNGLE: 95, TOP: 5 }),
  ...parts("Viego", { JUNGLE: 70, MIDDLE: 20, TOP: 10 }),
  ...parts("Ahri", { MIDDLE: 100 }),
  ...parts("Jinx", { BOTTOM: 100 }),
  ...parts("Leona", { UTILITY: 100 }),
  ...parts("Aatrox", { TOP: 90, JUNGLE: 10 }),
]);

describe("rôles adverses probables", () => {
  it("chaque champion à son rôle principal", () => {
    expect(assignLanes(["Ahri", "Jinx", "LeeSin"].map(K), SHARES)).toEqual(["MIDDLE", "BOTTOM", "JUNGLE"]);
  });

  it("composition déjà connue : Viego passe mid si Lee Sin est en jungle et Ahri… absente", () => {
    expect(assignLanes(["LeeSin", "Viego"].map(K), SHARES)).toEqual(["JUNGLE", "MIDDLE"]);
    // Avec Ahri au mid, Viego passe top.
    expect(assignLanes(["LeeSin", "Viego", "Ahri"].map(K), SHARES)).toEqual(["JUNGLE", "TOP", "MIDDLE"]);
  });

  it("lignes Top → Support : alliés à leur poste, adversaires « probable »", () => {
    const rows = laneRows(
      [{ champ: "Kayn", position: "jungle", me: true }, { champ: "Ornn", position: "top" }, { champ: null, position: "utility" }],
      [{ id: K("Jinx"), champ: "Jinx" }, { id: K("Aatrox"), champ: "Aatrox" }],
      SHARES,
    );
    expect(rows.map((r) => [r.lane, r.ally, r.me, r.enemy, r.probable])).toEqual([
      ["TOP", "Ornn", false, "Aatrox", true],
      ["JUNGLE", "Kayn", true, null, false],
      ["MIDDLE", null, false, null, false],
      ["BOTTOM", null, false, "Jinx", true],
      ["UTILITY", null, false, null, false],
    ]);
  });
});

describe("duels pondérés par le rôle", () => {
  let m = 0;
  function games(champId: number, n: number, wins: number, enemy?: number): MetaPartRow[] {
    return Array.from({ length: n }, (_, i) => {
      const matchId = `L${m++}`;
      const rows: MetaPartRow[] = [{ matchId, team: 100, championId: champId, role: "JUNGLE", win: i < wins, items: [], perks: null }];
      if (enemy) rows.push({ matchId, team: 200, championId: enemy, role: "X", win: i >= wins, items: [], perks: null });
      return rows;
    }).flat();
  }
  const pool = (id: number, score: number): PoolPick => ({
    championId: id, role: "JUNGLE", score, games: 50, weightedGames: 50, winRate: 55, adjustedWinRate: score, masteryPoints: 0,
    breakdown: { winRate: score, meta: 0, games: 0, mastery: 0 }, kda: 3, meta: null, seasons: [], reasons: [], provisional: false,
  });

  it("le vis-à-vis en jungle compte plus que le support, et la raison nomme le rôle", () => {
    const KAYN = K("Kayn"), LEE = K("LeeSin"), LEONA = K("Leona");
    const idx = pairIndex([...games(KAYN, 300, 150), ...games(KAYN, 100, 70, LEE), ...games(KAYN, 100, 70, LEONA)]);
    const base = { role: "JUNGLE", myTurn: false, allies: [], unavailable: [], pool: [pool(KAYN, 55)], meta: [], index: idx };
    const r = draftPicks({ ...base, enemies: [LEE, LEONA], enemyLanes: new Map([[LEE, "JUNGLE" as const], [LEONA, "UTILITY" as const]]) });
    const flat = draftPicks({ ...base, enemies: [LEE, LEONA] });
    const k = r.list[0];
    expect(k.reasons[0]).toMatch(/^Bon contre Lee Sin \(jungle\)/);
    // 1,5 + 0,5 = 2 fois l'effet unitaire, comme sans rôles (1 + 1), mais réparti différemment.
    expect(k.counter).toBeCloseTo(flat.list[0].counter);
    expect(k.reasons.join(" ")).toContain("Leona (support)");
  });
});
