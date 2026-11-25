import { describe, expect, it } from "vitest";
import { duelValues } from "../desktop/analysis/opponent";

const MIN = 60_000;
const parts = [
  { participantId: 2, teamId: 100, teamPosition: "JUNGLE" }, { participantId: 1, teamId: 100, teamPosition: "TOP" },
  { participantId: 7, teamId: 200, teamPosition: "JUNGLE" }, { participantId: 6, teamId: 200, teamPosition: "TOP" },
];
const frame = (t: number, g2: number, g7: number, x2: number, x7: number, e: Record<string, unknown>[] = []) =>
  ({ t, p: { "2": { totalGold: g2, xp: x2 }, "7": { totalGold: g7, xp: x7 } }, e });

describe("mesures de duel (chronologie)", () => {
  const timeline = { frames: [
    frame(0, 500, 500, 0, 0),
    frame(5 * MIN, 1800, 1700, 1500, 1600, [
      { type: "CHAMPION_KILL", timestamp: 3 * MIN, killerId: 1, victimId: 6, assistingParticipantIds: [2] }, // first blood, tu assistes
      { type: "CHAMPION_KILL", timestamp: 4 * MIN, killerId: 7, victimId: 2 }, // mort en 1 contre 1
      { type: "ELITE_MONSTER_KILL", timestamp: 6 * MIN, killerTeamId: 100, monsterType: "DRAGON" },
      { type: "ELITE_MONSTER_KILL", timestamp: 9 * MIN, killerTeamId: 200, monsterType: "HORDE" }, // cédé, sans contrepartie
      { type: "ELITE_MONSTER_KILL", timestamp: 12 * MIN, killerTeamId: 200, monsterType: "DRAGON" },
      { type: "BUILDING_KILL", timestamp: 12.5 * MIN, teamId: 200, buildingType: "TOWER_BUILDING" }, // contrepartie : une tour
      { type: "CHAMPION_KILL", timestamp: 13 * MIN, killerId: 7, victimId: 2, assistingParticipantIds: [6] },
    ]),
    frame(10 * MIN, 3600, 3300, 4200, 4000),
    frame(15 * MIN, 5600, 5900, 7000, 7200),
  ] };
  it("écarts à 10 et 15 min, first blood, morts en 1 contre 1, objectifs avant 20 min", () => {
    const v = duelValues(timeline, parts, 2);
    expect(v).toMatchObject({ gd10: 300, xd10: 200, gd15: -300, fb: 1, solo15: 1, conc20: 1 });
    expect(v.obj20).toBeCloseTo(100 / 3, 5);
    // Ton adversaire : écarts opposés, pas au first blood.
    expect(duelValues(timeline, parts, 7)).toMatchObject({ gd10: -300, fb: 0, solo15: 0 });
  });
});
