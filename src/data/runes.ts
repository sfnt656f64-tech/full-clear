import generated from "./generated/runes.json";

export interface RuneTree { name: string; nameEn: string; icon: string }
export interface Rune { name: string; nameEn: string; icon: string; tree: number; slot: number }

/** Arbres et runes, d'après Data Dragon (runesReforged, scripts/sync-ddragon.ts → runes.json). */
export const RUNE_TREES = generated.trees as Record<string, RuneTree>;
export const RUNES_BY_ID = generated.runes as Record<string, Rune>;

/**
 * Fragments de stats : absents de Data Dragon. Identifiants fixes du jeu (perks statPerks de match-v5
 * et pages de runes du client).
 */
export const SHARDS: Record<number, string> = {
  5008: "Adaptive Force",
  5005: "Attack Speed",
  5007: "Ability Haste",
  5010: "Move Speed",
  5001: "Health Scaling",
  5011: "Health",
  5013: "Tenacity and Slow Resist",
};

/** Icône d'une rune ou d'un arbre (CDN Data Dragon, sans numéro de version). */
export const runeIconUrl = (icon: string): string => `https://ddragon.leagueoflegends.com/cdn/img/${icon}`;

/** Nom anglais (comme les noms d'items et le guide de runes). */
export const runeName = (id: number): string => RUNES_BY_ID[id]?.nameEn ?? RUNE_TREES[id]?.nameEn ?? SHARDS[id] ?? `#${id}`;
