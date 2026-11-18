// Tests lisibles du moteur de draft sur les 4 exemples de la page d'origine.
import { describe, expect, it } from "vitest";
import { champ } from "../src/data/champions";
import { EXAMPLE_DRAFTS } from "../src/data/guides";
import { draftReport } from "../src/engine/draft";

const report = (name: string, stage: "mid" | "late" = "mid") => {
  const [en, al] = EXAMPLE_DRAFTS[name];
  return draftReport(en.map(champ), al.map(champ), stage, "auto")!;
};

describe("drafts d'exemple", () => {
  it("Mages + enchanteur → bleu, Swiftness, Axiom en 4ᵉ (une seule source de boucliers : pas de Serpent's)", () => {
    const r = report("Mages + enchanteur");
    expect(r.form).toBe("blue");
    expect(r.analysis.shields).toBe(1);
    expect(r.build).toEqual(["voltaic", "hubris", "swiftness", "axiom", "serylda", "edge"]);
  });

  it("Frontline lourde → rouge, Cleaver en premier puis Serylda", () => {
    const r = report("Frontline lourde");
    expect(r.form).toBe("red");
    expect(r.build.slice(0, 2)).toEqual(["cleaver", "voltaic"]);
    expect(r.build).toContain("serylda");
  });

  it("Bruisers AD → rouge, Death's Dance", () => {
    const r = report("Bruisers AD");
    expect(r.form).toBe("red");
    expect(r.build).toContain("dd");
  });

  it("Beaucoup de soins → note anti-heal", () => {
    const r = report("Beaucoup de soins");
    expect(r.analysis.heals).toBeGreaterThanOrEqual(2);
    expect(r.notes.join(" ")).toMatch(/soins/);
  });

  it("moins de 3 adversaires → pas d'analyse", () => {
    expect(draftReport([champ("Ahri"), champ("Zed"), null, null, null], [], "mid", "auto")).toBeNull();
  });

  it("forme forcée respectée", () => {
    expect(report("Frontline lourde").form).toBe("red");
    const [en, al] = EXAMPLE_DRAFTS["Frontline lourde"];
    expect(draftReport(en.map(champ), al.map(champ), "mid", "blue")!.form).toBe("blue");
  });

  it("mi-partie : 3 items + bottes simulés ; fin de partie : build complet", () => {
    expect(report("Bruisers AD", "mid").simBuild).toHaveLength(4);
    expect(report("Bruisers AD", "late").simBuild).toHaveLength(6);
  });
});
