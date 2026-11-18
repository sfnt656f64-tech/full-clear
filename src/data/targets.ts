import type { Profile, Stage, Target, TargetKey } from "./types";

/** Profils types de cibles pour le simulateur (estimations, non vérifiées). */
export const TARGETS: Record<Stage, Record<TargetKey, Target>> = {
  mid: {
    adc: { n: "ADC", hp: 1900, armor: 75, mr: 45 },
    mage: { n: "Mage", hp: 1950, armor: 85, mr: 45 },
    shield: { n: "ADC + bouclier 350", hp: 1900, armor: 75, mr: 45, shield: 350 },
    bruiser: { n: "Bruiser", hp: 3200, armor: 140, mr: 70 },
    tank: { n: "Tank", hp: 4200, armor: 220, mr: 90 },
  },
  late: {
    adc: { n: "ADC", hp: 2600, armor: 100, mr: 55 },
    mage: { n: "Mage", hp: 2700, armor: 120, mr: 55 },
    shield: { n: "ADC + bouclier 550", hp: 2600, armor: 100, mr: 55, shield: 550 },
    bruiser: { n: "Bruiser", hp: 4200, armor: 190, mr: 90 },
    tank: { n: "Tank", hp: 5600, armor: 300, mr: 120 },
  },
};

/** PV, armure, RM moyens par profil de champion (utilisés par le moteur de draft). */
export const PROFILE_STATS: Record<Stage, Record<Profile, [hp: number, armor: number, mr: number]>> = {
  mid: {
    marksman: [1900, 75, 45], mage: [1950, 85, 45], enchanter: [1800, 80, 45],
    assassin: [2100, 85, 50], fighter: [3200, 140, 70], tank: [4200, 220, 90],
  },
  late: {
    marksman: [2600, 100, 55], mage: [2700, 120, 55], enchanter: [2300, 105, 55],
    assassin: [2800, 115, 60], fighter: [4200, 190, 90], tank: [5600, 300, 120],
  },
};

/** Niveau de Kayn pour chaque moment de la partie. */
export const STAGE_LEVEL: Record<Stage, number> = { mid: 13, late: 18 };
