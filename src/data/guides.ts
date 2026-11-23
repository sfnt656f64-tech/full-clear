import type { Form, ItemKey } from "./types";

export interface Guide {
  /** Titre (situation de la compo adverse). */
  t: string;
  /** Ordre de build : 5 items + bottes. */
  b: ItemKey[];
  /** Win rates cités (sources : Skill Capped, Mobalytics, LoLalytics). */
  wr?: string;
  /** Explication (HTML autorisé : <b>). */
  w: string;
}

export const GUIDES: Record<Form, Guide[]> = {
  blue: [
    { t: "Défaut — 2-3 squishies", b: ["voltaic", "hubris", "lucidity", "axiom", "serylda", "edge"], wr: "Core 52,5 % · Axiom 4ᵉ 55,1 %", w: "Snowball classique. <b>Axiom</b> rembourse 21,5 % du CD total du R à chaque takedown (10 % + 0,25 % par point de létalité, 46 létha avec Voltaic + Hubris) → R plus souvent en teamfight. Si tu es très ahead : <b>GA</b> en 6ᵉ (64 % WR en dernier item)." },
    { t: "Boucliers en face (Lulu, Janna, Karma, Seraphine, Sett…)", b: ["voltaic", "hubris", "lucidity", "serpent", "serylda", "edge"], w: "<b>Serpent's Fang</b> en 4ᵉ (ou 3ᵉ si 2+ shielders). Dans le simulateur, contre un ADC + bouclier, il rattrape presque Serylda pour 500 po de moins." },
    { t: "Frontline armurée mais assez de cibles pour le bleu", b: ["voltaic", "hubris", "lucidity", "serylda", "axiom", "edge"], wr: "Serylda 5ᵉ 57,9 %", w: "<b>Serylda</b> monte en 4ᵉ : c'est le meilleur 4ᵉ item du benchmark contre toutes les cibles, et l'écart grandit avec l'armure." },
    { t: "Beaucoup de CC ponctuels (Leona, Ashe, Lissandra, Morgana…)", b: ["voltaic", "edge", "lucidity", "hubris", "serylda", "ga"], wr: "EoN 4ᵉ 54,7 %", w: "<b>Edge of Night</b> en 2ᵉ : le bouclier anti-sort bloque le CC qui couperait ton engage. +250 PV." },
    { t: "Pas de kills / en retard", b: ["voltaic", "youmuu", "lucidity", "edge", "serylda", "ga"], w: "Ne pas acheter Hubris sans kills : son passif ne se déclenche pas. Youmuu (vitesse de déplacement) ou Axiom pour jouer les picks." },
    { t: "Tu domines mais n'arrives pas à fermer", b: ["voltaic", "hubris", "lucidity", "axiom", "serylda", "bastion"], w: "<b>Bastionbreaker</b> à la place du 6ᵉ item : pick le support / l'ADC, puis split une tour. Dégâts aux structures (non modélisés)." },
  ],
  red: [
    { t: "Défaut — bruisers / compo mixte", b: ["voltaic", "cleaver", "steelcaps", "dd", "sterak", "ga"], wr: "Core 53,2 % (Master)", w: "Rush Voltaic (le soin vient des dégâts) → Cleaver. Bottes de base jusqu'aux 2 items." },
    { t: "2+ tanks lourds", b: ["cleaver", "voltaic", "steelcaps", "serylda", "dd", "sterak"], w: "<b>Serylda + Cleaver</b> se multiplient (−30 % d'armure puis 35 % de pénétration). Benchmark : meilleur DPS contre un tank, +23 % par rapport à DD." },
    { t: "Gros dégâts physiques (assassins AD, ADC hypercarry)", b: ["voltaic", "cleaver", "steelcaps", "dd", "ga", "sterak"], w: "<b>Death's Dance</b> : +24 % de PV effectifs physiques par rapport à Sterak dans le simulateur (+45 % par rapport à un 4ᵉ item offensif), sans perdre beaucoup de DPS." },
    { t: "Gros dégâts magiques", b: ["voltaic", "cleaver", "mercury", "sterak", "dd", "ga"], w: "Mercury's Treads + Sterak (PV bruts et bouclier Lifeline, non modélisé, contre le burst). Dans le modèle, Death's Dance fait jeu égal en PV effectifs magiques, car il diffère aussi les dégâts magiques. Maw / Spirit Visage restent possibles mais ne sont pas modélisés." },
    { t: "Compo full squishy mais tu es déjà rouge", b: ["voltaic", "hubris", "steelcaps", "cleaver", "dd", "ga"], w: "Un 2ᵉ item léthalité (<b>Hubris/Axiom</b>) monte ton AD bonus, donc tes % de PV max. Dans le benchmark, Axiom fait plus de DPS que DD." },
  ],
};

/** Drafts d'exemple : [adversaires, alliés]. */
export const EXAMPLE_DRAFTS: Record<string, [string[], string[]]> = {
  "Mages + enchanteur": [["Gnar", "Viego", "Ahri", "Jinx", "Lulu"], ["Ornn", "Syndra", "Kai'Sa", "Nautilus"]],
  "Frontline lourde": [["Ornn", "Sejuani", "Galio", "Aphelios", "Braum"], ["Jax", "Orianna", "Ezreal", "Karma"]],
  "Bruisers AD": [["Darius", "Lee Sin", "Yone", "Draven", "Pyke"], ["Malphite", "Lux", "Caitlyn", "Leona"]],
  "Beaucoup de soins": [["Aatrox", "Warwick", "Vladimir", "Samira", "Soraka"], ["K'Sante", "Ahri", "Jhin", "Rell"]],
};

export interface RunePage {
  title: string;
  primary: [tree: string, runes: string];
  secondary: [tree: string, runes: string];
  shards: string;
  /** Remarque (HTML autorisé). */
  note: string;
}

export const RUNES: Record<Form, RunePage> = {
  blue: {
    title: "Runes (Assassin)",
    primary: ["Domination", "Dark Harvest · Sudden Impact · Grisly Mementos · Treasure Hunter"],
    secondary: ["Inspiration", "Cosmic Insight · Magical Footwear"],
    shards: "Adaptive Force ×2, Health Scaling",
    note: "Alternative à fort WR : Hail of Blades (53,5 % sur 2 446 parties, Mobalytics).",
  },
  red: {
    title: "Runes (Rhaast)",
    primary: ["Precision", "Conqueror · Triumph · Legend: Haste · Last Stand"],
    secondary: ["Sorcery", "Axiom Arcanist · Transcendence"],
    shards: "Adaptive Force ×2, Health Scaling",
    note: "Last Stand est clé : le soin de Rhaast dépend des dégâts infligés. En rouge, reste sur les bottes de base et rushe 2 items avant de les finir.",
  },
};
