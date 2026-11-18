/** Échappe un texte pour l'insérer dans du HTML. */
export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Nombre au format français (espace fine comme séparateur de milliers). */
export const fmt = (n: number): string => n.toLocaleString("fr-FR");

/** Pourcentage arrondi à 0,1, à la française (65,3 %). */
export const pct = (n: number): string => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} introuvable`);
  return el as T;
};
