import type { ItemKey, Target } from "../data/types";
import { ITEM_EFFECTS, KAYN } from "./constants";
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
 * Voltaic se déclenche sur le W et donne +15 létalité au reste du combo.
 */
export function blueCombo(build: readonly ItemKey[], lvl: number, tgt: Target, opt: StatOptions = {}): BlueResult {
  const s = stats(build, lvl, opt);
  const r = s.r, b = s.bonusAD;
  const passivePct = bluePassivePct(lvl);
  const mrMult = 100 / (100 + tgt.mr);
  let hp = tgt.hp, shield = tgt.shield ?? 0;
  if (s.flags.serpent && shield > 0) shield *= ITEM_EFFECTS.serpentShieldReduction;
  const log: [string, number][] = [];
  let total = 0;
  const firmLeth = s.flags.volt ? ITEM_EFFECTS.voltaic.lethality : 0;
  let voltReady = !!s.flags.volt, firmOn = false;

  const hit = (name: string, raw: number, kind: "phys" | "magic" = "phys") => {
    let d = kind === "phys" ? raw * physMult(s, tgt.armor, 0, firmOn ? firmLeth : 0) : raw * mrMult;
    d += kind === "phys" ? d * passivePct * mrMult : 0; // passif Shadow Assassin
    let dealt = d;
    const abs = Math.min(shield, dealt);
    shield -= abs; dealt -= abs; hp -= dealt;
    total += d;
    log.push([name, Math.round(d)]);
  };
  const volt = () => {
    if (!voltReady) return;
    voltReady = false; firmOn = true;
    hit("Voltaic (9% PV act.)", ITEM_EFFECTS.voltaic.currentHp * Math.max(hp, 0));
  };

  if (r.W) { hit("W", KAYN.w.base[r.W] + KAYN.w.bonusAd * b); volt(); }
  if (r.Q) { const q = KAYN.qBlue.base[r.Q] + KAYN.qBlue.bonusAd * b; hit("Q (1)", q); hit("Q (2)", q); }
  hit("AA", s.totalAD);
  if (r.R) hit("R", KAYN.rBlue.base[r.R] + KAYN.rBlue.bonusAd * b);
  hit("AA", s.totalAD);

  return {
    s,
    total: Math.round(total),
    pct: Math.round((1000 * (tgt.hp - hp)) / tgt.hp) / 10,
    kill: hp <= 0,
    log,
    ehp: tgt.hp + (tgt.shield ?? 0),
  };
}
