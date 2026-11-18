import kayn from "./generated/kayn.json";
import overrides from "./overrides.json";

type Stats = typeof kayn.stats;
type Correction = { value: number; source: string; note: string };

/** Corrections manuelles des stats Data Dragon de Kayn (overrides.json → "kayn"). */
export const KAYN_CORRECTIONS = overrides.kayn as Partial<Record<keyof Stats, Correction>>;

/** Stats de base de Kayn : Data Dragon, corrigé par overrides.json. */
export const KAYN_DD_STATS: Stats = Object.fromEntries(
  Object.entries(kayn.stats).map(([k, v]) => [k, KAYN_CORRECTIONS[k as keyof Stats]?.value ?? v]),
) as Stats;

export const KAYN_SPELLS = kayn.spells;
export const KAYN_PASSIVE = kayn.passive;
