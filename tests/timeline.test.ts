import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csAt, earlyKills, laneOf, myEvents, objectives, partExtras, sideOf, startSide, type RosterEntry, type TimelineFull } from "../desktop/collector/timeline-parse";
import { CollectorStore, type MyGame } from "../desktop/collector/store";

const MIN = 60_000;
/** 10 participants : 1–5 (équipe 100), 6–10 (équipe 200) ; 2 et 7 en jungle. */
const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const roster = new Map<number, RosterEntry>(Array.from({ length: 10 }, (_, i) => [i + 1, { team: i < 5 ? 100 : 200, role: ROLES[i % 5], championId: 100 + i }]));

const T: TimelineFull = { info: { frames: [
  { timestamp: 0, participantFrames: {} },
  { timestamp: 2 * MIN + 10, participantFrames: { 2: { position: { x: 3000, y: 9000 } }, 7: { position: { x: 11000, y: 6000 } } } },
  { timestamp: 4 * MIN, participantFrames: {}, events: [
    // Gank top de notre jungler (2) avec le top (1) : victime le top adverse (6).
    { type: "CHAMPION_KILL", timestamp: 3 * MIN + 30_000, killerId: 2, victimId: 6, assistingParticipantIds: [1], position: { x: 1500, y: 11000 } },
    // Notre jungler meurt au bot.
    { type: "CHAMPION_KILL", timestamp: 3 * MIN + 50_000, killerId: 9, victimId: 2, position: { x: 10000, y: 1200 } },
    { type: "ELITE_MONSTER_KILL", timestamp: 3 * MIN + 55_000, killerId: 7, killerTeamId: 200, monsterType: "HORDE" },
  ] },
  { timestamp: 10 * MIN, participantFrames: { 2: { minionsKilled: 4, jungleMinionsKilled: 60 } }, events: [
    { type: "ELITE_MONSTER_KILL", timestamp: 9 * MIN, killerId: 2, killerTeamId: 100, assistingParticipantIds: [4], monsterType: "DRAGON" },
    { type: "ELITE_MONSTER_KILL", timestamp: 9 * MIN + 30_000, killerId: 3, killerTeamId: 100, monsterType: "RIFTHERALD" },
  ] },
  { timestamp: 16 * MIN, participantFrames: {}, events: [
    { type: "CHAMPION_KILL", timestamp: 16 * MIN, killerId: 3, victimId: 8, assistingParticipantIds: [2], position: { x: 7400, y: 7300 } },
  ] },
] } };

describe("chronologie", () => {
  it("zones de la carte", () => {
    expect(laneOf({ x: 1500, y: 11000 })).toBe("TOP");
    expect(laneOf({ x: 6000, y: 13500 })).toBe("TOP");
    expect(laneOf({ x: 10000, y: 1200 })).toBe("BOTTOM");
    expect(laneOf({ x: 7400, y: 7300 })).toBe("MIDDLE");
    expect(laneOf({ x: 4000, y: 8000 })).toBe("JUNGLE");
    expect(laneOf({ x: 1000, y: 1000 })).toBe("BASE");
    expect(sideOf({ x: 3000, y: 9000 })).toBe("top");
  });

  it("CS à 10 min, côté de départ, objectifs, événements", () => {
    expect(csAt(T, 2, 10)).toBe(64);
    expect(csAt(T, 2, 15)).toBeNull();
    expect(startSide(T, 2)).toBe("top");
    expect(startSide(T, 7)).toBe("bot");
    expect(objectives(T, 2, 100)).toEqual({ team: 2, mine: 1 });
    expect(myEvents(T, 2).map((e) => e.kind)).toEqual(["kill", "death", "assist"]);
  });

  it("kills avant 15 min : lane, champions et rôles (anonymes)", () => {
    const k = earlyKills(T, roster, 15 * MIN);
    expect(k).toHaveLength(2);
    expect(k[0]).toMatchObject({ lane: "TOP", killerRole: "JUNGLE", killerChamp: 101, victimRole: "TOP", victimChamp: 105, assistRoles: ["TOP"] });
    expect(k[1]).toMatchObject({ lane: "BOTTOM", killerRole: "BOTTOM", victimRole: "JUNGLE" });
  });

  it("données par participant", () => {
    const e = partExtras(T, roster);
    expect(e.get(2)).toEqual({ cs10: 64, cs15: null, deaths15: 1, objTeam: 2, objMine: 1, startSide: "top" });
    expect(e.get(1)!.startSide).toBeNull(); // seulement pour les junglers
  });
});

describe("base v6", () => {
  const db = () => join(mkdtempSync(join(tmpdir(), "kayn-v6-")), "riot.db");
  const game = (id: string, start: number, events = false): MyGame => ({
    matchId: id, account: "Moi#EUW", startMs: start, durationS: 1800, patch: "16.23", season: 2026, championId: 141, role: "JUNGLE",
    win: true, remake: false, kills: 1, deaths: 1, assists: 1, cs: 1, vision: 1, gold15: null, cs15: null,
    teamKills: 10, kills15: null, assists15: null, teamKills15: null, items: [], perks: null,
    ...(events ? { cs10: 60, objTeam: 3, objMine: 2, events: [{ t: 1000, kind: "kill" as const, x: 1, y: 2, otherChamp: 64 }] } : {}),
  });

  it("relecture limitée aux N dernières parties, une seule fois", () => {
    const s = new CollectorStore(db());
    for (let i = 0; i < 5; i++) s.putGame(game(`G${i}`, i));
    expect(s.gamesWithoutTimeline("Moi#EUW", 3)).toEqual(["G4", "G3", "G2"]);
    s.putGame(game("G4", 4, true));
    expect(s.gamesWithoutTimeline("Moi#EUW", 3)).toEqual(["G3", "G2"]); // G1 et G0 restent hors des 3 dernières
    const ev = s.db.prepare("select kind, x, y, other_champ from my_events where match_id = 'G4'").all();
    expect(ev).toEqual([{ kind: "kill", x: 1, y: 2, other_champ: 64 }]);
    s.putGame(game("G4", 4, true)); // relue : pas de doublon
    expect(s.db.prepare("select count(*) n from my_events").get()).toEqual({ n: 1 });
    s.close();
  });
});
