// Raccourcis clavier configurables (format « accelerator » d'Electron, ex. "CommandOrControl+Shift+K").

export type ShortcutName = "toggle" | "move";
export type Shortcuts = Record<ShortcutName, string>;

export const DEFAULT_SHORTCUTS: Shortcuts = {
  toggle: "CommandOrControl+Shift+K",
  move: "CommandOrControl+Shift+L",
};

/**
 * État d'un raccourci : actif en partie, libre (testé hors partie), pris par une autre appli
 * (l'enregistrement auprès de Windows a échoué), ou pas encore testé.
 */
export type ShortcutStatus = "active" | "free" | "taken" | "unknown";

const MODIFIERS = ["CommandOrControl", "Alt", "Shift"] as const;
const KEY = /^(?:[A-Z]|[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|num[0-9])$/;

/** Accepté : 0 à 3 modificateurs (Ctrl, Alt, Maj) + une touche ; sans modificateur, seulement F1 à F24. */
export function isValidAccelerator(acc: unknown): acc is string {
  if (typeof acc !== "string") return false;
  const parts = acc.split("+");
  const key = parts.pop()!;
  if (!KEY.test(key)) return false;
  if (new Set(parts).size !== parts.length || !parts.every((m) => (MODIFIERS as readonly string[]).includes(m))) return false;
  return parts.length > 0 || /^F\d+$/.test(key);
}

export interface KeyLike { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }

/**
 * Touche pressée → accelerator, ou null si la combinaison n'est pas utilisable.
 * Lettres : d'après le caractère (AZERTY : la touche A donne « A »). Chiffres : d'après la position
 * (sur AZERTY, la rangée du haut donne « & é " … » sans Maj).
 */
export function acceleratorFromKey(e: KeyLike): string | null {
  if (e.metaKey) return null;
  let key: string | null = null;
  if (/^[a-z]$/i.test(e.key)) key = e.key.toUpperCase();
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad[0-9]$/.test(e.code)) key = `num${e.code.slice(6)}`;
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) key = e.key;
  if (!key) return null;
  const mods = [e.ctrlKey && "CommandOrControl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean) as string[];
  const acc = [...mods, key].join("+");
  return isValidAccelerator(acc) ? acc : null;
}

/** Affichage en français : « Ctrl+Maj+K ». */
export function displayAccelerator(acc: string): string {
  return acc.replace("CommandOrControl", "Ctrl").replace("Shift", "Maj").replace(/num(\d)/, "Pavé num. $1");
}
