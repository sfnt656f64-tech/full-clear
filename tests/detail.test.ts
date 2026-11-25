import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanDetail, jungleCurve, packDetail, unpackDetail } from "../desktop/collector/detail";
import { CollectorStore } from "../desktop/collector/store";

const match = {
  metadata: { matchId: "EUW1_9", participants: ["puuid-moi", "puuid-autre"] },
  info: {
    gameDuration: 1800, gameCreation: 1, gameStartTimestamp: 2, gameVersion: "16.23.1", queueId: 420,
    teams: [{ teamId: 100, win: true, objectives: { dragon: { first: true, kills: 3 } }, bans: [{ championId: 1 }] }],
    participants: [
      { puuid: "puuid-moi", riotIdGameName: "Moi", riotIdTagline: "EUW", summonerName: "Moi", participantId: 1, teamId: 100, championId: 141, teamPosition: "JUNGLE", win: true, kills: 5, challenges: { scuttleCrabKills: 2 } },
      { puuid: "puuid-autre", riotIdGameName: "Autre", riotIdTagline: "X", summonerName: "Autre", participantId: 6, teamId: 200, championId: 64, teamPosition: "JUNGLE", win: false, kills: 2 },
    ],
  },
};
const timeline = { metadata: { participants: ["puuid-moi"] }, info: { frames: [1, 2, 3].map((m) => ({
  timestamp: m * 60_000 + 20,
  participantFrames: { 1: { totalGold: 500 * m, xp: 100 * m, level: m, minionsKilled: 0, jungleMinionsKilled: 4 * m, position: { x: 1, y: 2 }, damageStats: { secret: 1 } } },
  events: m === 2 ? [{ type: "ITEM_PURCHASED", timestamp: 150_000, participantId: 1, itemId: 6699 }, { type: "SKILL_LEVEL_UP", timestamp: 1, participantId: 1 }] : [],
})) } };

describe("détail anonyme de tes parties", () => {
  it("ne garde aucune identité, seulement « me » et des chiffres", () => {
    const d = cleanDetail("Moi#EUW", match, timeline, "puuid-moi");
    const json = JSON.stringify(d);
    for (const s of ["puuid", "Autre", "riotId", "summonerName"]) expect(json).not.toContain(s);
    expect(d.match.parts.map((p) => p.me)).toEqual([true, false]);
    expect(d.match.parts[0].challenges).toEqual({ scuttleCrabKills: 2 });
    expect(d.timeline!.frames[1].e).toEqual([{ type: "ITEM_PURCHASED", timestamp: 150_000, participantId: 1, itemId: 6699 }]);
    expect(d.timeline!.frames[0].p["1"]).not.toHaveProperty("damageStats");
    expect(unpackDetail(packDetail(d))).toEqual(d);
  });

  it("courbe de CS de la méta et premier item légendaire", () => {
    const c = jungleCurve(timeline, 1, (id) => id === 6699);
    expect(c.cs.slice(0, 4)).toEqual([4, 8, 12, null]);
    expect(c.firstItem).toBe(2.5);
  });

  it("parties sans détail à compléter", () => {
    const s = new CollectorStore(join(mkdtempSync(join(tmpdir(), "kayn-v8-")), "riot.db"));
    const g = { matchId: "G1", account: "Moi#EUW", startMs: 1, durationS: 1800, patch: "16.23", season: 2026, championId: 141, role: "JUNGLE", win: true, remake: false,
      kills: 1, deaths: 1, assists: 1, cs: 1, vision: 1, gold15: null, cs15: null, teamKills: 1, kills15: null, assists15: null, teamKills15: null, items: [], perks: null };
    s.putGame(g); s.putGame({ ...g, matchId: "G2" });
    s.putDetail("G1", "Moi#EUW", packDetail(cleanDetail("Moi#EUW", match, null, "puuid-moi")));
    expect(s.gamesWithoutDetail("Moi#EUW")).toEqual(["G2"]);
    s.close();
  });
});
