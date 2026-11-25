// Niveau de référence des comparaisons (radar, positions « mieux que X % », médianes) : les parties de méta trouvées
// par un joueur de ce rang. Le matchmaking mélange des rangs voisins : c'est le niveau dominant, pas exclusif.

export type RefTier = "EMERALD" | "DIAMOND";
export const REF_TIERS: Record<RefTier, { label: string; short: string; role: string }> = {
  EMERALD: { label: "Émeraude (ton niveau)", short: "Émeraude", role: "ton niveau" },
  DIAMOND: { label: "Diamant (ton objectif)", short: "Diamant", role: "ton objectif" },
};
export const DEFAULT_REF_TIER: RefTier = "EMERALD";
export const isRefTier = (v: unknown): v is RefTier => v === "EMERALD" || v === "DIAMOND";

/** Référence affichée sur chaque radar et chaque comparaison. */
export interface RefInfo { tier: RefTier; label: string; short: string; games: number }
