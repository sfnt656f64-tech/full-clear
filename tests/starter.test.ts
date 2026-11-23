// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { champ } from "../src/data/champions";
import { STARTER_ITEM_IDS, STARTERS } from "../src/data/starters";
import { analyse } from "../src/engine/analyse";
import { chooseStarter, STARTER_EARLY_ENEMIES, STARTER_GANK_ALLIES } from "../src/engine/build";
import { draftReport } from "../src/engine/draft";
import { renderReport } from "../src/ui/draft";
import { buildDraftView } from "../desktop/draft-view";

const x = (en: string[], al: string[] = []) => analyse(en.map(champ), al.map(champ));

describe("familiers de jungle (Data Dragon)", () => {
  it("noms, prix et effets des trois familiers", () => {
    expect(STARTERS.scorchclaw).toMatchObject({ id: "1101", name: "Scorchclaw Pup", nameFr: "Bébé Chardent", cost: 450 });
    expect(STARTERS.gustwalker).toMatchObject({ id: "1102", name: "Gustwalker Hatchling", nameFr: "Bébé Saute-nuages", cost: 450 });
    expect(STARTERS.mosstomper).toMatchObject({ id: "1103", name: "Mosstomper Seedling", nameFr: "Bébé Ixamandre", cost: 450 });
    expect(STARTERS.scorchclaw.effectFr).toMatch(/brûle.*ralentisse/);
    expect(STARTERS.gustwalker.effectFr).toMatch(/vitesse de déplacement/);
    expect(STARTERS.mosstomper.effectFr).toMatch(/bouclier/);
    for (const s of Object.values(STARTERS)) expect(s.effectFr).not.toMatch(/</);
    expect([...STARTER_ITEM_IDS].sort()).toEqual(["1101", "1102", "1103", "1105", "1106", "1107"]);
  });
});

describe("choix du familier", () => {
  it("Scorchclaw (feu) par défaut", () => {
    const c = chooseStarter(x(["Ahri", "Jinx", "Lulu", "Ornn", "Sejuani"], ["Jax", "Ezreal", "Karma"]));
    expect(c).toHaveLength(1);
    expect(c[0][0]).toBe("scorchclaw");
    expect(c[0][1]).toMatch(/le plus joué/);
  });

  it(`Mosstomper (terre) dès ${STARTER_EARLY_ENEMIES} adversaires à early agressif`, () => {
    const c = chooseStarter(x(["LeeSin", "Draven", "Ahri", "Ornn", "Lulu"]));
    expect(c.map((o) => o[0])).toEqual(["mosstomper", "scorchclaw"]);
    expect(c[0][1]).toMatch(/Lee Sin, Draven/);
    expect(c[1][1]).toMatch(/^alternative/);
    expect(chooseStarter(x(["LeeSin", "Ahri", "Ornn"]))[0][0]).toBe("scorchclaw");
  });

  it(`Gustwalker (vent) dès ${STARTER_GANK_ALLIES} alliés avec du CC pour suivre les ganks`, () => {
    const c = chooseStarter(x(["Ahri", "Jinx", "Lulu"], ["Ornn", "Nautilus", "Syndra", "Ezreal"]));
    expect(c.map((o) => o[0])).toEqual(["gustwalker", "scorchclaw"]);
    expect(c[0][1]).toMatch(/3 alliés/);
  });

  it("les deux à la fois : la sécurité d'abord (terre), puis vent, puis feu", () => {
    const c = chooseStarter(x(["LeeSin", "Draven", "Ahri"], ["Ornn", "Nautilus", "Syndra"]));
    expect(c.map((o) => o[0])).toEqual(["mosstomper", "gustwalker", "scorchclaw"]);
  });
});

describe("affichage", () => {
  const rep = draftReport(["LeeSin", "Draven", "Ahri", "Ornn", "Lulu"].map(champ), ["Jax", "Ezreal"].map(champ), "mid", "auto")!;

  it("en tête du build dans le simulateur de draft du site, avec sa justification", () => {
    const doc = document;
    doc.body.innerHTML = renderReport(rep);
    const text = doc.body.textContent!;
    expect(text).toContain("Familier de départ");
    expect(text).toContain("Mosstomper Seedling");
    expect(text).toMatch(/Mosstomper Seedling → /);
    expect(text).toContain("Adulte : Quand votre compagnon");
    const path = doc.querySelector(".path")!;
    expect(path.firstElementChild!.getAttribute("title")).toBe("Mosstomper Seedling");
  });

  it("dans la vue de draft de l'appli de bureau", () => {
    const key = (id: string) => champ(id).key!;
    const v = buildDraftView({
      timerPhase: "BAN_PICK", timeLeftMs: 0, myTurn: false, side: null, unavailable: [],
      me: { championId: 141, intentId: 0, position: "jungle" },
      allies: ["Jax", "Ezreal"].map((id) => ({ championId: key(id), position: "" })),
      enemies: ["LeeSin", "Draven", "Ahri", "Ornn", "Lulu"].map((id) => ({ championId: key(id) })),
    });
    expect(v.build?.starter[0]).toMatchObject({ key: "mosstomper", nameFr: "Bébé Ixamandre", cost: 450 });
    expect(v.build?.starter[0].icon).toMatch(/item\/1103\.png$/);
  });
});
