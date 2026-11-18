import generated from "./generated/starters.json";
import type { StarterKey } from "./types";

/** Familier de jungle, d'après Data Dragon (scripts/sync-ddragon.ts → starters.json). */
export interface Starter {
  /** Identifiant Data Dragon principal. */
  id: string;
  /** Toutes les variantes de même nom (pour reconnaître le familier dans un inventaire). */
  ids: string[];
  name: string;
  nameFr: string;
  image: string;
  cost: number;
  /** Effet une fois adulte. */
  effect: string;
  effectFr: string;
}

export const STARTERS = generated as Record<StarterKey, Starter>;

/** Identifiants de tous les familiers, toutes variantes confondues. */
export const STARTER_ITEM_IDS: ReadonlySet<string> = new Set(Object.values(STARTERS).flatMap((s) => s.ids));
