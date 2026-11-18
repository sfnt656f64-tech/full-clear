import type { ItemKey, Target } from "../data/types";
import { ITEM_EFFECTS, KAYN, KAYN_BASE, RED_FIGHT } from "./constants";
import { physMult, stats, type KaynStats, type StatOptions } from "./stats";

export interface RedOptions extends StatOptions {
  /** Durée du combat en secondes (6 par défaut). */
  T?: number;
}

export interface RedResult {
  s: KaynStats;
  total: number;
  dps: number;
  /** Dégâts en % des PV max de la cible. */
  pct: number;
  heal: number;
  ehpPhys: number;
  ehpMag: number;
  parts: { Q: number; W: number; R: number; AA: number; Voltaic: number };
  nQ: number;
  nW: number;
  nAA: number;
}

/** Combat soutenu de Rhaast (6 s par défaut), Black Cleaver à 5 stacks. */
export function redFight(build: readonly ItemKey[], lvl: number, tgt: Target, opt: RedOptions = {}): RedResult {
  const s = stats(build, lvl, opt);
  const T = opt.T || RED_FIGHT.duration;
  const r = s.r, b = s.bonusAD, m = physMult(s, tgt.armor, s.shred);
  const qCD = KAYN.qRed.cd[r.Q] * s.cdr, wCD = KAYN.w.cd[r.W] * s.cdr;
  const nQ = r.Q ? 1 + Math.floor(T / qCD) : 0, nW = r.W ? 1 + Math.floor(T / wCD) : 0;
  const qDmg = (KAYN.qRed.totalAd * s.totalAD + (KAYN.qRed.maxHp + KAYN.qRed.maxHpPer100Bonus * b / 100) * tgt.hp) * m;
  const wDmg = r.W ? (KAYN.w.base[r.W] + KAYN.w.bonusAd * b) * m : 0;
  const rDmg = r.R ? (KAYN.rRed.maxHp + KAYN.rRed.maxHpPer100Bonus * b / 100) * tgt.hp * m : 0;
  const as = KAYN_BASE.attackSpeed * (1 + KAYN_BASE.attackSpeedGrowth * (lvl - 1));
  const nAA = Math.max(0, Math.floor(as * T * RED_FIGHT.autoAttackUptime));
  const aaDmg = s.totalAD * m;
  const voltProcs = s.flags.volt ? RED_FIGHT.voltaicProcs : 0;
  const voltDmg = voltProcs * ITEM_EFFECTS.voltaic.currentHp * RED_FIGHT.voltaicAvgHp * tgt.hp * m;
  const abil = nQ * qDmg + nW * wDmg + rDmg;
  const total = abil + nAA * aaDmg + voltDmg;
  const healPct = KAYN.healRed.base + KAYN.healRed.per100BonusHp * s.hp / 100;
  const heal = healPct * abil + (r.R ? (KAYN.healRRed.maxHp + KAYN.healRRed.maxHpPer100Bonus * b / 100) * tgt.hp : 0);
  const dd = ITEM_EFFECTS.deathsDance;
  const ehpPhys = s.maxHP * (1 + s.armorT / 100) * (s.flags.dd ? 1 / (1 - dd.deferred * dd.cleansed) : 1);
  const ehpMag = s.maxHP * (1 + s.mrT / 100);
  return {
    s,
    total: Math.round(total),
    dps: Math.round(total / T),
    pct: Math.round((1000 * total) / tgt.hp) / 10,
    heal: Math.round(heal),
    ehpPhys: Math.round(ehpPhys),
    ehpMag: Math.round(ehpMag),
    parts: { Q: Math.round(nQ * qDmg), W: Math.round(nW * wDmg), R: Math.round(rDmg), AA: Math.round(nAA * aaDmg), Voltaic: Math.round(voltDmg) },
    nQ, nW, nAA,
  };
}
