import { describe, expect, it } from "vitest";
import { draftPicks, missingDamage, pairEffects, pairIndex, OFF_POOL_MARGIN } from "../desktop/reco/draft-pick";
import type { MetaChampion, MetaPartRow } from "../desktop/meta/meta-stats";
import type { PoolPick } from "../desktop/reco/recommend";
import { champ } from "../src/data/champions";

const K = (id: string) => champ(id).key!;
const KAYN = K("Kayn"), VIEGO = K("Viego"), BRIAR = K("Briar"), LEE = K("LeeSin"), ORI = K("Orianna"), ZED = K("Zed"), AHRI = K("Ahri");
const GAREN = K("Garen"), DRAVEN = K("Draven"), TALON = K("Talon"), JAX = K("Jax"), DIANA = K("Diana");

/**
 * Parties de méta synthétiques : `n` parties de `champ` en jungle (équipe 100), avec `enemy` en face et/ou `ally`
 * à côté, gagnées `wins` fois.
 */
let m = 0;
function games(champId: number, n: number, wins: number, opts: { enemy?: number; ally?: number } = {}): MetaPartRow[] {
  const out: MetaPartRow[] = [];
  for (let i = 0; i < n; i++) {
    const matchId = `G${m++}`;
    const win = i < wins;
    out.push({ matchId, team: 100, championId: champId, role: "JUNGLE", win, items: [], perks: null });
    if (opts.enemy) out.push({ matchId, team: 200, championId: opts.enemy, role: "JUNGLE", win: !win, items: [], perks: null });
    if (opts.ally) out.push({ matchId, team: 100, championId: opts.ally, role: "MIDDLE", win, items: [], perks: null });
  }
  return out;
}
const pool = (id: number, score: number): PoolPick => ({
  championId: id, role: "JUNGLE", score, games: 50, weightedGames: 50, winRate: 55, adjustedWinRate: score - 3, masteryPoints: 0,
  breakdown: { winRate: score - 3, meta: 0, games: 3, mastery: 0 }, kda: 3, meta: { games: 500, winRate: 50 }, seasons: [], reasons: [], provisional: false,
});
const meta = (championId: number, games: number, winRate: number): MetaChampion => ({
  championId, role: "JUNGLE", games, wins: Math.round((games * winRate) / 100), winRate, margin: 3, pickRate: 5, provisional: false,
  items: [], boots: null, starter: null, keystones: [], page: null, core: null, mastery: null,
});

describe("duels et associations", () => {
  it("contre : effet lissé, positif quand le champion gagne plus souvent face à cet adversaire", () => {
    const idx = pairIndex([...games(KAYN, 200, 100), ...games(KAYN, 60, 42, { enemy: LEE })]);
    const [lee] = pairEffects(idx, KAYN, "JUNGLE", [LEE], "enemy");
    expect(lee.games).toBe(60);
    expect(lee.winRate).toBe(70);
    expect(lee.effect).toBeGreaterThan(2);
    expect(lee.effect).toBeLessThan(70 - (142 / 260) * 100); // lissé : moins que l'écart brut
  });

  it("aucun effet sans partie commune ; un allié n'est pas compté comme adversaire", () => {
    const idx = pairIndex([...games(KAYN, 100, 50), ...games(KAYN, 30, 25, { ally: ORI })]);
    expect(pairEffects(idx, KAYN, "JUNGLE", [ZED], "enemy")[0]).toMatchObject({ games: 0, effect: 0 });
    expect(pairEffects(idx, KAYN, "JUNGLE", [ORI], "enemy")[0].games).toBe(0);
    expect(pairEffects(idx, KAYN, "JUNGLE", [ORI], "ally")[0].effect).toBeGreaterThan(0.5);
  });

  it("moins de 10 parties ensemble : aucun effet", () => {
    const idx = pairIndex([...games(KAYN, 200, 100), ...games(KAYN, 9, 9, { enemy: LEE })]);
    expect(pairEffects(idx, KAYN, "JUNGLE", [LEE], "enemy")[0]).toMatchObject({ games: 9, effect: 0 });
  });
});

describe("équilibre des dégâts", () => {
  it("équipe très physique → il manque des dégâts magiques", () => {
    expect(missingDamage([champ("Garen"), champ("Draven"), champ("Talon")])).toBe("magic");
    expect(missingDamage([champ("Orianna"), champ("Ahri")])).toBe("physical");
    expect(missingDamage([champ("Garen"), champ("Orianna")])).toBeNull();
    expect(missingDamage([champ("Garen")])).toBeNull(); // pas assez d'alliés connus
  });
});

describe("choix en draft", () => {
  const base = {
    role: "JUNGLE", myTurn: true, allies: [] as number[], enemies: [] as number[], unavailable: [] as number[],
    pool: [pool(KAYN, 58), pool(VIEGO, 57), pool(BRIAR, 56), pool(DIANA, 50)],
    meta: [meta(KAYN, 500, 50), meta(VIEGO, 500, 50), meta(BRIAR, 500, 50), meta(DIANA, 500, 50)],
  };

  it("sans information, garde l'ordre du pool ; ignore les champions bannis ou pris", () => {
    const r = draftPicks({ ...base, index: pairIndex([]), unavailable: [KAYN] });
    expect(r.list.map((p) => p.championId)).toEqual([VIEGO, BRIAR, DIANA]);
    expect(r.list[0].reasons).toContain("N° 2 de ton pool.");
    expect(r.offPool).toBeNull();
  });

  it("un bon duel fait remonter un champion, avec la raison en clair", () => {
    const idx = pairIndex([
      ...games(KAYN, 300, 150), ...games(VIEGO, 300, 150), ...games(BRIAR, 300, 150),
      ...games(BRIAR, 120, 90, { enemy: LEE }), ...games(KAYN, 120, 40, { enemy: LEE }),
    ]);
    const r = draftPicks({ ...base, index: idx, enemies: [LEE] });
    expect(r.list[0].championId).toBe(BRIAR);
    expect(r.list[0].reasons[0]).toMatch(/^Bon contre Lee Sin : 75 % ± 8 sur 120 parties en Émeraude\+, contre \d+ % d'habitude/);
    const kayn = r.list.find((p) => p.championId === KAYN);
    expect(kayn === undefined || kayn.reasons[0].startsWith("Difficile contre Lee Sin")).toBe(true);
  });

  it("équipe physique : un champion à dégâts magiques gagne des points", () => {
    const r = draftPicks({ ...base, pool: [pool(KAYN, 56), pool(DIANA, 55)], index: pairIndex([]), allies: [GAREN, DRAVEN, TALON] });
    expect(r.list[0].championId).toBe(DIANA);
    expect(r.list[0].reasons[0]).toContain("manque de dégâts magiques");
  });

  it("hors pool : proposé seulement s'il est nettement meilleur", () => {
    const strong = { ...base, pool: [pool(KAYN, 52)], meta: [...base.meta, meta(JAX, 2000, 60)] };
    const r = draftPicks({ ...strong, index: pairIndex([]) });
    expect(r.offPool?.championId).toBe(JAX);
    expect(r.offPool!.score - r.list[0].score).toBeGreaterThanOrEqual(OFF_POOL_MARGIN);
    expect(r.offPool!.reasons.at(-1)).toContain("Hors de ton pool");
    // Juste un peu meilleur : pas proposé.
    const close = draftPicks({ ...strong, meta: [...base.meta, meta(JAX, 2000, 55)], index: pairIndex([]) });
    expect(close.offPool).toBeNull();
    // Champion exclu (réglage) : jamais proposé.
    expect(draftPicks({ ...strong, excluded: [JAX], index: pairIndex([]) }).offPool).toBeNull();
  });

  it("aucun nom de joueur : seulement des champions", () => {
    const r = draftPicks({ ...base, index: pairIndex([]), enemies: [AHRI] });
    expect(Object.keys(r.list[0]).sort()).toEqual(["base", "championId", "counter", "damage", "inPool", "poolRank", "provisional", "reasons", "score", "synergy"]);
  });
});

describe("duels : pas de conclusion sous 20 parties", () => {
  it("15 parties face à un adversaire : aucun effet ; 40 parties : effet", async () => {
    const { pairIndex, pairEffects } = await import("../desktop/reco/draft-pick");
    const parts = (vsGames: number) => Array.from({ length: 200 }, (_, i) => [
      { matchId: `M${i}`, team: 100, championId: 141, role: "JUNGLE", win: i < vsGames ? true : i % 2 === 0 },
      { matchId: `M${i}`, team: 200, championId: i < vsGames ? 64 : 11, role: "JUNGLE", win: false },
    ]).flat();
    const few = pairEffects(pairIndex(parts(15) as never), 141, "JUNGLE", [64], "enemy")[0];
    expect(few).toMatchObject({ games: 15, effect: 0 });
    const many = pairEffects(pairIndex(parts(40) as never), 141, "JUNGLE", [64], "enemy")[0];
    expect(many.games).toBe(40);
    expect(many.effect).toBeGreaterThan(0);
  });
});

describe("draft en mode « Progresser »", () => {
  const base = {
    role: "JUNGLE", myTurn: true, allies: [] as number[], enemies: [] as number[], unavailable: [] as number[],
    pool: [pool(KAYN, 58), pool(VIEGO, 57), pool(BRIAR, 56)],
    meta: [meta(KAYN, 500, 50), meta(VIEGO, 500, 50), meta(BRIAR, 500, 50), meta(DIANA, 500, 51), meta(LEE, 500, 49)],
    index: pairIndex([]),
  };

  it("champions prioritaires en tête, avec leur raison et leur étiquette ; un choix habituel reste visible", () => {
    const r = draftPicks({ ...base, priority: [{ championId: DIANA, group: 0, tag: "Progression", why: "Champion de progression." }, { championId: LEE, group: 0, tag: "Progression", why: "Champion de progression (2)." }], rule: "Normale" });
    expect(r.list.map((p) => p.championId)).toEqual([DIANA, LEE, KAYN]);
    expect(r.list[0]).toMatchObject({ tag: "Progression", inPool: false });
    expect(r.list[0].reasons[0]).toBe("Champion de progression.");
    expect(r.rule).toBe("Normale");
    expect(r.offPool?.championId).not.toBe(DIANA);
  });

  it("champions bloqués (« Pas pour moi », pas prêts pour la classée) jamais proposés, même dans ton pool", () => {
    const r = draftPicks({ ...base, blocked: [KAYN, DIANA], priority: [{ championId: DIANA, group: 0, tag: "Progression", why: "x" }] });
    expect(r.list.map((p) => p.championId)).toEqual([VIEGO, BRIAR]);
    expect(r.offPool?.championId === KAYN || r.offPool?.championId === DIANA).toBe(false);
  });

  it("composition prise en compte entre champions prioritaires", () => {
    const idx = pairIndex([...games(LEE, 200, 100), ...games(LEE, 60, 45, { enemy: ZED }), ...games(DIANA, 200, 100), ...games(DIANA, 60, 18, { enemy: ZED })]);
    const r = draftPicks({ ...base, index: idx, enemies: [ZED], priority: [{ championId: DIANA, group: 0, tag: "P", why: "a" }, { championId: LEE, group: 0, tag: "P", why: "b" }] });
    expect(r.list[0].championId).toBe(LEE);
    expect(r.list[0].reasons.join(" ")).toMatch(/Bon contre Zed/);
  });

  it("3 champions prioritaires au plus, puis un choix habituel", () => {
    const ids = [DIANA, LEE, ZED, AHRI, ORI];
    const r = draftPicks({ ...base, meta: [...base.meta, meta(ZED, 500, 50), meta(AHRI, 500, 50), meta(ORI, 500, 50)], priority: ids.map((championId) => ({ championId, group: 0, tag: "P", why: "x" })) });
    expect(r.list.length).toBe(4);
    expect(r.list.filter((p) => p.tag).length).toBe(3);
    expect(r.list[3].championId).toBe(KAYN);
  });
});
