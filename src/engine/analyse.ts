import type { Champion, Form, Profile } from "../data/types";

export interface Analysis {
  E: Champion[];
  A: Champion[];
  melee: number;
  ranged: number;
  /** Cibles fragiles : tireurs, mages, enchanteurs, assassins. */
  squ: number;
  tanks: number;
  fight: number;
  /** Nombre de champions à dégâts physiques (mixte = 0,5). */
  ad: number;
  ap: number;
  adShare: number;
  apShare: number;
  /** Somme des niveaux de CC. */
  cc: number;
  /** Champions à gros CC (niveau 3). */
  hard: number;
  /** Sources de boucliers (1 pour enchanteur/tank/mage, 0,5 sinon). */
  shields: number;
  heals: number;
  slows: number;
  /** Auto-attaqueurs : tireurs et combattants physiques. */
  aa: number;
  allyFront: number;
  allyCarry: number;
  allyAD: number;
  /** Score de forme : > 0 bleu, < 0 rouge. */
  sc: number;
  why: string[];
  form: Form | "either";
}

const is = (c: Champion, ...p: Profile[]) => p.includes(c.profile);
const adWeight = (c: Champion) => (c.damage === "physical" ? 1 : c.damage === "mixed" ? 0.5 : 0);

export function analyse(enemies: (Champion | null)[], allies: (Champion | null)[]): Analysis {
  const E = enemies.filter((c): c is Champion => !!c), A = allies.filter((c): c is Champion => !!c);
  const n = E.length || 1;
  const melee = E.filter((c) => c.range === "melee").length, ranged = E.length - melee;
  const squ = E.filter((c) => is(c, "marksman", "mage", "enchanter", "assassin")).length;
  const tanks = E.filter((c) => is(c, "tank")).length, fight = E.filter((c) => is(c, "fighter")).length;
  const ad = E.reduce((s, c) => s + adWeight(c), 0), ap = E.length - ad;
  const cc = E.reduce((s, c) => s + c.cc, 0), hard = E.filter((c) => c.cc >= 3).length;
  const solidShield = (c: Champion) => is(c, "enchanter", "tank", "mage");
  const shields = E.filter((c) => c.shields && solidShield(c)).length + E.filter((c) => c.shields && !solidShield(c)).length * 0.5;
  const heals = E.filter((c) => c.heals).length, slows = E.filter((c) => c.slows).length;
  const aa = E.filter((c) => is(c, "marksman") || (is(c, "fighter") && c.damage === "physical")).length;
  const allyFront = A.filter((c) => is(c, "tank", "fighter")).length;
  const allyCarry = A.filter((c) => is(c, "marksman", "mage", "assassin")).length;
  const allyAD = A.reduce((s, c) => s + adWeight(c), 0);

  let sc = 0;
  const why: string[] = [];
  sc += squ * 1 - tanks * 1.4 - fight * 0.6;
  why.push(`${squ} cible(s) fragile(s) vs ${tanks} tank(s) et ${fight} combattant(s) en face`);
  sc += (ranged - melee) * 0.35;
  why.push(`${melee} mêlée (orbes rouges) / ${ranged} distance (orbes bleus)`);
  if (A.length) {
    if (allyFront === 0) { sc -= 1.5; why.push("aucune frontline dans ton équipe → Rhaast tient ce rôle"); }
    else if (allyFront >= 3) { sc += 0.8; why.push(`${allyFront} frontlines alliées → tu peux jouer l'assassin`); }
    if (allyCarry <= 1) { sc += 0.6; why.push("peu de dégâts alliés → l'équipe a besoin de ton burst"); }
  }
  const form = sc >= 0.5 ? "blue" : sc <= -0.5 ? "red" : "either";
  return { E, A, melee, ranged, squ, tanks, fight, ad, ap, adShare: ad / n, apShare: ap / n, cc, hard, shields, heals, slows, aa, allyFront, allyCarry, allyAD, sc, why, form };
}

/** Forme retenue : choix forcé, sinon recommandation (égalité → signe du score). */
export function resolveForm(x: Analysis, choice: Form | "auto"): Form {
  if (choice !== "auto") return choice;
  if (x.form === "either") return x.sc >= 0 ? "blue" : "red";
  return x.form;
}
