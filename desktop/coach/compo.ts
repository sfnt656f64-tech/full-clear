// Une seule classification des dégâts d'une compo adverse, la même partout (draft, build, objets selon la compo,
// analyse d'après-partie) : chaque champion compte 1 dans son type de dégâts, un champion mixte compte ½ de chaque.
// Surtout physique : au moins 65 % des dégâts ; surtout magique : 35 % au plus ; sinon mixte. Fonction pure.
import { champByKey } from "../../src/data/champions";
import type { Champion } from "../../src/data/types";

export type DamageProfile = "physical" | "magic" | "mixed";
export const PROFILE_FR: Record<DamageProfile, string> = { physical: "surtout physique", magic: "surtout magique", mixed: "mixte" };
export const PHYSICAL_SHARE = 0.65, MAGIC_SHARE = 0.35;

/** Part des dégâts physiques (0 à 1) ; 0,5 sans champion connu. */
export function physicalShare(champs: (Champion | null | undefined)[]): number {
  let p = 0, m = 0;
  for (const c of champs) {
    if (!c) continue;
    if (c.damage === "physical") p++;
    else if (c.damage === "magic") m++;
    else { p += 0.5; m += 0.5; }
  }
  return p + m ? p / (p + m) : 0.5;
}

export function damageProfile(champs: (Champion | null | undefined)[]): DamageProfile {
  const s = physicalShare(champs);
  return s >= PHYSICAL_SHARE ? "physical" : s <= MAGIC_SHARE ? "magic" : "mixed";
}

export const damageProfileOfKeys = (keys: number[]): DamageProfile => damageProfile(keys.map((k) => champByKey(k)));
