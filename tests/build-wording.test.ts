import { describe, expect, it } from "vitest";
import { chooseBoots, chooseStarter } from "../src/engine/build";
import type { Analysis } from "../src/engine/analyse";

const base = { E: [], A: [], apShare: 0.3, adShare: 0.5, hard: 0, aa: 0, slows: 0, ranged: 0 } as unknown as Analysis;

describe("familier et bottes : pas de « alternative : par défaut »", () => {
  it("Scorchclaw par défaut, puis en alternative sans répétition", () => {
    expect(chooseStarter(base)[0][1]).toMatch(/^par défaut : le départ le plus joué/);
    const early = { ...base, E: [{ name: "Lee Sin", early: true }, { name: "Elise", early: true }] } as unknown as Analysis;
    const s = chooseStarter(early);
    expect(s.map((x) => x[0])).toEqual(["mosstomper", "scorchclaw"]);
    expect(s[1][1]).toMatch(/^alternative : le départ le plus joué sur Kayn/);
    expect(s.flatMap((x) => x[1]).join(" ")).not.toMatch(/alternative : par défaut/);
  });
  it("bottes : alternative sans « par défaut »", () => {
    const b = chooseBoots({ ...base, apShare: 0.7 } as Analysis, "blue");
    expect(b.map((x) => x[0])).toEqual(["mercury", "lucidity"]);
    expect(b[1][1]).toBe("alternative, le choix habituel en bleu : haste sur E/R et sur les sorts d'invocateur");
  });
});
