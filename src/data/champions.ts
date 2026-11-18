import raw from "./champions.json";
import type { Champion, Profile } from "./types";

// Base reprise de kayn-simulator.html. À l'étape 2, les noms, tags et portées
// viendront de Data Dragon et le reste de src/data/overrides.json.
export const CHAMPIONS: Champion[] = raw as Champion[];

export const CHAMPIONS_BY_NAME: Record<string, Champion> = Object.fromEntries(CHAMPIONS.map((c) => [c.name, c]));

export const champ = (name: string): Champion => {
  const c = CHAMPIONS_BY_NAME[name];
  if (!c) throw new Error(`Champion inconnu : ${name}`);
  return c;
};

/** Libellés français des profils. */
export const PROFILE_LABEL: Record<Profile, string> = {
  tank: "Tank",
  fighter: "Combattant",
  assassin: "Assassin",
  mage: "Mage",
  marksman: "Tireur",
  enchanter: "Enchanteur",
};
