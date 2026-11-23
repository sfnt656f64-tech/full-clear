import { describe, expect, it } from "vitest";
import { gamePlan, planTips } from "../desktop/coach/game-plan";
import { pairIndex } from "../desktop/reco/draft-pick";
import type { GankKillRow, TimelinePartRow } from "../desktop/meta/read";
import type { LaneRow } from "../desktop/reco/lanes";
import { champ } from "../src/data/champions";

type Row = LaneRow<{ id: string }>;
const row = (lane: Row["lane"], ally: string, enemy: string, me = false): Row => ({ lane, ally: { id: ally }, me, enemy: { id: enemy }, probable: true });
const LANES: Row[] = [
  row("TOP", "Garen", "Aatrox"),
  row("JUNGLE", "Kayn", "LeeSin", true),
  row("MIDDLE", "Syndra", "Ahri"),
  row("BOTTOM", "Jinx", "Ezreal"),
  row("UTILITY", "Leona", "Lulu"),
];
const KAYN = champ("Kayn").key!;

/** 100 parties : Kayn (équipe 100) gank surtout le bot avec succès, meurt souvent au top. */
function data(startTop = 70) {
  const parts: TimelinePartRow[] = [];
  const kills: GankKillRow[] = [];
  for (let i = 0; i < 100; i++) {
    const m = `M${i}`;
    parts.push({ matchId: m, team: 100, championId: KAYN, role: "JUNGLE", win: true, startSide: i < startTop ? "top" : "bot" });
    for (const [c, role] of [["Garen", "TOP"], ["Syndra", "MIDDLE"], ["Jinx", "BOTTOM"], ["Leona", "UTILITY"]]) parts.push({ matchId: m, team: 100, championId: champ(c).key!, role, win: true, startSide: null });
    for (const [c, role] of [["Aatrox", "TOP"], ["LeeSin", "JUNGLE"], ["Ahri", "MIDDLE"], ["Ezreal", "BOTTOM"], ["Lulu", "UTILITY"]]) parts.push({ matchId: m, team: 200, championId: champ(c).key!, role, win: false, startSide: null });
    if (i % 2 === 0) kills.push({ matchId: m, t: 240_000, lane: "BOTTOM", killerTeam: 100, killerRole: "JUNGLE", victimChamp: champ("Ezreal").key!, victimRole: "BOTTOM", assistRoles: ["UTILITY"] });
    if (i % 3 === 0) kills.push({ matchId: m, t: 300_000, lane: "TOP", killerTeam: 200, killerRole: "TOP", victimChamp: KAYN, victimRole: "JUNGLE", assistRoles: [] });
    if (i % 10 === 0) kills.push({ matchId: m, t: 300_000, lane: "TOP", killerTeam: 100, killerRole: "TOP", victimChamp: champ("Aatrox").key!, victimRole: "TOP", assistRoles: ["JUNGLE"] });
  }
  return { parts, kills };
}

describe("plan d'avant-partie", () => {
  it("chances par lane, premier gank, départ du côté opposé, objectifs", () => {
    const d = data();
    const p = gamePlan({ meChampion: KAYN, side: "blue", lanes: LANES, ...d, index: pairIndex([]) })!;
    const bot = p.lanes.find((l) => l.lane === "BOTTOM")!, top = p.lanes.find((l) => l.lane === "TOP")!;
    expect(bot.chance).toBeGreaterThan(top.chance);
    expect(p.firstGank).toBe("BOTTOM");
    expect(p.start).toEqual({ side: "top", buff: "Blue Buff", topShare: 70 });
    expect(p.objectives[0]).toContain("dragons");
    expect(bot.reasons.join(" ")).toMatch(/Leona a beaucoup de contrôle|réussit/);
    expect(p.games).toBe(100);
    expect(p.provisional).toBe(false);
    for (const l of p.lanes) { expect(l.chance).toBeGreaterThanOrEqual(10); expect(l.chance).toBeLessThanOrEqual(90); }
  });

  it("équipe rouge : le côté top est celui du Red Buff", () => {
    const p = gamePlan({ meChampion: KAYN, side: "red", lanes: LANES, ...data(), index: pairIndex([]) })!;
    expect(p.start.buff).toBe("Red Buff");
  });

  it("seulement en jungle", () => {
    const mid = LANES.map((r) => ({ ...r, me: r.lane === "MIDDLE" }));
    expect(gamePlan({ meChampion: KAYN, side: null, lanes: mid, ...data(), index: pairIndex([]) })).toBeNull();
  });

  it("sans données : chances neutres, plan provisoire", () => {
    const p = gamePlan({ meChampion: KAYN, side: null, lanes: LANES, kills: [], parts: [], index: pairIndex([]) })!;
    expect(p.provisional).toBe(true);
    expect(p.start.buff).toBeNull();
    expect(planTips(p)[0]).toMatch(/^Ganks estimés : Top \d+ % · Mid \d+ % · Bot \d+ %\.$/);
  });
});
