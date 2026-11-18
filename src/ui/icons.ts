// Icônes : images officielles Data Dragon, posées sur les pictogrammes SVG d'origine.
// Si une image ne charge pas (hors ligne, CDN indisponible, fichier absent), elle est
// retirée par installImageFallback() et le pictogramme en dessous reste visible.
import { ITEMS } from "../data/items";
import { PROFILE_LABEL } from "../data/champions";
import type { Champion, ItemKey, Profile } from "../data/types";
import { DDRAGON_VERSION } from "../data/version";
import { esc } from "./html";

export const DDRAGON_IMG = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img`;

/** Image Data Dragon (décorative : le nom est déjà dans le title du parent). */
export const ddImg = (path: string, lazy = true): string =>
  `<img class="dd" src="${DDRAGON_IMG}/${encodeURI(path)}" alt=""${lazy ? ' loading="lazy"' : ""} decoding="async" draggable="false">`;

/** Retire toute image Data Dragon qui échoue, pour laisser apparaître l'icône de secours. */
export function installImageFallback(root: Document | HTMLElement = document): void {
  root.addEventListener("error", (e) => {
    const t = e.target;
    if (t instanceof HTMLImageElement && t.classList.contains("dd")) t.remove();
  }, true);
}

const GLYPHS = {
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  crown: '<path d="M3 18h18l-2-10-4 4-3-6-3 6-4-4z"/>',
  arc: '<path d="M12 3a9 9 0 1 0 9 9h-3a6 6 0 1 1-6-6z"/><path d="M15 2l5 4-6 2z"/>',
  moon: '<path d="M15 3a9 9 0 1 0 6 13A7 7 0 0 1 15 3z"/>',
  spike: '<path d="M3 21l7-11 2 2zM14 2l8 0 0 8-3-3-6 6-2-2 6-6z"/>',
  fang: '<path d="M5 3c0 9 3 15 7 19 4-4 7-10 7-19-2 3-4 5-7 5S7 6 5 3z"/>',
  ghost: '<path d="M5 21V10a7 7 0 0 1 14 0v11l-2.3-2-2.3 2-2.4-2-2.4 2-2.3-2z"/>',
  tower: '<path d="M5 21V8h3V4h2v4h4V4h2v4h3v13z"/>',
  hydra: '<path d="M5 21V9l-2-3 3-1 1 3v13zm6 0V6L9 3l3-1 1 3v16zm6 0V9l-2-3 3-1 1 3v13z"/>',
  axe: '<path d="M5 22l-2-2L13 10l2 2z"/><path d="M12 3c5 0 9 4 9 9l-4-1-4-4z"/>',
  drop: '<path d="M12 2c4 6 7 9 7 13a7 7 0 0 1-14 0c0-4 3-7 7-13z"/>',
  heart: '<path d="M12 21l-8-8a5 5 0 0 1 8-6 5 5 0 0 1 8 6z"/>',
  wings: '<circle cx="12" cy="5" r="2.5"/><path d="M12 9c-4 0-8 3-10 8 4-1 7-1 10 2 3-3 6-3 10-2-2-5-6-8-10-8z"/>',
  boot: '<path d="M7 3h6v9l7 3v6H4v-3h3z"/>',
  saw: '<path d="M3 15l3-4 3 4 3-4 3 4 3-4 3 4v5H3z"/>',
  shield: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>',
  swords: '<path d="M4 3l8 9-2 2-8-9V3zm16 0v2l-8 9-2-2 8-9z"/><path d="M5 17l3 3-2 2-3-3zm14 0l2 2-3 3-2-2z"/>',
  dagger: '<path d="M12 1l2.5 11h-5zM8 13h8v2H8zm3 3h2v6h-2z"/>',
  star: '<path d="M12 2l2.6 6.9L22 9.3l-5.6 4.8L18.2 22 12 18l-6.2 4 1.8-7.9L2 9.3l7.4-.4z"/>',
  arrow: '<path d="M3 21l10-10-2-2 9-6-6 9-2-2L4 22z"/>',
  plus: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
} as const;
type Glyph = keyof typeof GLYPHS;

export const svg = (g: Glyph, color = "#fff", size = 22): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" aria-hidden="true">${GLYPHS[g]}</svg>`;

const ITEM_GLYPH: Record<ItemKey, [Glyph, string]> = {
  voltaic: ["bolt", "#c9a227"], hubris: ["crown", "#8e44ad"], axiom: ["arc", "#3d7be0"], edge: ["moon", "#4a3f8f"],
  serylda: ["spike", "#b5651d"], serpent: ["fang", "#2e8b57"], youmuu: ["ghost", "#5d6d7e"], bastion: ["tower", "#7f8c8d"],
  profane: ["hydra", "#a04000"], cleaver: ["axe", "#922b21"], dd: ["drop", "#7b241c"], sterak: ["heart", "#b03a2e"],
  ga: ["wings", "#d4ac0d"], lucidity: ["boot", "#2874a6"], steelcaps: ["boot", "#616a6b"], mercury: ["boot", "#1e8449"],
  swiftness: ["boot", "#ca6f1e"], chempunk: ["saw", "#28b463"],
};

export function itemIcon(k: ItemKey): string {
  const [g, color] = ITEM_GLYPH[k];
  const it = ITEMS[k];
  return `<div class="it" style="background:${color}" title="${esc(it.n)}">${svg(g)}${it.image ? ddImg(`item/${it.image}`) : ""}<small>${it.s}</small></div>`;
}

export const PROFILE_GLYPH: Record<Profile, [Glyph, string]> = {
  tank: ["shield", "#2e7d6b"], fighter: ["swords", "#b5522f"], assassin: ["dagger", "#6c3483"],
  mage: ["star", "#2e5fb5"], marksman: ["arrow", "#b7950b"], enchanter: ["plus", "#1f8a70"],
};

/** Deux lettres pour l'icône de secours (même règle que la page d'origine). */
export const initials = (n: string): string =>
  n.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    .padEnd(2, n.replace(/[^a-z]/g, "")[0] || "");

export function champTile(c: Champion | null, size = 48): string {
  const dim = `width:${size}px;height:${size}px`;
  if (!c) return `<div class="ch empty" style="${dim}">+</div>`;
  const [g, color] = PROFILE_GLYPH[c.profile];
  const title = `${c.name} — ${PROFILE_LABEL[c.profile]}${c.unverified ? " (non vérifié : absent de overrides.json)" : ""}`;
  return `<div class="ch" style="${dim};background:linear-gradient(140deg,${color},#11151f)" title="${esc(title)}">`
    + `<b>${initials(c.nameEn ?? c.name)}</b>${c.image ? ddImg(`champion/${c.image}`) : ""}<span class="cg">${svg(g, "#fff", 12)}</span>`
    + `<span class="rg">${c.range === "melee" ? "⚔" : "➹"}</span>`
    + (c.unverified ? `<span class="uv">?</span>` : "") + `</div>`;
}
