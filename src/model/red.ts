import type { ItemKey, Target } from "../data/types";
import { KAYN, KAYN_BASE, RED_FIGHT, RULES, RUNES_DATA } from "./constants";
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
  parts: { Q: number; W: number; R: number; AA: number; Voltaic: number; Bastionbreaker?: number };
  /** Détail des soins. */
  heals: { passive: number; R: number; conqueror: number };
  nQ: number;
  nW: number;
  nAA: number;
}

/**
 * Combat soutenu de Rhaast (6 s par défaut), Black Cleaver à 5 stacks.
 * Conqueror (option) : 12 stacks pendant tout le combat, ce qui majore un peu les dégâts et les soins.
 */
export function redFight(build: readonly ItemKey[], lvl: number, tgt: Target, opt: RedOptions = {}): RedResult {
  const rules = opt.rules ?? RULES;
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
  const voltDmg = voltProcs * rules.voltaic.currentHp * RED_FIGHT.voltaicAvgHp * tgt.hp * m;
  const bastionDmg = s.flags.bastion && rules.bastion && (r.Q || r.W)
    ? RED_FIGHT.bastionProcs * (rules.bastion.base + rules.bastion.perLethality * s.leth) : 0; // dégâts bruts
  const abil = nQ * qDmg + nW * wDmg + rDmg;
  const total = abil + nAA * aaDmg + voltDmg + bastionDmg;
  // Passif Rhaast : % des dégâts physiques des sorts (après réduction) ; R : % des PV max de la cible.
  const healPct = KAYN.healRed.base + KAYN.healRed.per100BonusHp * s.bonusHP / 100;
  const healPassive = healPct * abil;
  const healR = r.R ? (KAYN.healRRed.maxHp + KAYN.healRRed.maxHpPer100Bonus * b / 100) * tgt.hp : 0;
  const healConq = opt.runes?.conqueror ? RUNES_DATA.conqueror.heal * total : 0;
  const heal = healPassive + healR + healConq;
  const dd = rules.deathsDance;
  const ddMult = s.flags.dd ? 1 / (1 - dd.deferred * dd.cleansed) : 1;
  const ehpPhys = s.maxHP * (1 + s.armorT / 100) * ddMult;
  const ehpMag = s.maxHP * (1 + s.mrT / 100) * (dd.magic ? ddMult : 1);
  return {
    s,
    total: Math.round(total),
    dps: Math.round(total / T),
    pct: Math.round((1000 * total) / tgt.hp) / 10,
    heal: Math.round(heal),
    ehpPhys: Math.round(ehpPhys),
    ehpMag: Math.round(ehpMag),
    parts: {
      Q: Math.round(nQ * qDmg), W: Math.round(nW * wDmg), R: Math.round(rDmg), AA: Math.round(nAA * aaDmg), Voltaic: Math.round(voltDmg),
      ...(bastionDmg ? { Bastionbreaker: Math.round(bastionDmg) } : {}),
    },
    heals: { passive: Math.round(healPassive), R: Math.round(healR), conqueror: Math.round(healConq) },
    nQ, nW, nAA,
  };
}
