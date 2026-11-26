import { describe, expect, it } from "vitest";
import { goalLines, keyMoments, WORK_GAMES, workPoints } from "../desktop/analysis/postgame";
import { MetaRef } from "../desktop/analysis/overview";
import type { Detail } from "../desktop/collector/detail";
import type { AnalysisGame } from "../desktop/analysis/analysis";

const MIN = 60_000;
const detail = (): Detail => ({
  account: "A",
  match: { matchId: "M", duration: 1800, start: 0, version: "16.23.1", queue: 420, teams: [], parts: [
    { participantId: 2, teamId: 100, championId: 141, teamPosition: "JUNGLE", me: true },
    { participantId: 7, teamId: 200, championId: 64, teamPosition: "JUNGLE", me: false },
  ] },
  timeline: { frames: [{ t: 0, p: {}, e: [
    { type: "CHAMPION_KILL", timestamp: 4 * MIN, killerId: 7, victimId: 2 },
    { type: "ELITE_MONSTER_KILL", timestamp: 4.5 * MIN, killerTeamId: 200, monsterType: "DRAGON", monsterSubType: "FIRE_DRAGON" },
    { type: "CHAMPION_KILL", timestamp: 6 * MIN, killerId: 2, victimId: 7 },
    { type: "ELITE_MONSTER_KILL", timestamp: 7 * MIN, killerTeamId: 100, killerId: 2, monsterType: "HORDE" },
    { type: "ELITE_MONSTER_KILL", timestamp: 7.5 * MIN, killerTeamId: 100, monsterType: "HORDE" },
  ] }] },
});

describe("analyse d'après-partie", () => {
  it("moments clés : mort (et l'objectif adverse qui suit), kill, objectifs (larves regroupées)", () => {
    const m = keyMoments(detail());
    expect(m.map((x) => `${x.time} ${x.kind}`)).toEqual(["4:00 death", "4:30 objective-theirs", "6:00 kill", "7:00 objective-ours"]);
    expect(m[0].text).toMatch(/Lee Sin en 1 contre 1 — ils prennent dragon à 4:30/);
    expect(m[3].text).toMatch(/par toi/);
  });

  it("objectifs de la semaine sur la partie, sans conclusion", () => {
    const g = goalLines({ cededEarly: 2, uncompensatedEarly: 1, deathsBeforeObj: 1, cs10: 70, cs10diff: -4 } as never, { uncompensatedEarly: 35, deathsBeforeObj: 0.9, cs10: 72 });
    expect(g.map((x) => [x.key, x.met])).toEqual([["uncompensatedEarly", false], ["deathsBeforeObj", false], ["cs10", false]]);
    expect(g[2].value).toBe("70 (−4 face au jungler adverse)");
  });

  it("points à travailler : rien sous 20 parties", () => {
    const few = Array.from({ length: WORK_GAMES - 1 }, () => ({}) as AnalysisGame);
    expect(workPoints(few, new MetaRef(new Map()), "Émeraude", {} as AnalysisGame)[0]).toMatch(/Moins de 20 parties/);
  });
});
