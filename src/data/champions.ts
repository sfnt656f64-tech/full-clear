import generated from "./generated/champions.json";
import overrides from "./overrides.json";
import type { Champion, DamageType, Profile } from "./types";

interface GeneratedChampion {
  id: string; key: number; name: string; nameEn: string; tags: string[];
  attackRange: number; range: "melee" | "ranged";
  info: { attack: number; defense: number; magic: number; difficulty: number };
  image: string;
}

export interface ChampionOverride {
  name: string;
  profile: Profile;
  damage: DamageType;
  cc: number;
  shields: boolean;
  heals: boolean;
  slows: boolean;
  range?: "melee" | "ranged";
  rangeNote?: string;
}

export const OVERRIDES = overrides.champions as Record<string, ChampionOverride>;

/** Profil par défaut d'après le premier tag Riot (champion absent de overrides.json). */
export const PROFILE_FROM_TAG: Record<string, Profile> = {
  Tank: "tank", Fighter: "fighter", Assassin: "assassin", Mage: "mage", Marksman: "marksman", Support: "enchanter",
};

export function buildChampion(g: GeneratedChampion, o: ChampionOverride | undefined): Champion {
  const base = { id: g.id, name: g.name, nameEn: g.nameEn, image: g.image, tags: g.tags };
  if (o) {
    return { ...base, profile: o.profile, range: o.range ?? g.range, damage: o.damage, cc: o.cc, shields: o.shields, heals: o.heals, slows: o.slows };
  }
  // Pas d'override : profil et type de dégâts déduits de Data Dragon, le reste est inconnu.
  return {
    ...base,
    unverified: true,
    profile: PROFILE_FROM_TAG[g.tags[0]] ?? "fighter",
    range: g.range,
    damage: g.info.magic > g.info.attack ? "magic" : "physical",
    cc: 0, shields: false, heals: false, slows: false,
  };
}

/** Champions du patch courant, triés par nom français. */
export const CHAMPIONS: Champion[] = (generated as GeneratedChampion[])
  .map((g) => buildChampion(g, OVERRIDES[g.id]))
  .sort((a, b) => a.name.localeCompare(b.name, "fr"));

const index = new Map<string, Champion>();
for (const c of CHAMPIONS) for (const k of [c.id!, c.name, c.nameEn!]) index.set(k, c);

/** Recherche par identifiant Data Dragon, nom français ou nom anglais. */
export const findChamp = (key: string): Champion | undefined => index.get(key);

export const champ = (key: string): Champion => {
  const c = index.get(key);
  if (!c) throw new Error(`Champion inconnu : ${key}`);
  return c;
};

/** Normalise pour la recherche : minuscules, sans accents ni ponctuation. */
export const normalize = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export const matchesQuery = (c: Champion, q: string): boolean => {
  const n = normalize(q);
  return !n || [c.name, c.nameEn ?? "", c.id ?? ""].some((s) => normalize(s).includes(n));
};

/** Libellés français des profils. */
export const PROFILE_LABEL: Record<Profile, string> = {
  tank: "Tank",
  fighter: "Combattant",
  assassin: "Assassin",
  mage: "Mage",
  marksman: "Tireur",
  enchanter: "Enchanteur",
};
