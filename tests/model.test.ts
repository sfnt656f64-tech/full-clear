// Tests lisibles : quelques résultats clés de la page d'origine, écrits en clair.
import { describe, expect, it } from "vitest";
import { TARGETS } from "../src/data/targets";
import { blueCombo, bluePassivePct } from "../src/model/blue";
import { redFight } from "../src/model/red";
import { growth, physMult, ranks, stats } from "../src/model/stats";
import { benchBlue, benchRed, goldEfficiency } from "../src/model/benchmark";

const CORE_BLUE = ["voltaic", "hubris", "lucidity"] as const;

describe("benchmark du 4ᵉ item bleu (niv. 14, Voltaic + Hubris 4 stacks + Lucidity)", () => {
  const bruiser = TARGETS.mid.bruiser;

  it("Serylda retire ~65 % des PV d'un bruiser, contre ~55 % pour Axiom Arc", () => {
    expect(blueCombo([...CORE_BLUE, "serylda"], 14, bruiser, { hubrisStacks: 4 }).pct).toBe(65);
    expect(blueCombo([...CORE_BLUE, "axiom"], 14, bruiser, { hubrisStacks: 4 }).pct).toBe(55.3);
  });

  it("Serylda est le meilleur 4ᵉ item contre toutes les cibles", () => {
    const rows = benchBlue();
    const serylda = rows.find((r) => r.k === "serylda")!;
    for (const r of rows) r.v.forEach((v, i) => expect(serylda.v[i]).toBeGreaterThanOrEqual(v));
  });

  it("Axiom, Youmuu, Bastionbreaker et Profane donnent le même résultat (seul le passif diffère, non modélisé)", () => {
    const rows = Object.fromEntries(benchBlue().map((r) => [r.k, r.v]));
    expect(rows.youmuu).toEqual(rows.axiom);
    expect(rows.bastion).toEqual(rows.axiom);
    expect(rows.profane).toEqual(rows.axiom);
  });
});

describe("benchmark du 4ᵉ item rouge (niv. 14, Voltaic + Cleaver + Steelcaps)", () => {
  const rows = Object.fromEntries(benchRed().map((r) => [r.k, r.v]));
  it("Serylda donne le meilleur DPS contre un tank (489)", () => {
    expect(rows.serylda[0]).toBe(489);
    expect(Math.max(...Object.values(rows).map((v) => v[0]))).toBe(489);
  });
  it("Death's Dance donne le plus de PV effectifs physiques, Sterak le plus en magique", () => {
    expect(rows.dd[3]).toBe(7456);
    expect(rows.sterak[4]).toBe(4234);
  });
});

describe("briques du modèle", () => {
  it("croissance des stats : 0 au niveau 1, 17 au niveau 18", () => {
    expect(growth(1)).toBe(0);
    expect(growth(18)).toBeCloseTo(17, 10);
  });

  it("ordre des sorts Q › W › E, R à 6/11/16", () => {
    expect(ranks(13)).toEqual({ Q: 5, W: 5, E: 1, R: 2 });
    expect(ranks(18)).toEqual({ Q: 5, W: 5, E: 5, R: 3 });
  });

  it("passif Shadow Assassin : 20 % au niveau 1, 40 % au niveau 18", () => {
    expect(bluePassivePct(1)).toBe(0.2);
    expect(bluePassivePct(18)).toBeCloseTo(0.4, 12);
  });

  it("létalité et % de pénétration : armure × (1 − pén) − létalité, plancher 0", () => {
    expect(physMult({ pen: 0, leth: 0 }, 100, 0)).toBe(0.5);
    expect(physMult({ pen: 35, leth: 0 }, 100, 0)).toBeCloseTo(100 / 165, 12);
    expect(physMult({ pen: 0, leth: 200 }, 100, 0)).toBe(1);
  });

  it("Hubris : +15 AD + 3 par stack, inactif sans stacks", () => {
    const base = stats(["hubris"], 13).bonusAD;
    expect(stats(["hubris"], 13, { hubrisStacks: 0 }).bonusAD - base).toBe(15);
    expect(stats(["hubris"], 13, { hubrisStacks: 4 }).bonusAD - base).toBe(27);
    expect(stats(["hubris"], 13, { hubrisStacks: -1 }).bonusAD).toBe(base);
  });

  it("Serpent's Fang divise le bouclier par deux dans le combo bleu", () => {
    const t = TARGETS.mid.shield;
    const withSerpent = blueCombo(["voltaic", "hubris", "lucidity", "serpent"], 14, t, { hubrisStacks: 4 });
    expect(withSerpent.pct).toBe(130);
  });

  it("combat rouge : 6 s par défaut, DPS = total / 6", () => {
    const r = redFight(["voltaic", "cleaver", "steelcaps"], 14, TARGETS.mid.tank);
    expect(r.dps).toBe(Math.round(r.total / 6));
  });

  it("valeur brute : Axiom en tête (126 %), Sterak dernier (33 %, tout est dans le passif)", () => {
    const g = goldEfficiency();
    expect(g[0]).toEqual({ k: "axiom", s: 3465, e: 126 });
    expect(g.at(-1)).toEqual({ k: "sterak", s: 1068, e: 33 });
    expect(g.find((r) => r.k === "voltaic")!.e).toBe(91);
  });
});
