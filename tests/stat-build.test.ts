import { describe, expect, it } from "vitest";
import { statBuild, MIN_GAMES } from "../desktop/coach/stat-build";
import { buildPlanView, SHOP } from "../desktop/next-item";
import type { MetaBuildRow, MetaPartRow } from "../desktop/meta/meta-stats";
import { champ } from "../src/data/champions";

const VI = champ("Vi").key!;

/** Vi jungle : Black Cleaver → Sundered Sky → Sterak's, Plated Steelcaps (ou Mercury), Scorchclaw ; parfois Mortal Reminder, Randuin, Spirit Visage. */
function parts(n = 100): MetaPartRow[] {
  return Array.from({ length: n }, (_, i) => ({
    matchId: `V${i}`, championId: VI, role: "JUNGLE", win: i % 2 === 0, perks: null,
    items: [3071, 6610, 3053, i % 3 === 0 ? 3111 : 3047, 1101, ...(i % 10 === 0 ? [3033] : []), ...(i % 8 === 0 ? [3143] : []), ...(i % 9 === 0 ? [3065] : [])],
  }));
}
const builds: MetaBuildRow[] = Array.from({ length: 10 }, () => ({ championId: VI, role: "JUNGLE", win: true, items: [6610, 3071, 3047, 3053] }));
const input = (over = {}) => ({ parts: parts(), builds, role: "JUNGLE", enemies: [], shop: SHOP, ...over });

describe("build statistique (autres champions)", () => {
  it("ordre du core d'après les chronologies, bottes après le premier item, familier le plus joué", () => {
    const b = statBuild(input())!;
    expect(b.ids.slice(0, 4)).toEqual(["6610", "3047", "3071", "3053"]);
    expect(b.starter).toBe("1101");
    expect(b.reasons).toEqual([]);
    expect(b.games).toBe(100);
  });

  it("sans chronologie : les items les plus présents en fin de partie", () => {
    expect(statBuild(input({ builds: [] }))!.ids.slice(0, 4)).toEqual(["3053", "3047", "3071", "6610"]);
  });

  it("anti-soins si l'équipe adverse se soigne, seulement avec un item joué sur ce champion", () => {
    const b = statBuild(input({ enemies: ["Aatrox", "Vladimir", "Soraka"].map((c) => champ(c)) }))!;
    expect(b.ids).toContain("3033");
    expect(b.reasons.join()).toContain("anti-soins");
  });

  it("dégâts adverses magiques : Mercury et un item de résistance magique joué sur ce champion", () => {
    const b = statBuild(input({ enemies: ["Ahri", "Syndra", "Brand", "Lillia", "Lulu"].map((c) => champ(c)) }))!;
    expect(b.ids[1]).toBe("3111");
    expect(b.ids).toContain("3065");
    expect(b.reasons.join()).toMatch(/magiques/);
  });

  it("pas assez de parties : pas de build", () => {
    expect(statBuild(input({ parts: parts(MIN_GAMES - 1) }))).toBeNull();
  });

  it("« si… alors… » : alternatives jouées sur ce champion, écrites avant la partie", () => {
    const b = statBuild(input())!;
    expect(b.ifThen.length).toBeGreaterThan(0);
    expect(b.ifThen.every((t) => t.startsWith("Si "))).toBe(true);
  });

  it("overlay : un autre champion que Kayn suit le build statistique complet", () => {
    const m = { me: "Vi", allies: [], enemies: [] };
    const v = buildPlanView(m, "auto", SHOP, statBuild(input()));
    expect(v.source).toBe("meta");
    expect(v.build.map((t) => t.id).slice(0, 4)).toEqual(["6610", "3047", "3071", "3053"]);
    expect(v.starter?.id).toBe("1101");
    expect(v.champion).toBe("Vi");
    const none = buildPlanView(m, "auto", SHOP, null);
    expect(none.source).toBe("none");
    expect(none.build).toEqual([]);
  });

  it("Kayn garde son modèle", () => {
    expect(buildPlanView({ me: "Kayn", allies: [], enemies: [] }, "auto", SHOP, null).source).toBe("kayn");
  });
});
