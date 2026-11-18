import generated from "./generated/items.json";
import type { BootKey, Item, ItemFlag, ItemKey, ItemTable } from "./types";

/** Ce que Data Dragon ne fournit pas : abréviation, effets simulés, bottes. */
interface LocalMeta {
  s: string;
  flags?: ItemFlag[];
  boots?: true;
  /**
   * Réduction d'armure en % : c'est un passif, absent des stats Data Dragon.
   * Black Cleaver (Carve) : 6 % par stack, 30 % à 5 stacks (wiki, Module:ItemData).
   */
  shred?: number;
}

const META: Record<ItemKey, LocalMeta> = {
  voltaic: { s: "VC", flags: ["volt"] },
  hubris: { s: "HB", flags: ["hubris"] },
  axiom: { s: "AX", flags: ["axiom"] },
  edge: { s: "EN" },
  serylda: { s: "SG" },
  serpent: { s: "SF", flags: ["serpent"] },
  youmuu: { s: "YG" },
  bastion: { s: "BB", flags: ["bastion"] },
  profane: { s: "PH" },
  cleaver: { s: "BC", shred: 30 },
  dd: { s: "DD", flags: ["dd"] },
  sterak: { s: "ST", flags: ["sterak"] },
  ga: { s: "GA" },
  chempunk: { s: "CC" },
  lucidity: { s: "IL", boots: true },
  steelcaps: { s: "PS", boots: true },
  mercury: { s: "MT", boots: true },
  swiftness: { s: "SW", boots: true },
};

/** Stats d'un item telles que générées par scripts/sync-ddragon.ts. */
export interface GeneratedItem {
  id: string; name: string; nameFr: string; image: string; cost: number;
  ad?: number; leth?: number; ah?: number; hp?: number; armor?: number; mr?: number; pen?: number;
  ms?: number; msPct?: number; tenacity?: number;
}
export const GENERATED_ITEMS = generated as Record<string, GeneratedItem>;

function fromGenerated(k: ItemKey): Item {
  const g = GENERATED_ITEMS[k];
  if (!g) throw new Error(`Item ${k} absent de src/data/generated/items.json : relancer npm run sync.`);
  const m = META[k];
  const it: Item = { n: g.name, nFr: g.nameFr, id: g.id, image: g.image, s: m.s, cost: g.cost };
  for (const f of ["ad", "leth", "ah", "hp", "armor", "mr", "pen"] as const) if (g[f]) it[f] = g[f];
  if (m.shred) it.shred = m.shred;
  if (m.boots) it.boots = true;
  if (m.flags) it.flags = m.flags;
  return it;
}

/** Items du patch courant (Data Dragon + effets locaux). */
export const ITEMS: ItemTable = Object.fromEntries(
  (Object.keys(META) as ItemKey[]).map((k) => [k, fromGenerated(k)]),
) as ItemTable;

const T3_KEY: Record<BootKey, string> = {
  lucidity: "crimsonLucidity",
  steelcaps: "armoredAdvance",
  mercury: "chainlacedCrushers",
  swiftness: "swiftmarch",
};

/** Nom anglais des bottes de niveau 3 (affichage seulement). */
export const BOOTS_T3: Record<BootKey, string> = Object.fromEntries(
  (Object.keys(T3_KEY) as BootKey[]).map((k) => [k, GENERATED_ITEMS[T3_KEY[k]]?.name ?? "?"]),
) as Record<BootKey, string>;

export const isBoots = (k: ItemKey): boolean => !!ITEMS[k].boots;
