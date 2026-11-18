// Les chiffres cités dans les textes des guides doivent correspondre au modèle.
// Si ce test échoue après une mise à jour (patch, correction du modèle), mettre le texte à jour.
import { describe, expect, it } from "vitest";
import { GUIDES } from "../src/data/guides";
import { TARGETS } from "../src/data/targets";
import { axiomRefundPct, blueCombo } from "../src/model/blue";
import { benchRed } from "../src/model/benchmark";
import { stats } from "../src/model/stats";

const text = (form: "blue" | "red", i: number) => GUIDES[form][i].w;
const pctOf = (a: number, b: number) => Math.round((a / b - 1) * 100);
const red = Object.fromEntries(benchRed().map((r) => [r.k, r.v]));

describe("chiffres des guides", () => {
  it("Axiom : 21,5 % du CD du R, 46 létha avec Voltaic + Hubris", () => {
    expect(stats(["voltaic", "hubris", "axiom"], 14).leth).toBe(46);
    expect(axiomRefundPct(["voltaic", "hubris", "axiom"], 14)).toBe(21.5);
    expect(text("blue", 0)).toContain("21,5 %");
  });

  it("Serpent's rattrape presque Serylda contre un ADC + bouclier", () => {
    const o = { hubrisStacks: 4 };
    const serp = blueCombo(["voltaic", "hubris", "lucidity", "serpent"], 14, TARGETS.mid.shield, o).pct;
    const sery = blueCombo(["voltaic", "hubris", "lucidity", "serylda"], 14, TARGETS.mid.shield, o).pct;
    expect(sery - serp).toBeGreaterThan(0);
    expect(sery - serp).toBeLessThan(5);
  });

  it("Serylda : +23 % de DPS contre un tank par rapport à Death's Dance", () => {
    expect(pctOf(red.serylda[0], red.dd[0])).toBe(23);
    expect(text("red", 1)).toContain("+23 %");
  });

  it("Death's Dance : +24 % de PV effectifs physiques vs Sterak, +45 % vs un item offensif", () => {
    expect(pctOf(red.dd[3], red.sterak[3])).toBe(24);
    expect(pctOf(red.dd[3], red.serylda[3])).toBe(45);
    expect(text("red", 2)).toContain("+24 %");
    expect(text("red", 2)).toContain("+45 %");
  });

  it("Death's Dance fait jeu égal avec Sterak en PV effectifs magiques (écart < 3 %)", () => {
    expect(Math.abs(pctOf(red.dd[4], red.sterak[4]))).toBeLessThan(3);
  });

  it("Axiom fait plus de DPS que Death's Dance", () => {
    expect(red.axiom[0]).toBeGreaterThan(red.dd[0]);
    expect(red.axiom[1]).toBeGreaterThan(red.dd[1]);
  });
});
