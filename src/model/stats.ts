import { ITEMS } from "../data/items";
import type { ItemFlag, ItemKey } from "../data/types";
import { ADAPTIVE_SHARDS_AD, HEALTH_SHARD_PER_LEVEL, ITEM_EFFECTS, KAYN_BASE, SKILL_ORDER } from "./constants";

/** Croissance des stats de base de LoL : (L−1) × (0,7025 + 0,0175 × (L−1)). */
export const growth = (lvl: number): number => (lvl - 1) * (0.7025 + 0.0175 * (lvl - 1));

export interface Ranks { Q: number; W: number; E: number; R: number }

/** Rangs des sorts au niveau donné (Q max, W ensuite, R à 6/11/16). */
export function ranks(lvl: number): Ranks {
  const r: Ranks = { Q: 0, W: 0, E: 0, R: 0 };
  for (let i = 0; i < lvl; i++) r[SKILL_ORDER[i] as keyof Ranks]++;
  return r;
}

export interface StatOptions {
  /** Stacks de Hubris ; absent ou négatif = passif inactif. */
  hubrisStacks?: number;
  /** Fragment de PV évolutifs (jamais activé dans la page d'origine). */
  healthShard?: boolean;
}

export interface KaynStats {
  /** Somme des stats des items. */
  ad: number; leth: number; ah: number; hp: number; armor: number; mr: number; pen: number; shred: number; cost: number;
  flags: Partial<Record<ItemFlag, true>>;
  baseAD: number; bonusAD: number; totalAD: number;
  maxHP: number; armorT: number; mrT: number;
  /** Multiplicateur de temps de recharge : 100 / (100 + haste). */
  cdr: number;
  r: Ranks;
}

const SUMMED = ["ad", "leth", "ah", "hp", "armor", "mr", "pen", "shred", "cost"] as const;

export function stats(build: readonly ItemKey[], lvl: number, opt: StatOptions = {}): KaynStats {
  const sum = { ad: 0, leth: 0, ah: 0, hp: 0, armor: 0, mr: 0, pen: 0, shred: 0, cost: 0 };
  const flags: KaynStats["flags"] = {};
  for (const k of build) {
    const it = ITEMS[k];
    for (const f of SUMMED) sum[f] += it[f] ?? 0;
    for (const fl of it.flags ?? []) flags[fl] = true;
  }
  const g = growth(lvl);
  const baseAD = KAYN_BASE.ad + KAYN_BASE.adGrowth * g;
  let bonusAD = sum.ad + ADAPTIVE_SHARDS_AD;
  if (flags.sterak) bonusAD += ITEM_EFFECTS.sterakBaseAd * baseAD;
  if (flags.hubris && opt.hubrisStacks != null && opt.hubrisStacks >= 0)
    bonusAD += ITEM_EFFECTS.hubris.base + ITEM_EFFECTS.hubris.perStack * opt.hubrisStacks;
  return {
    ...sum,
    flags,
    baseAD,
    bonusAD,
    totalAD: baseAD + bonusAD,
    maxHP: KAYN_BASE.hp + KAYN_BASE.hpGrowth * g + sum.hp + (opt.healthShard ? HEALTH_SHARD_PER_LEVEL * lvl : 0),
    armorT: KAYN_BASE.armor + KAYN_BASE.armorGrowth * g + sum.armor,
    mrT: KAYN_BASE.mr + KAYN_BASE.mrGrowth * g + sum.mr,
    cdr: 100 / (100 + sum.ah),
    r: ranks(lvl),
  };
}

/**
 * Multiplicateur de dégâts physiques.
 * Armure effective = armure × (1 − réduction) × (1 − % pén) − létalité, plancher à 0.
 */
export function physMult(
  s: Pick<KaynStats, "pen" | "leth">,
  targetArmor: number,
  shredPct: number,
  extraLeth = 0,
): number {
  let a = targetArmor * (1 - shredPct / 100) * (1 - s.pen / 100) - (s.leth + extraLeth);
  a = Math.max(0, a);
  return 100 / (100 + a);
}
