// Réglages de l'appli (%APPDATA%\full-clear\settings.json). Aucune donnée de partie ni d'autre joueur.
import { DEFAULT_REF_TIER, isRefTier, type RefTier } from "./analysis/ref-tier.ts";
import { readFileSync, writeFileSync } from "node:fs";
import type { Form } from "../src/data/types";
import { DEFAULT_SHORTCUTS, isValidAccelerator, type Shortcuts } from "./shortcuts.ts";

export interface Settings {
  overlay: {
    enabled: boolean;
    /** Conseils d'avant-partie dans l'overlay (début de partie). */
    tips: boolean;
    /** Position en pixels écran (coin haut-gauche), ou absente : coin haut-droit par défaut. */
    x?: number;
    y?: number;
  };
  /** Forme utilisée en jeu : « auto » = celle recommandée d'après la composition. */
  formChoice: Form | "auto";
  shortcuts: Shortcuts;
  /** Collecte en pause (bouton de la fenêtre). */
  collectorPaused: boolean;
  /**
   * Champions exclus de tes stats, de ton score et de tes recommandations (identifiants Data Dragon) :
   * parties jouées par quelqu'un d'autre sur tes comptes. Ils restent comptés dans les données de méta.
   */
  excludedChampions: string[];
  /** Suivi des objectifs : début du suivi (ms) et cibles modifiées (clé de mesure → cible). */
  goals: { startMs: number | null; targets: Record<string, number> };
  /** Niveau de référence des comparaisons. */
  refTier: RefTier;
  /** Objectif du pool : gagner tout de suite, ou progresser sur de nouveaux champions. */
  poolGoal: "win" | "progress";
  /** Choix par champion (identifiant Data Dragon), prioritaires sur le seuil « déjà beaucoup joué ». */
  championFlags: Record<string, "notForMe" | "progress">;
  /** Dernière partie dont l'analyse d'après-partie a été signalée (identifiant de partie Riot). */
  lastPostGame: string | null;
  /** Thème de la semaine : erreur travaillée, depuis quand, et sa fréquence avant ; bilan de la semaine précédente. */
  theme: ThemeState | null;
  lastReview: { key: string; label: string; text: string; endMs: number } | null;
}

export interface ThemeStat { perGame: number; margin: number; games: number }
export interface ThemeState { key: string; startMs: number; before: ThemeStat }

export const DEFAULT_EXCLUDED = ["Jax", "Fiora", "Camille"];

export const DEFAULT_SETTINGS: Settings = { overlay: { enabled: true, tips: true }, formChoice: "auto", shortcuts: { ...DEFAULT_SHORTCUTS }, collectorPaused: false, excludedChampions: [...DEFAULT_EXCLUDED], goals: { startMs: null, targets: {} }, refTier: DEFAULT_REF_TIER, poolGoal: "progress", championFlags: {}, lastPostGame: null, theme: null, lastReview: null };

export function parseSettings(text: string | null): Settings {
  try {
    const raw = JSON.parse(text ?? "{}") as Partial<Settings>;
    const o = (raw.overlay ?? {}) as Partial<Settings["overlay"]>;
    const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined);
    return {
      overlay: { enabled: o.enabled !== false, tips: o.tips !== false, x: int(o.x), y: int(o.y) },
      formChoice: raw.formChoice === "blue" || raw.formChoice === "red" ? raw.formChoice : "auto",
      shortcuts: {
        toggle: isValidAccelerator(raw.shortcuts?.toggle) ? raw.shortcuts.toggle : DEFAULT_SHORTCUTS.toggle,
        move: isValidAccelerator(raw.shortcuts?.move) ? raw.shortcuts.move : DEFAULT_SHORTCUTS.move,
      },
      collectorPaused: raw.collectorPaused === true,
      // Liste vide gardée telle quelle (tout réintégré) ; absente ou invalide → liste par défaut.
      excludedChampions: Array.isArray(raw.excludedChampions)
        ? [...new Set(raw.excludedChampions.filter((x): x is string => typeof x === "string" && /^[A-Za-z]{1,30}$/.test(x)))]
        : [...DEFAULT_EXCLUDED],
      goals: {
        startMs: int(raw.goals?.startMs) ?? null,
        targets: Object.fromEntries(Object.entries(raw.goals?.targets ?? {}).filter(([k, v]) => /^[A-Za-z0-9]{1,30}$/.test(k) && typeof v === "number" && Number.isFinite(v))),
      },
      refTier: isRefTier(raw.refTier) ? raw.refTier : DEFAULT_REF_TIER,
      poolGoal: raw.poolGoal === "win" ? "win" : "progress",
      championFlags: Object.fromEntries(Object.entries(raw.championFlags ?? {}).filter(([k, v]) => /^[A-Za-z]{1,30}$/.test(k) && (v === "notForMe" || v === "progress"))),
      theme: parseTheme(raw.theme),
      lastReview: raw.lastReview && typeof raw.lastReview === "object" && typeof raw.lastReview.text === "string" && typeof raw.lastReview.key === "string" && typeof raw.lastReview.label === "string" && typeof raw.lastReview.endMs === "number" ? raw.lastReview : null,
      lastPostGame: typeof raw.lastPostGame === "string" && /^[A-Z0-9]{2,6}_\d{1,15}$/.test(raw.lastPostGame) ? raw.lastPostGame : null,
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function parseTheme(v: unknown): ThemeState | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  const b = (t.before ?? {}) as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  if (typeof t.key !== "string" || !/^[a-zA-Z]{1,40}$/.test(t.key) || num(t.startMs) == null || num(b.perGame) == null || num(b.margin) == null || num(b.games) == null) return null;
  return { key: t.key, startMs: num(t.startMs)!, before: { perGame: num(b.perGame)!, margin: num(b.margin)!, games: num(b.games)! } };
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
