// Types partagés entre données, modèle, moteur et interface.

export type Form = "blue" | "red";
export type Stage = "mid" | "late";

export type ItemKey =
  | "voltaic" | "hubris" | "axiom" | "edge" | "serylda" | "serpent" | "youmuu" | "bastion" | "profane"
  | "cleaver" | "dd" | "sterak" | "ga" | "chempunk"
  | "lucidity" | "steelcaps" | "mercury" | "swiftness";

export type BootKey = "lucidity" | "steelcaps" | "mercury" | "swiftness";

/** Effets d'items que le modèle sait simuler. */
export type ItemFlag = "volt" | "hubris" | "axiom" | "serpent" | "dd" | "sterak";

export interface Item {
  /** Nom anglais (affiché tel quel dans l'interface). */
  n: string;
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
  /** Valeurs non vérifiées sur ce patch (badge ≈ dans l'interface). */
  approx?: boolean;
  flags?: ItemFlag[];
}

export type Profile = "tank" | "fighter" | "assassin" | "mage" | "marksman" | "enchanter";
export type DamageType = "physical" | "magic" | "mixed";

export interface Champion {
  name: string;
  profile: Profile;
  range: "melee" | "ranged";
  damage: DamageType;
  /** Niveau de contrôle de foule, de 0 à 3. */
  cc: number;
  shields: boolean;
  heals: boolean;
  slows: boolean;
}

/** Cible d'une simulation : un profil type, pas un champion précis. */
export interface Target {
  n: string;
  hp: number;
  armor: number;
  mr: number;
  shield?: number;
}

export type TargetKey = "adc" | "mage" | "shield" | "bruiser" | "tank";
