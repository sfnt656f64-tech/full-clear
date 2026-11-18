// Toutes les valeurs de jeu utilisées par le modèle, regroupées ici pour être
// vérifiées à l'étape 4 (wiki officiel + Data Dragon).
// Valeurs reprises telles quelles de kayn-simulator.html : AUCUNE n'est vérifiée pour l'instant.

/** Stats de base de Kayn : valeur au niveau 1 et croissance par niveau. */
export const KAYN_BASE = {
  ad: 68, adGrowth: 3.3,
  hp: 655, hpGrowth: 103,
  armor: 38, armorGrowth: 4.5,
  mr: 32, mrGrowth: 2.05,
  attackSpeed: 0.669, attackSpeedGrowth: 0.027,
} as const;

/** 2 fragments adaptatifs = +10,8 AD. */
export const ADAPTIVE_SHARDS_AD = 10.8;
/** Fragment de PV évolutifs : 10 PV par niveau. */
export const HEALTH_SHARD_PER_LEVEL = 10;

/** Ordre des sorts Q › W › E, R aux niveaux 6/11/16 (un caractère par niveau). */
export const SKILL_ORDER = "QWEQQRQWQWRWWEERE E".replace(/ /g, "");

/** Index = rang du sort (0 = pas encore appris). */
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

export const ITEM_EFFECTS = {
  /** Hubris : 15 AD + 3 par stack. */
  hubris: { base: 15, perStack: 3 },
  /** Sterak : +50 % de l'AD de base. */
  sterakBaseAd: 0.5,
  /** Voltaic (Firmament) : 9 % des PV actuels, +15 létalité pendant 4 s. */
  voltaic: { currentHp: 0.09, lethality: 15 },
  /** Serpent's Fang : réduction des boucliers (≈ 50 % en mêlée, non vérifié). */
  serpentShieldReduction: 0.5,
  /** Death's Dance : 35 % des dégâts différés, dont ~moitié purgée. */
  deathsDance: { deferred: 0.35, cleansed: 0.5 },
} as const;

/** Hypothèses du combat rouge de 6 s. */
export const RED_FIGHT = {
  duration: 6,
  /** Part du temps passée à auto-attaquer (le reste en sorts / dashs). */
  autoAttackUptime: 0.65,
  voltaicProcs: 2,
  /** PV actuels moyens de la cible lors des procs de Voltaic (en % des PV max). */
  voltaicAvgHp: 0.6,
} as const;
