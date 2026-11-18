// Toutes les valeurs de jeu utilisées par le modèle.
// Sources (vérifiées le 18/11/2026, patch 26.23) :
//   KAYN_BASE  : Data Dragon, croissance d'AD corrigée par le wiki (overrides.json)
//   KAYN       : https://wiki.leagueoflegends.com/en-us/Kayn (Template:Data Kayn/*)
//   RULES      : https://wiki.leagueoflegends.com/en-us/Module:ItemData/data (items),
//                Template:Rune data Dark Harvest / Conqueror (runes), page « Rune » (fragments)
// Les HYPOTHÈSES de modélisation (pas des valeurs de jeu) sont dans RED_FIGHT et signalées comme telles.
import { KAYN_DD_STATS as S } from "../data/kayn";

/** % → fraction, sans résidu flottant (2,7 → 0,027 et non 0,027000000000000003). */
const frac = (pct: number) => Number((pct / 100).toPrecision(12));

/** Stats de base de Kayn : Data Dragon (corrigé par overrides.json), niveau 1 + croissance. */
export const KAYN_BASE = {
  ad: S.attackdamage, adGrowth: S.attackdamageperlevel,
  hp: S.hp, hpGrowth: S.hpperlevel,
  armor: S.armor, armorGrowth: S.armorperlevel,
  mr: S.spellblock, mrGrowth: S.spellblockperlevel,
  attackSpeed: S.attackspeed, attackSpeedGrowth: frac(S.attackspeedperlevel),
} as const;

/** 2 fragments adaptatifs : 2 × 9 force adaptative × 0,6 = +10,8 AD (wiki, page « Rune »). */
export const ADAPTIVE_SHARDS_AD = 10.8;
/** Fragment de PV évolutifs : 10 PV bonus par niveau (wiki, page « Rune »). */
export const HEALTH_SHARD_PER_LEVEL = 10;
/** 1 point de force adaptative = 0,6 AD bonus (wiki, Template:Adaptive). */
export const ADAPTIVE_TO_AD = 0.6;

/** Ordre des sorts Q › W › E, R aux niveaux 6/11/16 (un caractère par niveau). */
export const SKILL_ORDER = "QWEQQRQWQWRWWEERE E".replace(/ /g, "");

/** Ratios de Kayn, tous vérifiés sur le wiki. Index = rang du sort (0 = pas encore appris). */
export const KAYN = {
  w: { base: [0, 85, 130, 175, 220, 265], bonusAd: 1.1, cd: [0, 13, 12, 11, 10, 9] },
  qBlue: { base: [0, 75, 105, 135, 165, 195], bonusAd: 0.85 },
  rBlue: { base: [0, 150, 250, 350], bonusAd: 1.5 },
  /** Passif Shadow Assassin : dégâts magiques bonus, de 20 % (niv. 1) à 40 % (niv. 18). */
  passiveBlue: { lvl1: 0.2, lvl18: 0.4 },
  /** Q rouge, 2 coups : 2 × 65 % AD total + 2 × (6 % + 3,5 % / 100 AD bonus) PV max. */
  qRed: { totalAd: 1.3, maxHp: 0.12, maxHpPer100Bonus: 0.07, cd: [0, 7, 6.5, 6, 5.5, 5] },
  /** R rouge : 15 % + 10 % / 100 AD bonus des PV max. */
  rRed: { maxHp: 0.15, maxHpPer100Bonus: 0.1 },
  /** Soin du passif Rhaast : 25 % des dégâts des sorts + 0,5 % par 100 PV bonus. */
  healRed: { base: 0.25, per100BonusHp: 0.005 },
  /** Soin du R rouge en % des PV max de la cible. */
  healRRed: { maxHp: 0.1125, maxHpPer100Bonus: 0.075 },
} as const;

/**
 * Effets d'items et règles du modèle (valeurs mêlée, celles qui s'appliquent à Kayn).
 * Un jeu de règles peut être passé au modèle (option `rules`) : le test de non-régression
 * utilise celui de la première version (tests/fixtures/legacy-data.ts).
 */
export interface Rules {
  /** Hubris (Eminence) : AD bonus de base + par stack. */
  hubris: { base: number; perStack: number };
  /** Sterak (The Claws that Catch) : AD bonus = 50 % de l'AD de base. */
  sterakBaseAd: number;
  /** Voltaic (Firmament) : % des PV actuels en dégâts physiques bonus, létalité pendant 4 s. */
  voltaic: { currentHp: number; lethality: number };
  /** Serpent's Fang (Shield Reaver) : réduction des boucliers. */
  serpentShieldReduction: number;
  /**
   * Death's Dance (Ignore Pain) : part des dégâts différés ; `magic` = s'applique aussi aux dégâts magiques.
   * `cleansed` est une HYPOTHÈSE : part des dégâts différés purgée par Defy (kill pendant le combat).
   */
  deathsDance: { deferred: number; cleansed: number; magic: boolean };
  /** Bastionbreaker (Shaped Charge) : dégâts bruts bonus sur la prochaine instance de dégâts d'un sort. Null = non modélisé. */
  bastion: { base: number; perLethality: number } | null;
  /** Axiom Arc (Flux) : % du CD total du R remboursé par takedown. */
  axiom: { base: number; perLethality: number };
  /** Fragment de PV évolutifs appliqué. */
  healthShard: boolean;
}

export const RULES: Rules = {
  hubris: { base: 15, perStack: 3 },
  sterakBaseAd: 0.5,
  voltaic: { currentHp: 0.08, lethality: 15 },
  serpentShieldReduction: 0.5,
  deathsDance: { deferred: 0.3, cleansed: 0.5, magic: true },
  bastion: { base: 40, perLethality: 1.5 },
  axiom: { base: 10, perLethality: 0.25 },
  healthShard: true,
};

/** Runes clés (wiki, Template:Rune data …). */
export const RUNES_DATA = {
  /**
   * Dark Harvest : dégâts adaptatifs bonus (physiques pour Kayn) contre une cible sous 50 % de ses PV max :
   * 30 + 11 par âme + 10 % de l'AD bonus. Une fois par 35 s.
   */
  darkHarvest: { base: 30, perSoul: 11, bonusAd: 0.1, threshold: 0.5 },
  /**
   * Conqueror (mêlée) : 12 stacks max, 1,8 → 4 de force adaptative par stack selon le niveau (× 0,6 = AD bonus),
   * soin de 8 % des dégâts après réduction infligés aux champions à 12 stacks.
   */
  conqueror: { maxStacks: 12, perStackLvl1: 1.8, perStackLvl18: 4, heal: 0.08 },
} as const;

/** Hypothèses du combat rouge de 6 s (choix de modélisation, pas des valeurs de jeu). */
export const RED_FIGHT = {
  duration: 6,
  /** Part du temps passée à auto-attaquer (le reste en sorts / dashs). */
  autoAttackUptime: 0.65,
  /** Procs de Voltaic pendant le combat. */
  voltaicProcs: 2,
  /** Procs de Bastionbreaker pendant le combat (minimum certain : le premier sort). */
  bastionProcs: 1,
  /** PV actuels moyens de la cible lors des procs de Voltaic (en % des PV max). */
  voltaicAvgHp: 0.6,
} as const;
