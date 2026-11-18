// Types partagés entre données, modèle, moteur et interface.

export type Form = "blue" | "red";
export type Stage = "mid" | "late";

export type ItemKey =
  | "voltaic" | "hubris" | "axiom" | "edge" | "serylda" | "serpent" | "youmuu" | "bastion" | "profane"
  | "cleaver" | "dd" | "sterak" | "ga" | "chempunk"
  | "lucidity" | "steelcaps" | "mercury" | "swiftness";

export type BootKey = "lucidity" | "steelcaps" | "mercury" | "swiftness";

/** Familiers de jungle (item de départ). */
export type StarterKey = "scorchclaw" | "gustwalker" | "mosstomper";

/** Effets d'items que le modèle sait simuler. */
export type ItemFlag = "volt" | "hubris" | "axiom" | "serpent" | "dd" | "sterak" | "bastion";

export interface Item {
  /** Nom anglais (affiché tel quel dans l'interface). */
  n: string;
  /** Nom français (Data Dragon fr_FR). */
  nFr?: string;
  /** Identifiant Data Dragon. */
  id?: string;
  /** Fichier d'icône Data Dragon. */
  image?: string;
  /** Abréviation affichée sous l'icône. */
  s: string;
  ad?: number;
  leth?: number;
  ah?: number;
  hp?: number;
  armor?: number;
  mr?: number;
  /** Pénétration d'armure en %. */
  pen?: number;
  /** Réduction d'armure en % (Black Cleaver à 5 stacks). */
  shred?: number;
  cost: number;
  boots?: boolean;
  /** Valeurs non vérifiées (badge ≈ dans l'interface). */
  approx?: boolean;
  flags?: ItemFlag[];
}

export type Profile = "tank" | "fighter" | "assassin" | "mage" | "marksman" | "enchanter";
export type DamageType = "physical" | "magic" | "mixed";

export interface Champion {
  /** Identifiant Data Dragon (stable). Absent pour les données de la première version. */
  id?: string;
  /** Clé numérique Riot (championId de l'API). */
  key?: number;
  /** Nom affiché (français). */
  name: string;
  /** Nom anglais. */
  nameEn?: string;
  /** Fichier d'icône Data Dragon. */
  image?: string;
  /** Tags Riot (Tank, Fighter, Assassin, Mage, Marksman, Support). */
  tags?: string[];
  /** Pas d'entrée dans overrides.json : profil déduit des tags, CC/boucliers/soins inconnus. */
  unverified?: boolean;
  profile: Profile;
  range: "melee" | "ranged";
  damage: DamageType;
  /** Niveau de contrôle de foule, de 0 à 3. */
  cc: number;
  shields: boolean;
  heals: boolean;
  slows: boolean;
  /** Early game très agressif ou invades fréquentes (overrides.json, édité à la main). */
  early?: boolean;
}

/** Cible d'une simulation : un profil type, pas un champion précis. */
export interface Target {
  n: string;
  hp: number;
  armor: number;
  mr: number;
  shield?: number;
}

/** Table d'items : celle du patch courant, ou une table figée (tests). */
export type ItemTable = Record<ItemKey, Item>;

export type TargetKey = "adc" | "mage" | "shield" | "bruiser" | "tank";
