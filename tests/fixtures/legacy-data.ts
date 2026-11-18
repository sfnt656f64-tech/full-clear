// Données figées de la première version (kayn-simulator.html, patch 26.22).
// Elles servent uniquement au test de non-régression du modèle et du moteur :
// le site, lui, utilise les données Data Dragon (src/data/generated/).
import type { Champion, ItemTable } from "../../src/data/types";
import legacyChampions from "./legacy-champions.json";

export const LEGACY_ITEMS: ItemTable = {
  voltaic: { n: "Voltaic Cyclosword", s: "VC", ad: 55, leth: 10, ah: 10, cost: 3000, flags: ["volt"] },
  hubris: { n: "Hubris", s: "HB", ad: 55, leth: 18, ah: 10, cost: 2800, flags: ["hubris"] },
  axiom: { n: "Axiom Arc", s: "AX", ad: 55, leth: 18, ah: 20, cost: 2750, flags: ["axiom"] },
  edge: { n: "Edge of Night", s: "EN", ad: 50, leth: 15, hp: 250, cost: 3000 },
  serylda: { n: "Serylda's Grudge", s: "SG", ad: 45, pen: 35, ah: 15, cost: 3000 },
  serpent: { n: "Serpent's Fang", s: "SF", ad: 55, leth: 15, cost: 2500, flags: ["serpent"] },
  youmuu: { n: "Youmuu's Ghostblade", s: "YG", ad: 55, leth: 18, cost: 2800 },
  bastion: { n: "Bastionbreaker", s: "BB", ad: 55, leth: 18, ah: 15, cost: 3000 },
  profane: { n: "Profane Hydra", s: "PH", ad: 55, leth: 18, ah: 10, cost: 2850 },
  cleaver: { n: "Black Cleaver", s: "BC", ad: 45, hp: 400, ah: 20, cost: 3000, shred: 30 },
  dd: { n: "Death's Dance", s: "DD", ad: 60, armor: 50, ah: 15, cost: 3300, flags: ["dd"] },
  sterak: { n: "Sterak's Gage", s: "ST", hp: 400, cost: 3200, flags: ["sterak"] },
  ga: { n: "Guardian Angel", s: "GA", ad: 55, armor: 45, cost: 3200, approx: true },
  chempunk: { n: "Chempunk Chainsword", s: "CC", ad: 45, hp: 450, ah: 15, cost: 3000 },
  lucidity: { n: "Ionian Boots of Lucidity", s: "IL", ah: 10, cost: 900, boots: true, approx: true },
  steelcaps: { n: "Plated Steelcaps", s: "PS", armor: 25, cost: 1200, boots: true, approx: true },
  mercury: { n: "Mercury's Treads", s: "MT", mr: 25, cost: 1250, boots: true, approx: true },
  swiftness: { n: "Boots of Swiftness", s: "SW", cost: 1000, boots: true, approx: true },
};

export const LEGACY_CHAMPIONS = legacyChampions as Champion[];
const byName = new Map(LEGACY_CHAMPIONS.map((c) => [c.name, c]));
export const legacyChamp = (name: string): Champion => {
  const c = byName.get(name);
  if (!c) throw new Error(`Champion inconnu (données d'origine) : ${name}`);
  return c;
};
