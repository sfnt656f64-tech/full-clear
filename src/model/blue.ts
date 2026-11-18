import type { ItemKey, Target } from "../data/types";
import { KAYN, RULES, RUNES_DATA } from "./constants";
import { physMult, stats, type KaynStats, type StatOptions } from "./stats";

export interface BlueResult {
  s: KaynStats;
  /** Dégâts totaux du combo (y compris ceux absorbés par un bouclier). */
  total: number;
  /** % des PV de la cible retirés (au-delà de 100 = surplus). */
  pct: number;
  kill: boolean;
  /** [nom de l'étape, dégâts arrondis]. */
  log: [string, number][];
  ehp: number;
}

/** Bonus de dégâts magiques du passif Shadow Assassin (20 % → 40 %). */
export const bluePassivePct = (lvl: number): number =>
  KAYN.passiveBlue.lvl1 + (KAYN.passiveBlue.lvl18 - KAYN.passiveBlue.lvl1) * (lvl - 1) / 17;

/**
 * Combo bleu en burst (passif actif) : W › Q (2 coups) › AA › R › AA.
 * - Voltaic se déclenche sur le W (Galvanize) et donne sa létalité au reste du combo.
 * - Bastionbreaker ajoute des dégâts bruts à la première instance de dégâts d'un sort (le W).
 * - Dark Harvest se déclenche sur le premier coup porté à une cible déjà sous 50 % de ses PV max.
 * - Le passif Shadow Assassin s'ajoute aux dégâts physiques (pas aux dégâts bruts).
 */
export function blueCombo(build: readonly ItemKey[], lvl: number, tgt: Target, opt: StatOptions = {}): BlueResult {
  const rules = opt.rules ?? RULES;
  const s = stats(build, lvl, opt);
  const r = s.r, b = s.bonusAD;
  const passivePct = bluePassivePct(lvl);
  const mrMult = 100 / (100 + tgt.mr);
  let hp = tgt.hp, shield = tgt.shield ?? 0;
  if (s.flags.serpent && shield > 0) shield *= 1 - rules.serpentShieldReduction;
  const log: [string, number][] = [];
  let total = 0;
  const firmLeth = s.flags.volt ? rules.voltaic.lethality : 0;
  let voltReady = !!s.flags.volt, firmOn = false;
  let bastionReady = !!(s.flags.bastion && rules.bastion);
  const dh = opt.runes?.darkHarvest;
  let dhReady = !!dh;

  const apply = (name: string, d: number) => {
    let dealt = d;
    const abs = Math.min(shield, dealt);
    shield -= abs; dealt -= abs; hp -= dealt;
    total += d;
    log.push([name, Math.round(d)]);
  };
  const physical = (raw: number) => {
    const d = raw * physMult(s, tgt.armor, 0, firmOn ? firmLeth : 0);
    return d + d * passivePct * mrMult; // passif Shadow Assassin
  };
  const darkHarvest = () => {
    if (!dhReady || !dh || hp > RUNES_DATA.darkHarvest.threshold * tgt.hp) return;
    dhReady = false;
    const h = RUNES_DATA.darkHarvest;
    apply(`Dark Harvest (${dh.souls} âmes)`, physical(h.base + h.perSoul * dh.souls + h.bonusAd * b));
  };
  const hit = (name: string, raw: number, ability: boolean) => {
    darkHarvest(); // la cible doit déjà être sous 50 % au moment du coup
    apply(name, physical(raw));
    if (ability && bastionReady && rules.bastion) {
      bastionReady = false;
      apply("Bastionbreaker (bruts)", rules.bastion.base + rules.bastion.perLethality * s.leth);
    }
  };
  const volt = () => {
    if (!voltReady) return;
    voltReady = false; firmOn = true;
    hit(`Voltaic (${Math.round(rules.voltaic.currentHp * 100)}% PV act.)`, rules.voltaic.currentHp * Math.max(hp, 0), false);
  };

  if (r.W) { hit("W", KAYN.w.base[r.W] + KAYN.w.bonusAd * b, true); volt(); }
  if (r.Q) { const q = KAYN.qBlue.base[r.Q] + KAYN.qBlue.bonusAd * b; hit("Q (1)", q, true); hit("Q (2)", q, true); }
  hit("AA", s.totalAD, false);
  if (r.R) hit("R", KAYN.rBlue.base[r.R] + KAYN.rBlue.bonusAd * b, true);
  hit("AA", s.totalAD, false);

  return {
    s,
    total: Math.round(total),
    pct: Math.round((1000 * (tgt.hp - hp)) / tgt.hp) / 10,
    kill: hp <= 0,
    log,
    ehp: tgt.hp + (tgt.shield ?? 0),
  };
}

/** % du CD total du R remboursé par Axiom Arc à chaque takedown (10 % + 0,25 % par point de létalité). */
export function axiomRefundPct(build: readonly ItemKey[], lvl: number, opt: StatOptions = {}): number {
  const rules = opt.rules ?? RULES;
  const s = stats(build, lvl, opt);
  return s.flags.axiom ? rules.axiom.base + rules.axiom.perLethality * s.leth : 0;
}
