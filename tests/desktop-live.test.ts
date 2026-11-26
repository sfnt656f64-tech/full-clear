import { describe, expect, it } from "vitest";
import { championOf, toLiveSnapshot } from "../desktop/live-client";
import { buildPlanView, SHOP } from "../desktop/next-item";
import { parseSettings, parseWindowMode } from "../desktop/settings";
import { champ } from "../src/data/champions";
import { analyse } from "../src/engine/analyse";
import { chooseBuild } from "../src/engine/build";
import { ITEMS } from "../src/data/items";

/** Joueur de /liveclientdata/playerlist, avec les champs d'identité à ne jamais recopier. */
const p = (champion: string, team: "ORDER" | "CHAOS", n: number, items: number[] = []) => ({
  championName: champion, rawChampionName: `game_character_displayname_${champion}`, team, level: 9, isBot: false, isDead: false,
  riotId: `Joueur${n}#TAG${n}`, riotIdGameName: `Joueur${n}`, riotIdTagLine: `TAG${n}`, summonerName: `Joueur${n}#TAG${n}`, position: "",
  skinName: "", scores: { kills: 0 }, summonerSpells: {}, runes: {},
  items: items.map((itemID, slot) => ({ itemID, count: 1, slot, price: 0, displayName: "x", canUse: false, consumable: false, rawDisplayName: "x" })),
});

function game(myItems: number[] = [1101], enemyItems: number[][] = []) {
  const active = { currentGold: 1234.7, level: 9, riotId: "joueur3#tag3", summonerName: "Joueur3#TAG3", championStats: {}, abilities: {}, fullRunes: {} };
  const players = [
    p("Ornn", "ORDER", 1), p("Syndra", "ORDER", 2), p("Kayn", "ORDER", 3, myItems), p("Jhin", "ORDER", 4), p("Nautilus", "ORDER", 5),
    ...["Ahri", "Jinx", "Lulu", "Gnar", "Viego"].map((c, i) => p(c, "CHAOS", 6 + i, enemyItems[i] ?? [])),
  ];
  return { active, players };
}

describe("API en jeu (port 2999)", () => {
  it("te reconnaît, ne garde ni Riot ID ni pseudo, et seulement les champions (ni or, ni niveau, ni items)", () => {
    const { active, players } = game([1036, 2003, 2003]);
    const s = toLiveSnapshot(active, players)!;
    expect(JSON.stringify(s)).not.toMatch(/Joueur|TAG|riotId|summoner|gold|level|items/i);
    expect(s).toEqual({
      me: { champion: "Kayn" },
      allies: ["Ornn", "Syndra", "Jhin", "Nautilus"],
      enemies: ["Ahri", "Jinx", "Lulu", "Gnar", "Viego"].map((champion) => ({ champion })),
    });
  });

  it("répartit les équipes depuis le côté rouge aussi", () => {
    const { players } = game();
    const s = toLiveSnapshot({ currentGold: 0, riotId: "Joueur7#TAG7" }, players)!;
    expect(s.me.champion).toBe("Jinx");
    expect(s.allies).toEqual(["Ahri", "Lulu", "Gnar", "Viego"]);
    expect(s.enemies.map((e) => e.champion)).toContain("Kayn");
  });

  it("renvoie null en spectateur ou si la réponse est invalide", () => {
    const { players } = game();
    expect(toLiveSnapshot({ riotId: "Inconnu#X" }, players)).toBeNull();
    expect(toLiveSnapshot(null, players)).toBeNull();
    expect(toLiveSnapshot({ riotId: "Joueur3#TAG3" }, "x")).toBeNull();
  });

  it("reconnaît les champions par nom interne (Wukong = MonkeyKing) ou par nom affiché", () => {
    expect(championOf({ rawChampionName: "game_character_displayname_MonkeyKing", championName: "Wukong" })).toBe("MonkeyKing");
    expect(championOf({ championName: "Kai'Sa" })).toBe("Kaisa");
    expect(championOf({ championName: "???" })).toBeNull();
  });
});

describe("overlay : build décidé en draft, jamais selon l'état de la partie (règles Riot)", () => {
  const champs = { me: "Kayn", allies: ["Ornn", "Syndra", "Jhin", "Nautilus"], enemies: ["Ahri", "Jinx", "Lulu", "Gnar", "Viego"] };

  it("build complet et familier d'après les champions, avec ses raisons et ses « si… alors… »", () => {
    const v = buildPlanView(champs, "blue");
    const expected = chooseBuild(analyse(champs.enemies.map(champ), champs.allies.map(champ)), "blue").b.map((k) => ITEMS[k].id);
    expect(v.build.map((t) => t.id)).toEqual(expected);
    // Ornn, Syndra et Nautilus ont du CC pour suivre les ganks → Gustwalker (vent).
    expect(v.starter).toMatchObject({ id: "1102", name: "Bébé Saute-nuages" });
    expect(v.starter?.why).toMatch(/ganks/);
    expect(v.rules.length).toBeGreaterThan(0);
    // Noms dans la langue du client.
    expect(v.build.every((t) => t.name === (SHOP[t.id]?.nameFr ?? t.name))).toBe(true);
    // Aucune trace d'or, d'inventaire ou d'item « suivant ».
    expect(Object.keys(v)).not.toEqual(expect.arrayContaining(["gold", "next", "owned"]));
  });

  it("le même build quel que soit le moment de la partie : seuls les champions comptent", () => {
    const { active, players } = game([1036, 6699]);
    const s = toLiveSnapshot(active, players)!;
    const m = { me: s.me.champion, allies: s.allies, enemies: s.enemies.map((e) => e.champion) };
    expect(buildPlanView(m, "red")).toEqual(buildPlanView({ ...m }, "red"));
    expect(buildPlanView(m, "red").build.map((t) => t.id)).toEqual(buildPlanView(champs, "red").build.map((t) => t.id));
  });
});

describe("réglages", () => {
  it("lit des réglages partiels ou corrompus", () => {
    expect(parseSettings(null)).toMatchObject({ overlay: { enabled: true, x: undefined, y: undefined }, formChoice: "auto" });
    expect(parseSettings('{"overlay":{"enabled":false,"x":10.4,"y":"a"},"formChoice":"red"}')).toMatchObject({ overlay: { enabled: false, x: 10, y: undefined }, formChoice: "red" });
    expect(parseSettings("{oups").formChoice).toBe("auto");
  });

  it("lit le mode d'affichage du jeu", () => {
    expect(parseWindowMode("[General]\r\nWindowMode=2\r\n")).toBe("borderless");
    expect(parseWindowMode("WindowMode=0")).toBe("fullscreen");
    expect(parseWindowMode("WindowMode=1")).toBe("windowed");
    expect(parseWindowMode("Autre=1")).toBe("unknown");
    expect(parseWindowMode(null)).toBe("unknown");
  });
});
