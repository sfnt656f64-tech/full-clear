import { describe, expect, it } from "vitest";
import { evolution, goalLines, keyMoments, WORK_GAMES, workPoints } from "../desktop/analysis/postgame";
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
    expect(m[1].text).toBe("Ils prennent : dragon infernal.");
    expect(m[3].text).toMatch(/par toi/);
  });

  it("objectifs de la semaine sur la partie, sans conclusion", () => {
    const g = goalLines({ cededEarly: 2, uncompensatedEarly: 1, deathsBeforeObj: 1, cs10: 70, cs10diff: -4 } as never, { uncompensatedEarly: 35, deathsBeforeObj: 0.9, cs10: 72 });
    expect(g.map((x) => [x.key, x.met])).toEqual([["uncompensatedEarly", false], ["deathsBeforeObj", false], ["cs10", false]]);
    expect(g[2].value).toBe("70 (−4 face au jungler adverse)");
  });

  it("points à travailler : rien sous 20 parties", () => {
    const few = Array.from({ length: WORK_GAMES - 1 }, () => ({}) as AnalysisGame);
    const r = workPoints(few, new MetaRef(new Map()), "Émeraude", {} as AnalysisGame);
    expect(r.work[0]).toMatch(/Moins de 20 parties/);
    expect(r.strength).toMatch(/pas encore de point fort/);
  });
});

describe("évolution d'une mesure (10 dernières contre 10 précédentes)", () => {
  const m = { key: "cs10", label: "CS à 10 min", unit: "", better: "+", value: (g: AnalysisGame) => (g as unknown as { v: number }).v } as never;
  const games = (recent: number[], older: number[]) => [...recent, ...older].map((v) => ({ v }) as unknown as AnalysisGame);
  it("progrès net seulement au-delà de la marge combinée", () => {
    expect(evolution(m, games([80, 82, 78, 81, 79, 80, 82, 78, 81, 79], [60, 62, 58, 61, 59, 60, 62, 58, 61, 59]))).toMatch(/: progrès net\.$/);
    expect(evolution(m, games([60, 62, 58, 61, 59, 60, 62, 58, 61, 59], [80, 82, 78, 81, 79, 80, 82, 78, 81, 79]))).toMatch(/: recul net\.$/);
    expect(evolution(m, games([60, 90, 50, 70, 80, 60, 90, 50, 70, 80], [65, 85, 55, 75, 70, 65, 85, 55, 75, 70]))).toMatch(/pas d'écart net/);
  });
  it("pas de comparaison sous 5 valeurs par moitié", () => {
    expect(evolution(m, games([80, 80, 80], [60, 60, 60]))).toMatch(/pas assez de valeurs/);
  });
});

describe("courbe des points à travailler (30 dernières parties, moyenne glissante sur 10)", () => {
  const m = { key: "cs10", label: "CS à 10 min", unit: "", better: "+", value: (g: AnalysisGame) => (g as unknown as { v: number | null }).v } as never;
  const games = (vals: (number | null)[]) => vals.map((v) => ({ v }) as unknown as AnalysisGame);
  it("21 points de la plus ancienne à la plus récente ; cible nettement atteinte seulement au-delà de la marge", async () => {
    const { workCurve } = await import("../desktop/analysis/postgame");
    // Les plus récentes d'abord (comme l'appli) : 10 à 80, 20 à 60.
    const c = workCurve(m, games([...Array(10).fill(80), ...Array(20).fill(60)]), 72, "ta cible")!;
    expect(c.points.length).toBe(21);
    expect(c.points[0]).toBe(60);
    expect(c.points[20]).toBe(80);
    expect(c.vsTarget).toMatch(/nettement mieux que la cible/);
    const noisy = workCurve(m, games([60, 90, 50, 80, 70, 95, 55, 85, 65, 75, ...Array(20).fill(60)]), 72, "ta cible")!;
    expect(noisy.vsTarget).toMatch(/pas d'écart net avec la cible \(marge comprise\), pas de conclusion/);
  });
  it("pas de courbe sous 20 parties ; un point sans 5 valeurs sur 10 est vide", async () => {
    const { workCurve } = await import("../desktop/analysis/postgame");
    expect(workCurve(m, games(Array(19).fill(70)), 72, "ta cible")).toBeNull();
    const c = workCurve(m, games([...Array(20).fill(70), ...Array(10).fill(null)]), 72, "ta cible")!;
    expect(c.points[0]).toBeNull();
    expect(c.points[20]).toBe(70);
  });
});
