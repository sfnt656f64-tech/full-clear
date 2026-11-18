// Réglages de l'appli (%APPDATA%\kayn-sim\settings.json). Aucune donnée de partie ni d'autre joueur.
import { readFileSync, writeFileSync } from "node:fs";
import type { Form } from "../src/data/types";
import { DEFAULT_SHORTCUTS, isValidAccelerator, type Shortcuts } from "./shortcuts.ts";

export interface Settings {
  overlay: {
    enabled: boolean;
    /** Position en pixels écran (coin haut-gauche), ou absente : coin haut-droit par défaut. */
    x?: number;
    y?: number;
  };
  /** Forme utilisée en jeu : « auto » = celle recommandée d'après la composition. */
  formChoice: Form | "auto";
  shortcuts: Shortcuts;
}

export const DEFAULT_SETTINGS: Settings = { overlay: { enabled: true }, formChoice: "auto", shortcuts: { ...DEFAULT_SHORTCUTS } };

export function parseSettings(text: string | null): Settings {
  try {
    const raw = JSON.parse(text ?? "{}") as Partial<Settings>;
    const o = (raw.overlay ?? {}) as Partial<Settings["overlay"]>;
    const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined);
    return {
      overlay: { enabled: o.enabled !== false, x: int(o.x), y: int(o.y) },
      formChoice: raw.formChoice === "blue" || raw.formChoice === "red" ? raw.formChoice : "auto",
      shortcuts: {
        toggle: isValidAccelerator(raw.shortcuts?.toggle) ? raw.shortcuts.toggle : DEFAULT_SHORTCUTS.toggle,
        move: isValidAccelerator(raw.shortcuts?.move) ? raw.shortcuts.move : DEFAULT_SHORTCUTS.move,
      },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function loadSettings(file: string): Settings {
  let text: string | null = null;
  try { text = readFileSync(file, "utf8"); } catch { /* premier lancement */ }
  return parseSettings(text);
}

export function saveSettings(file: string, s: Settings): void {
  try { writeFileSync(file, JSON.stringify(s, null, 2) + "\n"); } catch { /* disque plein ou dossier protégé : réglage non gardé */ }
}

/** Mode d'affichage du jeu d'après Config\game.cfg : WindowMode=0 plein écran, 1 fenêtré, 2 sans bordure. */
export type WindowMode = "borderless" | "windowed" | "fullscreen" | "unknown";

export function parseWindowMode(cfg: string | null): WindowMode {
  const m = cfg?.match(/^\s*WindowMode\s*=\s*(\d+)/m);
  return !m ? "unknown" : m[1] === "2" ? "borderless" : m[1] === "1" ? "windowed" : m[1] === "0" ? "fullscreen" : "unknown";
}
