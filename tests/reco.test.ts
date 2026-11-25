import { describe, expect, it } from "vitest";
import { learning, metaStyles, playProfile, recommend, similarity, type RecoInput } from "../desktop/reco/recommend";
import type { MetaChampion, MetaMasteryRow, MetaPartRow } from "../desktop/meta/meta-stats";
import type { MyGameRow } from "../desktop/stats/my-stats";
import { earlyStats } from "../desktop/collector/meta-parse";
import type { TimelineV5 } from "../desktop/collector/my-games";
import { champ } from "../src/data/champions";

const KAYN = 141, BRIAR = 233, VIEGO = 234, JAX = 24, AKALI = 84, VI = 254, KHAZIX = 121, ZAC = 154, AHRI = 103;

let n = 0;
const my = (championId: number, win: boolean, over: Partial<MyGameRow> = {}): MyGameRow => ({
  matchId: `M${n++}`, account: "Moi#EUW", startMs: 1, durationS: 1800, patch: "16.23", season: 2026, championId, role: "JUNGLE",
  win, remake: false, kills: 5, deaths: 3, assists: 7, cs: 180, vision: 30, gold15: 6000, cs15: 100,
  teamKills: 25, kills15: 2, assists15: 3, teamKills15: 8, ...over,
});
const games = (championId: number, wins: number, losses: number, over: Partial<MyGameRow> = {}) => [
  ...Array.from({ length: wins }, () => my(championId, true, over)),
  ...Array.from({ length: losses }, () => my(championId, false, over)),
];
const meta = (championId: number, games: number, winRate: number, role = "JUNGLE"): MetaChampion => ({
  championId, role, games, wins: Math.round((games * winRate) / 100), winRate, margin: 3, pickRate: 5, provisional: games < 100,
  items: [], boots: null, starter: null, keystones: [], page: null, core: null, mastery: null,
});
const input = (over: Partial<RecoInput>): RecoInput => ({ myGames: [], meta: [], metaParts: [], mastery: [], metaMatches: 5000, excluded: [], ...over });
const jungle = (r: ReturnType<typeof recommend>) => r.roles.find((x) => x.role === "JUNGLE")!;

describe("mon pool", () => {
  it("10 parties à 70 % ne passent pas devant un champion gagnant sur beaucoup de parties", () => {
    const r = recommend(input({
      myGames: [...games(VIEGO, 7, 3), ...games(KAYN, 34, 26)],
      meta: [meta(VIEGO, 500, 50), meta(KAYN, 500, 50)],
    }));
    const pool = jungle(r).pool;
    expect(pool.map((p) => p.championId)).toEqual([KAYN, VIEGO]);
    expect(pool[1].winRate).toBe(70);
    expect(pool[0].reasons[0]).toContain("Tu gagnes 57 % de tes 60 parties");
  });

  it("les saisons précédentes comptent moins", () => {
    const r = recommend(input({
      myGames: [
        ...games(KAYN, 14, 6),                              // 70 % cette saison
        ...games(VIEGO, 14, 6, { season: 2024 }),           // 70 % il y a deux saisons (poids ¼)
        my(BRIAR, true), my(BRIAR, false), my(BRIAR, true), // une partie récente pour fixer la saison en cours
      ],
      meta: [meta(VIEGO, 500, 50), meta(KAYN, 500, 50)],
    }));
    const [kayn, viego] = [KAYN, VIEGO].map((id) => jungle(r).pool.find((p) => p.championId === id)!);
    expect(kayn.adjustedWinRate).toBeGreaterThan(viego.adjustedWinRate);
    expect(viego.weightedGames).toBe(5);
    expect(viego.reasons.join(" ")).toContain("saisons précédentes");
  });

  it("champions exclus : ni dans le pool, ni dans « À essayer »", () => {
    const r = recommend(input({
      myGames: [...games(JAX, 30, 5), ...games(KAYN, 10, 10)],
      meta: [meta(JAX, 500, 55), meta(KAYN, 500, 50), meta(KHAZIX, 500, 52)],
      excluded: [JAX],
    }));
    expect(jungle(r).pool.map((p) => p.championId)).toEqual([KAYN]);
    expect(jungle(r).tryList.map((p) => p.championId)).toEqual([KHAZIX]);
  });

  it("score = somme du détail ; les points de maîtrise départagent deux champions égaux", () => {
    const r = recommend(input({
      myGames: [...games(KAYN, 10, 10), ...games(VIEGO, 10, 10)],
      meta: [meta(VIEGO, 500, 50), meta(KAYN, 500, 50)],
      myMastery: new Map([[KAYN, 400_000]]),
    }));
    const [first, second] = jungle(r).pool;
    expect(first.championId).toBe(KAYN);
    expect(first.masteryPoints).toBe(400_000);
    expect(first.breakdown.mastery).toBeCloseTo(1.5); // plein à 300 000 points
    expect(second.breakdown.mastery).toBe(0);
    for (const p of [first, second]) {
      const b = p.breakdown;
      expect(p.score).toBeCloseTo(b.winRate + b.meta + b.games + b.mastery);
    }
    expect(first.reasons.join(" ")).toContain("400 k points de maîtrise");
  });

  it("moins de 10 parties : pas dans le pool, mais proposé dans « À essayer »", () => {
    const r = recommend(input({ myGames: [...games(KAYN, 30, 20), ...games(VIEGO, 3, 0)], meta: [meta(KAYN, 500, 50), meta(VIEGO, 500, 53)] }));
    expect(jungle(r).pool.map((p) => p.championId)).toEqual([KAYN]);
    const v = jungle(r).tryList.find((t) => t.championId === VIEGO)!;
    expect(v.tried).toEqual({ games: 3, wins: 3 });
    expect(v.reasons.join(" ")).toContain("déjà joué 3 fois (3 victoires)");
  });

  it("remakes écartés ; méta absente → provisoire", () => {
    const r = recommend(input({ myGames: [...games(KAYN, 10, 0), ...games(KAYN, 0, 5, { remake: true })] }));
    const k = jungle(r).pool[0];
    expect(k.games).toBe(10);
    expect(k.provisional).toBe(true);
  });
});

describe("à essayer", () => {
  const base = {
    myGames: [...games(KAYN, 30, 20), ...games(BRIAR, 12, 8), ...games(AKALI, 6, 4, { role: "MIDDLE" })],
    meta: [meta(KAYN, 500, 50), meta(KHAZIX, 400, 52), meta(ZAC, 400, 52), meta(VI, 400, 46), meta(AKALI, 300, 53), meta(AHRI, 400, 52, "MIDDLE")],
  };

  it("propose des champions proches de tes meilleurs, jamais un champion déjà joué ni faible dans la méta", () => {
    const r = recommend(input(base));
    const ids = jungle(r).tryList.map((t) => t.championId);
    expect(ids[0]).toBe(KHAZIX); // assassin très mobile, dégâts physiques, comme Kayn
    expect(ids).toContain(ZAC);
    expect(ids).not.toContain(KAYN);
    expect(ids).not.toContain(AKALI); // jouée au milieu : déjà dans ton pool
    expect(ids).not.toContain(VI);    // 46 % dans la méta
    const kz = jungle(r).tryList[0];
    expect(kz.similarTo).toContain(KAYN);
    expect(kz.reasons.length).toBeGreaterThanOrEqual(1);
    expect(kz.reasons.length).toBeLessThanOrEqual(2);
    expect(kz.reasons[0]).toContain("Proche de Kayn");
  });

  it("au milieu, compare à tes meilleurs champions de jungle si tu joues peu au milieu", () => {
    const r = recommend(input(base));
    const mid = r.roles.find((x) => x.role === "MIDDLE")!;
    expect(mid.pool.map((p) => p.championId)).toEqual([AKALI]);
    expect(mid.tryList.map((t) => t.championId)).toEqual([AHRI]);
  });

  it("méta maigre : tout est provisoire", () => {
    const r = recommend(input({ ...base, metaMatches: 300 }));
    expect(r.provisional).toBe(true);
    expect(jungle(r).tryList.every((t) => t.provisional)).toBe(true);
  });
});

describe("profil et style", () => {
  it("participation aux kills avant et après 15 min", () => {
    const p = playProfile(games(KAYN, 12, 8), "JUNGLE", { kp15: 40, gold15: 5800 });
    expect(p.kp15).toBeCloseTo(((2 + 3) / 8) * 100);              // 62,5 %
    expect(p.kpLate).toBeCloseTo(((5 + 7 - 5) / (25 - 8)) * 100); // 41 %
    expect(p.killShare).toBeCloseTo(20);
    expect(p.style).toBe("early"); // 20 parties : participe et gagne de l'or bien plus que la moyenne avant 15 min
    expect(playProfile(games(KAYN, 6, 4), "JUNGLE", { kp15: 40, gold15: 5800 }).style).toBe("balanced"); // moins de 20 parties : pas de conclusion
  });

  it("parties sans relecture (participation inconnue) ignorées", () => {
    const p = playProfile(games(KAYN, 6, 4, { teamKills: null, kills15: null, assists15: null, teamKills15: null }), "JUNGLE", { kp15: null, gold15: null });
    expect(p.kp).toBeNull();
    expect(p.kp15).toBeNull();
    expect(p.style).toBe("balanced");
  });

  it("champion d'early : gagne les parties courtes, perd les longues", () => {
    const rows: MetaPartRow[] = [];
    for (let i = 0; i < 200; i++) {
      const short = i % 2 === 0;
      rows.push({ matchId: `m${i}`, team: 100, championId: KHAZIX, role: "JUNGLE", win: short ? i % 10 < 7 : i % 10 < 3, items: [], perks: null, kills: 5, deaths: 2, assists: 5, durationS: short ? 20 * 60 : 35 * 60 });
      rows.push({ matchId: `m${i}`, team: 100, championId: AHRI, role: "MIDDLE", win: true, items: [], perks: null, kills: 15, deaths: 2, assists: 5, durationS: 1800 });
    }
    const st = metaStyles(rows).get(`${KHAZIX}|JUNGLE`)!;
    expect(st.early).toBeGreaterThan(20);
    expect(st.kp).toBeCloseTo(50); // (5 kills + 5 assists) / (5 + 15 kills de l'équipe)
  });

  it("ressemblance : Kha'Zix plus proche de Kayn que Zac", () => {
    expect(similarity(champ("Khazix"), champ("Kayn"))).toBeGreaterThan(similarity(champ("Zac"), champ("Kayn")));
  });
});

describe("difficulté de prise en main", () => {
  const rows = (pts: number, n: number, wr: number): MetaMasteryRow[] =>
    Array.from({ length: n }, (_, i) => ({ championId: 1, role: "JUNGLE", win: i < (n * wr) / 100, points: pts }));

  it("facile : les débutants gagnent autant que les experts", () => {
    expect(learning([...rows(5_000, 40, 52), ...rows(200_000, 40, 52)]).games).toBe(10);
  });
  it("difficile : il faut plus de 100 000 points pour atteindre le niveau des experts", () => {
    const l = learning([...rows(5_000, 60, 40), ...rows(20_000, 60, 42), ...rows(60_000, 60, 45), ...rows(200_000, 60, 54)]);
    expect(l.games).toBe(150);
    expect(l.novice!.winRate).toBe(40);
  });
  it("pas assez de données : inconnue", () => {
    expect(learning(rows(5_000, 10, 50)).games).toBeNull();
  });
});

describe("début de partie dans la méta (chronologie)", () => {
  it("kills, assists, kills d'équipe avant 15 min et or à 15 min, pour chaque participant", () => {
    const t: TimelineV5 = { info: { frames: [
      { timestamp: 60_000, participantFrames: {}, events: [
        { type: "CHAMPION_KILL", timestamp: 5 * 60_000, killerId: 1, victimId: 6, assistingParticipantIds: [2] },
        { type: "CHAMPION_KILL", timestamp: 7 * 60_000, killerId: 6, victimId: 1 },
      ] },
      { timestamp: 15 * 60_000, participantFrames: { 1: { totalGold: 6100, minionsKilled: 0, jungleMinionsKilled: 90 }, 6: { totalGold: 5000, minionsKilled: 120, jungleMinionsKilled: 0 } }, events: [] },
    ] } };
    const e = earlyStats(t, new Map([[1, 100], [2, 100], [6, 200]]));
    expect(e.get(1)).toEqual({ kills15: 1, assists15: 0, teamKills15: 1, gold15: 6100 });
    expect(e.get(2)).toEqual({ kills15: 0, assists15: 1, teamKills15: 1, gold15: null });
    expect(e.get(6)).toEqual({ kills15: 1, assists15: 0, teamKills15: 1, gold15: 5000 });
  });
});
