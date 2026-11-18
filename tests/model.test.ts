// Tests lisibles : quelques résultats clés de la page d'origine, écrits en clair.
import { describe, expect, it } from "vitest";
import { TARGETS } from "../src/data/targets";
import { blueCombo, bluePassivePct } from "../src/model/blue";
import { redFight } from "../src/model/red";
import { conquerorAd, growth, physMult, ranks, stats } from "../src/model/stats";
import { RULES } from "../src/model/constants";
import { benchBlue, benchRed, goldEfficiency } from "../src/model/benchmark";

const CORE_BLUE = ["voltaic", "hubris", "lucidity"] as const;

describe("benchmark du 4ᵉ item bleu (niv. 14, Voltaic + Hubris 4 stacks + Lucidity)", () => {
  const bruiser = TARGETS.mid.bruiser;

  it("Serylda retire ~64 % des PV d'un bruiser, contre ~55 % pour Axiom Arc (sans runes)", () => {
    // Première version : 65,0 / 55,3 (Voltaic à 9 % au lieu de 8 %).
    expect(blueCombo([...CORE_BLUE, "serylda"], 14, bruiser, { hubrisStacks: 4 }).pct).toBe(64.2);
    expect(blueCombo([...CORE_BLUE, "axiom"], 14, bruiser, { hubrisStacks: 4 }).pct).toBe(54.7);
  });

  it("avec Dark Harvest (10 âmes), Serylda passe à ~68 % contre un bruiser", () => {
    const runes = { darkHarvest: { souls: 10 } };
    expect(blueCombo([...CORE_BLUE, "serylda"], 14, bruiser, { hubrisStacks: 4, runes }).pct).toBe(68.3);
  });

  it("Serylda est le meilleur 4ᵉ item contre toutes les cibles", () => {
    const rows = benchBlue();
    const serylda = rows.find((r) => r.k === "serylda")!;
    for (const r of rows) r.v.forEach((v, i) => expect(serylda.v[i]).toBeGreaterThanOrEqual(v));
  });

  it("Axiom, Youmuu et Profane donnent le même résultat ; Bastionbreaker fait plus grâce à Shaped Charge", () => {
    const rows = Object.fromEntries(benchBlue().map((r) => [r.k, r.v]));
    expect(rows.youmuu).toEqual(rows.axiom);
    expect(rows.profane).toEqual(rows.axiom);
    rows.bastion.forEach((v, i) => expect(v).toBeGreaterThan(rows.axiom[i]));
  });
});

describe("benchmark du 4ᵉ item rouge (niv. 14, Voltaic + Cleaver + Steelcaps)", () => {
  const rows = Object.fromEntries(benchRed().map((r) => [r.k, r.v]));
  it("Serylda donne le meilleur DPS contre un tank (484)", () => {
    expect(rows.serylda[0]).toBe(484);
    expect(Math.max(...Object.values(rows).map((v) => v[0]))).toBe(484);
  });
  it("Death's Dance donne le plus de PV effectifs, physiques et magiques (il diffère les deux)", () => {
    expect(rows.dd[3]).toBe(7677);
    expect(rows.dd[4]).toBe(4501);
    expect(rows.sterak[4]).toBe(4453);
  });
  it("Conqueror augmente le DPS et les soins", () => {
    const conq = Object.fromEntries(benchRed({ runes: { conqueror: true } }).map((r) => [r.k, r.v]));
    expect(conq.serylda[0]).toBe(521);
    expect(conq.serylda[2]).toBeGreaterThan(rows.serylda[2]);
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

  it("Serpent's Fang réduit le bouclier de 50 % dans le combo bleu", () => {
    const t = TARGETS.mid.shield;
    const withSerpent = blueCombo(["voltaic", "hubris", "lucidity", "serpent"], 14, t, { hubrisStacks: 4 });
    // Équivaut exactement à un bouclier de 175 sans réduction.
    const half = blueCombo(["voltaic", "hubris", "lucidity", "serpent"], 14, { ...t, shield: 175 }, { hubrisStacks: 4, rules: { ...RULES, serpentShieldReduction: 0 } });
    expect(t.shield).toBe(350);
    expect(withSerpent.pct).toBe(half.pct);
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

describe("corrections de l'étape 4 (wiki officiel)", () => {
  const adc = TARGETS.mid.adc;
  const log = (b: Parameters<typeof blueCombo>[0], opt = {}) => Object.fromEntries(blueCombo(b, 14, adc, { hubrisStacks: 4, ...opt }).log);

  it("Voltaic : 8 % des PV actuels (et non 9 %)", () => {
    expect(RULES.voltaic.currentHp).toBe(0.08);
    expect(Object.keys(log([...CORE_BLUE]))).toContain("Voltaic (8% PV act.)");
  });

  it("Death's Dance : 30 % différés, physiques ET magiques", () => {
    const sterak = redFight(["voltaic", "cleaver", "steelcaps", "sterak"], 14, TARGETS.mid.tank);
    const dd = redFight(["voltaic", "cleaver", "steelcaps", "dd"], 14, TARGETS.mid.tank);
    const base = redFight(["voltaic", "cleaver", "steelcaps"], 14, TARGETS.mid.tank);
    expect(dd.ehpMag / base.ehpMag).toBeCloseTo(1 / (1 - 0.3 * 0.5), 2);
    expect(sterak.ehpMag).toBeGreaterThan(base.ehpMag); // Sterak : PV bruts
  });

  it("fragment de PV évolutifs : +10 PV par niveau", () => {
    expect(stats([], 14).maxHP - stats([], 14, { rules: { ...RULES, healthShard: false } }).maxHP).toBe(140);
    expect(stats([], 14).bonusHP).toBe(140);
  });

  it("Bastionbreaker : 40 + 1,5 par létalité en dégâts bruts sur le premier sort", () => {
    const l = log([...CORE_BLUE, "bastion"]);
    expect(stats([...CORE_BLUE, "bastion"], 14).leth).toBe(46);
    expect(l["Bastionbreaker (bruts)"]).toBe(40 + 1.5 * 46);
  });

  it("Dark Harvest : 30 + 11 par âme + 10 % de l'AD bonus, une fois, quand la cible est sous 50 %", () => {
    const l = blueCombo([...CORE_BLUE], 14, adc, { hubrisStacks: 4, runes: { darkHarvest: { souls: 10 } } }).log;
    const dh = l.filter(([n]) => n.startsWith("Dark Harvest"));
    expect(dh).toHaveLength(1);
    // Contre un tank, la cible ne passe jamais sous 50 % avant la fin du combo : pas de proc.
    const tank = blueCombo([...CORE_BLUE], 14, TARGETS.mid.tank, { hubrisStacks: 4, runes: { darkHarvest: { souls: 10 } } }).log;
    expect(tank.filter(([n]) => n.startsWith("Dark Harvest"))).toHaveLength(0);
  });

  it("Conqueror : 12 stacks × (1,8 → 4) × 0,6 = 12,96 AD au niveau 1, 28,8 au niveau 18", () => {
    expect(conquerorAd(1)).toBeCloseTo(12.96, 10);
    expect(conquerorAd(18)).toBeCloseTo(28.8, 10);
  });

  it("Conqueror : soin de 8 % des dégâts infligés", () => {
    const r = redFight(["voltaic", "cleaver", "steelcaps"], 14, TARGETS.mid.tank, { runes: { conqueror: true } });
    expect(r.heals.conqueror).toBe(Math.round(0.08 * r.total));
  });
});
