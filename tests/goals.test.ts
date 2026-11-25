import { describe, expect, it } from "vitest";
import { DEFAULT_GOALS, goalsView, neededGames, stat, type GameMetrics } from "../desktop/analysis/goals";

const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 25);
const g = (over: Partial<GameMetrics> = {}, daysFromStart = -1): GameMetrics => ({
  start: START + daysFromStart * DAY, win: true, championId: 141, deaths15: 2, cs10: 68, cs10diff: 0, firstDragon: true, grubs: false, deathsBeforeObj: 1, dragonPresence: true,
  soloDeaths: 0, ceded: 2, uncompensated: 1, cededEarly: 2, uncompensatedEarly: 1, ...over,
});
const deaths = DEFAULT_GOALS.flatMap((x) => x.metrics).find((m) => m.key === "deaths15")!;

describe("suivi des objectifs", () => {
  it("référence : 4 semaines d'avant, étendue aux 20 dernières parties s'il y en a moins", () => {
    const v = goalsView([...Array.from({ length: 5 }, () => g()), ...Array.from({ length: 30 }, (_, i) => g({}, -40 - i))], START);
    expect(v.baseline).toMatchObject({ games: 20, extended: true });
    const w = goalsView(Array.from({ length: 25 }, (_, i) => g({}, -1 - i)), START);
    expect(w.baseline).toMatchObject({ games: 25, extended: false });
  });

  it("parties nécessaires : plus la valeur est loin de la cible, moins il en faut", () => {
    const before = Array.from({ length: 20 }, (_, i) => g({ deaths15: i % 4 }));
    const b = stat(deaths, before);
    const far = neededGames(deaths, before, [], b, stat(deaths, []), 0.3)!;
    const near = neededGames(deaths, before, [], b, stat(deaths, []), 1.2)!;
    expect(far).toBeGreaterThanOrEqual(20);
    expect(near).toBeGreaterThan(far);
    // Valeur pile sur la cible : impossible de trancher.
    expect(neededGames(deaths, before, [], b, stat(deaths, []), b.value!)).toBeNull();
  });

  it("présence au dragon : part des parties où tu es près de la fosse", () => {
    const m = DEFAULT_GOALS.flatMap((x) => x.metrics).find((x) => x.key === "dragonPresence")!;
    expect(stat(m, [g({ dragonPresence: true }), g({ dragonPresence: false }), g({ dragonPresence: null })]).value).toBe(50);
  });
});

describe("échanges d'objectifs et morts seul", () => {
  it("objectif cédé compensé par un autre objectif, une tour ou plus de kills ; Voidgrubs regroupés", async () => {
    const { trades } = await import("../desktop/analysis/goals");
    const teamOf = new Map([[1, 100], [2, 100], [6, 200], [7, 200]]);
    const ev = [
      // Dragon adverse à 6:00, compensé par les Voidgrubs à 6:30.
      { type: "ELITE_MONSTER_KILL", timestamp: 360_000, monsterType: "DRAGON", killerTeamId: 200 },
      { type: "ELITE_MONSTER_KILL", timestamp: 390_000, monsterType: "HORDE", killerTeamId: 100 },
      // Voidgrubs adverses à 15:00 (3 événements regroupés), sans contrepartie : 1 kill partout.
      ...[900_000, 910_000, 920_000].map((t) => ({ type: "ELITE_MONSTER_KILL", timestamp: t, monsterType: "HORDE", killerTeamId: 200 })),
      { type: "CHAMPION_KILL", timestamp: 905_000, killerId: 1, victimId: 6 },
      { type: "CHAMPION_KILL", timestamp: 906_000, killerId: 7, victimId: 2 },
      // Héraut adverse à 20:00, compensé par une tour adverse détruite (teamId = équipe qui perd le bâtiment).
      { type: "ELITE_MONSTER_KILL", timestamp: 1_200_000, monsterType: "RIFTHERALD", killerTeamId: 200 },
      { type: "BUILDING_KILL", timestamp: 1_230_000, teamId: 200 },
    ];
    expect(trades(ev, 100, teamOf)).toEqual({ ceded: 3, uncompensated: 1 });
    // Avant 15 min seulement : le dragon de 6:00 (compensé).
    expect(trades(ev, 100, teamOf, 15 * 60_000)).toEqual({ ceded: 1, uncompensated: 0 });
  });

  it("objectifs de la semaine et résultats à long terme", () => {
    const v = goalsView([g({}, 1), g({}, 2)], START);
    expect(v.goals.filter((x) => x.horizon === "week").map((x) => x.key)).toEqual(["trades", "beforeObj", "cs10"]);
    expect(v.goals.filter((x) => x.horizon === "month").map((x) => x.key)).toEqual(["deaths", "dragon"]);
    const info = v.goals.flatMap((x) => x.metrics).find((m) => m.key === "dragonPresence")!;
    expect([info.info, info.needed, info.reached]).toEqual([true, null, null]);
    const unc = v.goals.flatMap((x) => x.metrics).find((m) => m.key === "uncompensatedEarly")!;
    expect([unc.since.value, unc.target, unc.info]).toEqual([50, 35, false]);
    expect(v.goals.find((x) => x.main)?.key).toBe("trades");
    const solo = v.goals.flatMap((x) => x.metrics).find((m) => m.key === "soloDeaths")!;
    expect([solo.info, solo.needed]).toEqual([true, null]);
  });
});
