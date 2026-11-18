// Réglages partagés par toute la page : runes clés (désactivables).
// Mémorisés dans le navigateur (confort seulement : la page fonctionne sans).
import type { RuneOptions } from "../model/stats";
import { $ } from "./html";

export interface Settings {
  darkHarvest: boolean;
  /** Âmes de Dark Harvest : choix de l'utilisateur, pas une valeur de jeu. */
  souls: number;
  conqueror: boolean;
}

const KEY = "kayn-sim:settings";
const DEFAULTS: Settings = { darkHarvest: true, souls: 10, conqueror: true };
export const SOUL_CHOICES = [0, 5, 10, 20, 30, 50];

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch { /* stockage indisponible : valeurs par défaut */ }
  return { ...DEFAULTS };
}

let settings = load();
const listeners: (() => void)[] = [];

export const getSettings = (): Settings => settings;

/** Options de runes à passer au modèle. */
export const runeOptions = (): RuneOptions => ({
  darkHarvest: settings.darkHarvest ? { souls: settings.souls } : undefined,
  conqueror: settings.conqueror,
});

export const onSettingsChange = (fn: () => void): void => { listeners.push(fn); };

function update(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignoré */ }
  for (const fn of listeners) fn();
}

export function mountSettings(): void {
  $("settings").innerHTML = `<div class="setrow">
      <label class="chk"><input type="checkbox" id="st-dh" ${settings.darkHarvest ? "checked" : ""}> Dark Harvest <span class="sub">(bleu)</span></label>
      <select id="st-souls" aria-label="Âmes de Dark Harvest">${SOUL_CHOICES.map((n) => `<option value="${n}" ${n === settings.souls ? "selected" : ""}>${n} âmes</option>`).join("")}</select>
      <label class="chk"><input type="checkbox" id="st-conq" ${settings.conqueror ? "checked" : ""}> Conqueror <span class="sub">(rouge)</span></label>
    </div>
    <div class="sub">Runes appliquées au draft, au simulateur et au benchmark. Le nombre d'âmes est un choix, pas une donnée du jeu. Conqueror est compté à 12 stacks pendant tout le combat (majorant).</div>`;
  const souls = $<HTMLSelectElement>("st-souls");
  souls.disabled = !settings.darkHarvest;
  $<HTMLInputElement>("st-dh").onchange = (e) => {
    const on = (e.target as HTMLInputElement).checked;
    souls.disabled = !on;
    update({ darkHarvest: on });
  };
  souls.onchange = () => update({ souls: +souls.value });
  $<HTMLInputElement>("st-conq").onchange = (e) => update({ conqueror: (e.target as HTMLInputElement).checked });
}
