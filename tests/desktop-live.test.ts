import { describe, expect, it } from "vitest";
import { championOf, itemsOf, toLiveSnapshot, type LiveSnapshot } from "../desktop/live-client";
import { adjustAnalysis, buildOverlayView, owns, readEnemyItems, remainingCost, SHOP } from "../desktop/next-item";
import { parseSettings, parseWindowMode } from "../desktop/settings";
import { champ } from "../src/data/champions";
import { analyse } from "../src/engine/analyse";
import { chooseBuild } from "../src/engine/build";
import { ITEMS } from "../src/data/items";

const bag = (...ids: (number | string)[]) => {
  const b = new Map<string, number>();
  for (const id of ids) b.set(String(id), (b.get(String(id)) ?? 0) + 1);
  return b;
};

/** Joueur de /liveclientdata/playerlist, avec les champs d'identité à ne jamais recopier. */
const p = (champion: string, team: "ORDER" | "CHAOS", n: number, items: number[] = []) => ({
  championName: champion, rawChampionName: `game_character_displayname_${champion}`, team, level: 9, isBot: false, isDead: false,
  riotId: `Joueur${n}#TAG${n}`, riotIdGameName: `Joueur${n}`, riotIdTagLine: `TAG${n}`, summonerName: `Joueur${n}#TAG${n}`, position: "",
  skinName: "", scores: { kills: 0 }, summonerSpells: {}, runes: {},
  items: items.map((itemID, slot) => ({ itemID, count: 1, slot, price: 0, displayName: "x", canUse: false, consumable: false, rawDisplayName: "x" })),
});

/** Par défaut, le familier de jungle est déjà acheté (Bébé Chardent) : l'overlay propose alors le build. */
function game(myItems: number[] = [1101], enemyItems: number[][] = []) {
  const active = { currentGold: 1234.7, level: 9, riotId: "joueur3#tag3", summonerName: "Joueur3#TAG3", championStats: {}, abilities: {}, fullRunes: {} };
  const players = [
    p("Ornn", "ORDER", 1), p("Syndra", "ORDER", 2), p("Kayn", "ORDER", 3, myItems), p("Jhin", "ORDER", 4), p("Nautilus", "ORDER", 5),
    ...["Ahri", "Jinx", "Lulu", "Gnar", "Viego"].map((c, i) => p(c, "CHAOS", 6 + i, enemyItems[i] ?? [])),
  ];
  return { active, players };
}

describe("API en jeu (port 2999)", () => {
  it("te reconnaît et ne garde ni Riot ID ni pseudo", () => {
    const { active, players } = game([1036, 2003, 2003]);
    const s = toLiveSnapshot(active, players)!;
    expect(JSON.stringify(s)).not.toMatch(/Joueur|TAG|riotId|summoner/i);
    expect(s).toEqual({
      gold: 1234,
      level: 9,
      me: { champion: "Kayn", items: [1036, 2003, 2003] },
      allies: ["Ornn", "Syndra", "Jhin", "Nautilus"],
      enemies: ["Ahri", "Jinx", "Lulu", "Gnar", "Viego"].map((champion) => ({ champion, items: [] })),
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
    expect(itemsOf({ items: [{ itemID: 2003, count: 3 }, { itemID: 0 }, "x"] })).toEqual([2003, 2003, 2003]);
  });
});

describe("prochain item", () => {
  it("compte le prix restant avec les composants déjà achetés", () => {
    // Cyclosabre voltaïque = Brutaliseur + 2 Épées longues.
    expect(remainingCost("6699", bag()).gold).toBe(3000);
    expect(remainingCost("6699", bag(1036)).gold).toBe(3000 - 350);
    expect(remainingCost("6699", bag(2020, 1036, 1036)).gold).toBe(3000 - 1337 - 700);
    // Une Pioche dans l'inventaire réduit le Brutaliseur.
    expect(remainingCost("6699", bag(1037)).gold).toBe(3000 - 875);
    expect(remainingCost("6699", bag(6699)).gold).toBe(0);
  });

  it("considère les bottes de niveau 3 comme possédées", () => {
    expect(owns(bag(3174), "3047")).toBe(true);
    expect(owns(bag(1001), "3047")).toBe(false);
    // Une amélioration non-bottes ne compte pas pour son composant.
    expect(owns(bag(6694), "3133")).toBe(false);
  });

  it("propose l'item du build suivant, l'or manquant et un composant achetable", () => {
    const { active, players } = game();
    const s = toLiveSnapshot(active, players)!;
    const v = buildOverlayView(s, "blue");
    expect(v.form).toBe("blue");
    const first = ITEMS[chooseBuild(analyse(["Ahri", "Jinx", "Lulu", "Gnar", "Viego"].map(champ), ["Ornn", "Syndra", "Jhin", "Nautilus"].map(champ)), "blue").b[0]].id;
    expect(v.next?.item.id).toBe(first);
    expect(v.next?.rank).toBe(1);
    expect(v.next?.missingGold).toBe(SHOP[first!].cost - 1234);
    // Avec 1234 po : le composant le plus cher achetable.
    expect(v.next?.component?.cost).toBeLessThanOrEqual(1234);
    expect(v.next?.component?.cost).toBeGreaterThan(0);
    expect(v.then).toHaveLength(2);
  });

  it("passe à l'item suivant une fois le premier acheté, et annonce un build fini", () => {
    const { active, players } = game();
    const s = toLiveSnapshot(active, players)!;
    const ids = buildOverlayView(s, "blue");
    const firstId = Number(ids.next!.item.id);
    const after = buildOverlayView({ ...s, me: { ...s.me, items: [firstId] } }, "blue");
    expect(after.next?.rank).toBe(2);
    expect(after.owned).toBe(1);

    const build = chooseBuild(analyse(s.enemies.map((e) => champ(e.champion!)), s.allies.map((a) => champ(a!))), "blue").b;
    const done = buildOverlayView({ ...s, me: { ...s.me, items: build.map((k) => Number(ITEMS[k].id)) } }, "blue");
    expect(done.next).toBeNull();
  });

  it("dit « achetable maintenant » quand l'or suffit", () => {
    const { active, players } = game();
    const s: LiveSnapshot = { ...toLiveSnapshot(active, players)!, gold: 5000 };
    const v = buildOverlayView(s, "red");
    expect(v.next?.missingGold).toBe(0);
    expect(v.next?.component).toBeNull();
  });
});

describe("familier de jungle dans l'overlay", () => {
  it("le propose en premier en début de partie, avec sa justification", () => {
    const { active, players } = game([]);
    const s = toLiveSnapshot(active, players)!;
    const v = buildOverlayView(s, "blue");
    // Ornn, Syndra et Nautilus ont du CC pour suivre les ganks → Gustwalker (vent).
    expect(v.next).toMatchObject({ rank: 0, item: { id: "1102", name: "Bébé Saute-nuages", cost: 450 }, missingGold: 0, component: null });
    expect(v.next?.why).toMatch(/ganks/);
    // Les deux premiers items du build restent visibles en aperçu.
    expect(v.then.map((t) => t.id)).toEqual([ITEMS.voltaic.id, ITEMS.hubris.id]);
    expect(buildOverlayView({ ...s, gold: 300 }, "blue").next?.missingGold).toBe(150);
  });

  it("passe au build dès qu'un familier (toutes variantes) ou un item du build est acheté", () => {
    const { active, players } = game([]);
    const s = toLiveSnapshot(active, players)!;
    for (const pet of [1101, 1102, 1103, 1105, 1106, 1107]) {
      expect(buildOverlayView({ ...s, me: { ...s.me, items: [pet] } }, "blue").next?.rank).toBe(1);
    }
    // Sans familier (pas en jungle ?) mais avec un premier item : on ne le propose plus.
    expect(buildOverlayView({ ...s, me: { ...s.me, items: [Number(ITEMS.voltaic.id)] } }, "blue").next?.rank).toBe(2);
  });
});

describe("items adverses", () => {
  const enemies = ["Ahri", "Jinx", "Lulu", "Gnar", "Viego"];

  it("repère l'armure, le vol de vie et la part de dégâts physiques", () => {
    // Jinx : Danse de la mort (50 armure) + Coques en acier (25) + Lame du roi déchu (vol de vie).
    const items = [[], [6333, 3047, 3153], [], [], []];
    const r = readEnemyItems(enemies.map((champion, i) => ({ champion, items: items[i] })), enemies.map(champ));
    expect(r.armorStackers).toBe(0); // 75 < 80
    expect(r.healers).toBe(1); // Lame du roi déchu
    const armored = readEnemyItems(enemies.map((champion, i) => ({ champion, items: i === 1 ? [6333, 3174] : [] })), enemies.map(champ));
    expect(armored.armorStackers).toBe(1); // 50 + 35 = 85
    expect(armored.adShare).toBeNull(); // trop peu d'items offensifs
  });

  it("ajuste l'analyse et l'explique", () => {
    const x = analyse(enemies.map(champ), []);
    const { x: y, reasons } = adjustAnalysis(x, { armorStackers: 2, healers: 1, adShare: 1 });
    expect(y.tanks).toBe(x.tanks + 2);
    expect(y.heals).toBe(x.heals + 1);
    expect(y.adShare).toBeCloseTo((x.adShare + 1) / 2);
    expect(reasons).toHaveLength(3);
    expect(adjustAnalysis(x, { armorStackers: 0, healers: 0, adShare: null }).reasons).toEqual([]);
  });

  it("fait remonter Serylda quand les adversaires stackent l'armure", () => {
    const { active, players } = game();
    const s = toLiveSnapshot(active, players)!;
    // Items purement défensifs (Présage de Randuin + Coques en acier = 100 d'armure), pour ne pas changer la part AD/AP.
    const armor = [3075, 3047];
    const stacked: LiveSnapshot = { ...s, enemies: s.enemies.map((e, i) => (i < 3 ? { ...e, items: armor } : e)) };
    // Les 3 premiers items du build bleu sont achetés : on regarde le 4ᵉ.
    const first3 = ["voltaic", "hubris", "swiftness"].map((k) => Number(ITEMS[k as "voltaic"].id));
    const mine = (x: LiveSnapshot): LiveSnapshot => ({ ...x, me: { ...x.me, items: first3 } });
    const plain = buildOverlayView(mine(s), "blue");
    const adj = buildOverlayView(mine(stacked), "blue");
    expect(plain.next?.item.id).toBe(ITEMS.axiom.id);
    expect(adj.next?.item.id).toBe(ITEMS.serylda.id);
    expect(adj.next?.rank).toBe(4);
    expect(adj.reasons.join(" ")).toMatch(/3 adversaire\(s\) avec 80\+ d'armure/);
    // En rouge : Couperet noir passe en premier.
    expect(buildOverlayView(stacked, "red").next?.item.id).toBe(ITEMS.cleaver.id);
    expect(buildOverlayView(s, "red").next?.item.id).toBe(ITEMS.voltaic.id);
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
