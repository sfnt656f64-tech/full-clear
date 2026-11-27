import { describe, expect, it } from "vitest";
import { buildLines, compoProfile, countErrors, gameFacts, lesson, pickTheme, shareText, situationalItems, themeVerdict, zone, type ErrorStat, type TagShares } from "../desktop/analysis/lesson";
import type { Detail } from "../desktop/collector/detail";
import { champ } from "../src/data/champions";

const K = (id: string) => champ(id).key!;
const MIN = 60_000;
/** Partie synthétique : toi (Bel'Veth, 1) contre Hecarim (6) ; or d'équipe +5 000 à 15 min puis −3 000 à 30 min. */
function detail(): Detail {
  const parts = [
    { participantId: 1, teamId: 100, championId: K("Belveth"), teamPosition: "JUNGLE", me: true, win: false },
    { participantId: 2, teamId: 100, championId: K("Jhin"), teamPosition: "BOTTOM", me: false },
    { participantId: 3, teamId: 100, championId: K("Viktor"), teamPosition: "MIDDLE", me: false },
    { participantId: 6, teamId: 200, championId: K("Hecarim"), teamPosition: "JUNGLE", me: false },
    { participantId: 7, teamId: 200, championId: K("Smolder"), teamPosition: "BOTTOM", me: false },
    { participantId: 8, teamId: 200, championId: K("Taliyah"), teamPosition: "MIDDLE", me: false },
  ];
  const lead = (m: number) => (m <= 15 ? m * 330 : m <= 20 ? 5000 - (m - 15) * 600 : 2000 - (m - 20) * 500);
  const frames = Array.from({ length: 31 }, (_, m) => ({ t: m * MIN, e: [] as Record<string, unknown>[], p: {
    1: { totalGold: 500 + m * 400 + lead(m), minionsKilled: 0, jungleMinionsKilled: m * 8, position: { x: 3000, y: 5000 } },
    2: { totalGold: 500 + m * 400 }, 3: { totalGold: 500 + m * 400 }, 6: { totalGold: 500 + m * 400, minionsKilled: 0, jungleMinionsKilled: m * 7 }, 7: { totalGold: 500 + m * 400 }, 8: { totalGold: 500 + m * 400 },
  } as Record<string, Record<string, unknown>> }));
  const ev = (e: Record<string, unknown>) => frames[Math.floor(Number(e.timestamp) / MIN)].e.push(e);
  ev({ type: "ELITE_MONSTER_KILL", timestamp: 6 * MIN, killerTeamId: 100, killerId: 1, monsterType: "DRAGON" });
  ev({ type: "CHAMPION_KILL", timestamp: 11 * MIN, killerId: 1, victimId: 8, assistingParticipantIds: [], position: { x: 7000, y: 7000 } });
  ev({ type: "ELITE_MONSTER_KILL", timestamp: 11.8 * MIN, killerTeamId: 100, killerId: 1, monsterType: "DRAGON" });
  // 22:45 : tué par 3, dragon adverse à 23:22 ; 25:00 : tué seul par 3 dans leur jungle.
  ev({ type: "CHAMPION_KILL", timestamp: 22.75 * MIN, killerId: 7, victimId: 1, assistingParticipantIds: [6, 8], position: { x: 4600, y: 8250 } });
  ev({ type: "CHAMPION_KILL", timestamp: 22.8 * MIN, killerId: 6, victimId: 2, assistingParticipantIds: [], position: { x: 4700, y: 8200 } });
  ev({ type: "ELITE_MONSTER_KILL", timestamp: 23.37 * MIN, killerTeamId: 200, killerId: 6, monsterType: "DRAGON" });
  ev({ type: "CHAMPION_KILL", timestamp: 25 * MIN, killerId: 7, victimId: 1, assistingParticipantIds: [6, 8], position: { x: 10500, y: 8500 } });
  ev({ type: "ITEM_PURCHASED", timestamp: 3.6 * MIN, participantId: 1, itemId: 1102 });
  ev({ type: "ITEM_PURCHASED", timestamp: 10.2 * MIN, participantId: 1, itemId: 6672 });
  return { account: "A", match: { matchId: "M", duration: 1800, start: 0, version: "16.23.1", queue: 420, teams: [], parts }, timeline: { frames } } as unknown as Detail;
}

describe("ce que la partie t'apprend", () => {
  const f = gameFacts(detail())!;
  it("faits : morts (adversaires, allié dans le combat, objectif adverse ensuite), premier retour, objets", () => {
    expect(f.deaths.map((d) => [Math.round(d.t / 1000), d.enemies, d.allyInFight, d.objAfter?.label ?? null, d.zone])).toEqual([[1365, 3, true, "dragon", "ownJungle"], [1500, 3, false, null, "enemyJungle"]]);
    expect(f.firstBack!.t).toBe(3.6 * MIN);
    expect(f.items.map((i) => i.id)).toEqual(["6672"]);
  });
  it("le tournant : le début, puis l'avance perdue avec ses morts", () => {
    const l = lesson(f, null, [], "deathBeforeObjective");
    expect(l.turning[0]).toMatch(/^Excellent début : tous les objectifs avant 15 min, \+5\s000 d'or d'équipe à 15 min\.$/);
    expect(l.turning[1]).toMatch(/^Avance perdue entre 15 et 24 min ; depuis 15 min, 2 morts, dont 1 juste avant un dragon ou un Nashor adverse\.$/);
  });
  it("bien joué, à corriger (avec quoi faire), à revoir, thème", () => {
    const l = lesson(f, null, [], "deathBeforeObjective");
    expect(l.well[0].text).toMatch(/^11:00 — kill sur Taliyah, puis dragon pour ton équipe à 11:48\.$/);
    expect(l.fix.map((x) => x.text)).toEqual([
      "22:45 — tué par Smolder avec 2 autres ; dragon adverse à 23:22. À faire : une minute avant l'objectif, regroupe-toi ou recule.",
      "25:00 — tué par Smolder avec 2 autres, seul. À faire : seul et sans vision, ne t'avance pas vers eux.",
    ]);
    expect(l.theme).toMatchObject({ respected: false, text: "Pas respecté : 1 fois (22:45)." });
    // Jamais « à 1 contre 3 » : la chronologie ne dit pas combien d'alliés étaient là.
    expect(JSON.stringify(l)).not.toMatch(/1 contre 3/);
  });
  it("erreurs comptées pour le thème de la semaine", () => {
    const e = countErrors(f);
    expect([e.deathBeforeObjective.length, e.aloneOutnumbered.length, e.enemyJungleDeath.length]).toEqual([1, 1, 1]);
  });
  it("zones de la carte", () => {
    expect(zone(1500, 8000, 100)).toBe("lane");
    expect(zone(10500, 8500, 100)).toBe("enemyJungle");
    expect(zone(9500, 10500, 100)).toBe("lane"); // la mid lane
    expect(zone(4000, 6000, 100)).toBe("ownJungle");
  });
});

describe("thème de la semaine", () => {
  const stat = (key: ErrorStat["key"], withError: number, perGame = 1): ErrorStat => ({ key, label: key, games: 20, withError, perGame, margin: 0.3, examples: [] });
  it("l'erreur personnelle qui revient dans le plus de parties ; pas les objectifs (déjà un objectif) ; 20 parties", () => {
    expect(pickTheme([stat("freeObjective", 15), stat("deathBeforeObjective", 11), stat("aloneOutnumbered", 10)])!.key).toBe("deathBeforeObjective");
    expect(pickTheme([{ ...stat("deathBeforeObjective", 11), games: 19 }])).toBeNull();
  });
  it("bilan : verdict seulement si net, sinon le dire", () => {
    expect(themeVerdict({ perGame: 1.3, margin: 0.3, games: 20 }, { perGame: 0.2, margin: 0.2, games: 20 }).verdict).toBe("Progrès net.");
    expect(themeVerdict({ perGame: 1.3, margin: 0.3, games: 20 }, { perGame: 1.1, margin: 0.4, games: 20 }).verdict).toBe("Pas d'écart net pour l'instant.");
    expect(themeVerdict({ perGame: 1.3, margin: 0.3, games: 20 }, { perGame: 0, margin: 0, games: 2 }).verdict).toMatch(/Pas encore assez de parties/);
    expect(shareText(11, 20)).toBe("plus de la moitié de tes dernières parties");
  });
});

describe("objets selon la compo", () => {
  const shares = (w: number, wo: number) => ({ with: { games: 100, share: { "3091": w, "6672": 0.9 } }, without: { games: 100, share: { "3091": wo, "6672": 0.9 } } });
  const tags = { physical: shares(0.1, 0.1), magic: shares(0.25, 0.08), healers: shares(0.1, 0.1), tanks: shares(0.1, 0.1), cc: shares(0.1, 0.1) } as TagShares;
  it("objet nettement plus pris contre ce trait : une ligne, contre quoi et contre qui", () => {
    const s = situationalItems(tags, ["Mordekaiser", "Cassiopeia", "Zac", "Yone", "Nami"].map(K), "Diamant+");
    expect(s.map((x) => x.line)).toEqual(["Au bout du rouleau : contre leurs dégâts magiques (Mordekaiser, Cassiopeia)."]);
    expect(s[0].detail).toMatch(/25 % des 100 parties Diamant\+ .* 8 % sans/);
    expect(situationalItems(tags, ["Darius", "Urgot", "Draven"].map(K), "Diamant+")).toEqual([]);
  });
  it("profil et comparaison du build", () => {
    expect(compoProfile(["Mordekaiser", "Cassiopeia", "Zac"].map(K))).toBe("magic");
    const ref = { physical: { games: 100, share: { "6672": 0.9, "3026": 0.05 } }, magic: { games: 100, share: { "6672": 0.9 } }, mixed: { games: 10, share: {} } };
    const l = buildLines(["3026"], "physical", ref, ["6672"]).map((x) => x.text);
    expect(l).toContain("Ange gardien : rarement pris contre une compo surtout physique.");
    expect(l.some((x) => /Tueur de krakens : pris par la plupart, absent de ton build/.test(x))).toBe(true);
  });
});
