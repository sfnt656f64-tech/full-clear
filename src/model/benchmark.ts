import { ITEMS } from "../data/items";
import { TARGETS } from "../data/targets";
import type { ItemKey, ItemTable, TargetKey } from "../data/types";
import { blueCombo } from "./blue";
import { redFight } from "./red";
import type { StatOptions } from "./stats";

export const BENCH_LEVEL = 14;

export const BENCH_BLUE = {
  base: ["voltaic", "hubris", "lucidity"] as ItemKey[],
  candidates: ["axiom", "serylda", "edge", "serpent", "youmuu", "bastion", "profane"] as ItemKey[],
  targets: ["adc", "shield", "bruiser", "tank"] as TargetKey[],
  hubrisStacks: 4,
};

export const BENCH_RED = {
  base: ["voltaic", "cleaver", "steelcaps"] as ItemKey[],
  candidates: ["dd", "sterak", "serylda", "hubris", "axiom", "edge", "ga"] as ItemKey[],
  columns: ["DPS vs tank", "DPS vs bruiser", "Soin 6 s (tank)", "PV eff. phys", "PV eff. mag"],
};

export interface BenchRow { k: ItemKey; v: number[] }

/** % de PV retirés par le combo bleu, pour chaque 4ᵉ item et chaque cible (mi-partie). */
export function benchBlue(opt: StatOptions = {}): BenchRow[] {
  const { base, candidates, targets, hubrisStacks } = BENCH_BLUE;
  return candidates.map((k) => ({
    k,
    v: targets.map((t) => blueCombo([...base, k], BENCH_LEVEL, TARGETS.mid[t], { ...opt, hubrisStacks }).pct),
  }));
}

/** DPS, soins et PV effectifs de Rhaast pour chaque 4ᵉ item (mi-partie). */
export function benchRed(opt: StatOptions = {}): BenchRow[] {
  const { base, candidates } = BENCH_RED;
  return candidates.map((k) => {
    const t = redFight([...base, k], BENCH_LEVEL, TARGETS.mid.tank, opt);
    const b = redFight([...base, k], BENCH_LEVEL, TARGETS.mid.bruiser, opt);
    return { k, v: [t.dps, b.dps, t.heal, t.ehpPhys, t.ehpMag] };
  });
}

/** Meilleure valeur de chaque colonne. */
export const bestPerColumn = (rows: BenchRow[]): number[] =>
  rows[0].v.map((_, i) => Math.max(...rows.map((r) => r.v[i])));

/** Prix d'une unité de stat, d'après les composants de base. */
export const STAT_GOLD = { ad: 35, leth: 30, ah: 50, hp: 2.67, armor: 20, mr: 18 } as const;

export const GOLD_ITEMS: ItemKey[] = ["voltaic", "hubris", "axiom", "edge", "serylda", "serpent", "youmuu", "bastion", "cleaver", "dd", "sterak"];

export interface GoldRow { k: ItemKey; /** valeur en po */ s: number; /** rentabilité en % du prix */ e: number }

/** Valeur brute des stats de chaque item (hors passifs et hors % de pénétration), triée. */
export function goldEfficiency(keys: ItemKey[] = GOLD_ITEMS, items: ItemTable = ITEMS): GoldRow[] {
  return keys
    .map((k) => {
      const it = items[k];
      let s = 0;
      for (const f of Object.keys(STAT_GOLD) as (keyof typeof STAT_GOLD)[]) s += (it[f] ?? 0) * STAT_GOLD[f];
      return { k, s: Math.round(s), e: Math.round((100 * s) / it.cost) };
    })
    .sort((a, b) => b.e - a.e);
}
