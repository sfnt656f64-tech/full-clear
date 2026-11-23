// Contrat entre le processus principal et la fenêtre (exposé par preload.ts sous window.kayn).
import type { DraftView } from "./draft-view.ts";
import type { HostState } from "./collector-host.ts";
import type { MyGameRow } from "./stats/my-stats.ts";
import type { MetaChampion } from "./meta/meta-stats.ts";
import type { MetaPatchInfo } from "./meta/read.ts";
import type { Recommendations } from "./reco/recommend.ts";

/** Champions recommandés (fenêtre « Champions recommandés »), avec les patchs de méta utilisés. */
export interface RecoView extends Recommendations { patches: string[] }

/** Méta calculée pour la fenêtre « Méta ». */
export interface MetaView {
  patches: MetaPatchInfo[];
  selected: string[];
  matches: number;
  champions: MetaChampion[];
}

export type { DraftView };

export type ClientStatus =
  | { kind: "closed" }
  | {
    kind: "connected";
    /** Ton Riot ID d'après le client (« Nom#TAG »), seul compte jamais lu. */
    account: string | null;
    /** Le compte connecté est-il celui du .env ? null si l'un des deux manque. */
    matchesEnv: boolean | null;
    phase: string;
    phaseLabel: string;
  };

export interface LiveState {
  /** Partie en cours détectée sur le port 2999. */
  inGame: boolean;
  view: import("./next-item.ts").OverlayView | null;
  overlayEnabled: boolean;
  /** Conseils d'avant-partie dans l'overlay. */
  tipsEnabled: boolean;
  overlayVisible: boolean;
  overlayMoving: boolean;
  hiddenByUser: boolean;
  formChoice: "auto" | "blue" | "red";
  windowMode: import("./settings.ts").WindowMode;
  shortcuts: Record<import("./shortcuts.ts").ShortcutName, { accelerator: string; label: string; status: import("./shortcuts.ts").ShortcutStatus }>;
}

export interface AppState {
  client: ClientStatus;
  live: LiveState;
  /** Dernière draft analysée (gardée pendant la partie), ou null. */
  draft: DraftView | null;
  /** Vrai pendant la sélection des champions. */
  draftLive: boolean;
  /** Date de réception de la draft (ms), pour le décompte du chrono côté fenêtre. */
  draftAt: number;
  version: string;
  envFile: string | null;
  searched: string[];
  /** « Nom#TAG », jamais d'autre identité. */
  riotId: string | null;
  /** Tes comptes (RIOT_ID, RIOT_ID_2). */
  riotIds: string[];
  /** Une clé est présente dans le .env (la clé elle-même n'est jamais envoyée à la fenêtre). */
  hasApiKey: boolean;
  collector: HostState;
  /** Pause manuelle de la collecte. */
  collectorPaused: boolean;
  /** Champions exclus de tes stats (identifiants Data Dragon). */
  excludedChampions: string[];
  problems: string[];
  openAtLogin: boolean;
  /** Vrai en développement (npm run desktop) : le démarrage automatique pointe alors vers Electron + le dépôt. */
  dev: boolean;
}

export interface KaynApi {
  getState(): Promise<AppState>;
  setOpenAtLogin(on: boolean): Promise<AppState>;
  reloadConfig(): Promise<AppState>;
  openUserDataDir(): Promise<void>;
  setCollectorPaused(on: boolean): Promise<AppState>;
  /** Tes parties enregistrées (pour la fenêtre « Mes stats »). */
  getMyGames(): Promise<MyGameRow[]>;
  openStatsWindow(): Promise<void>;
  openMetaWindow(): Promise<void>;
  /** Méta des `scope` derniers patchs (1 à 3). */
  getMeta(scope: number): Promise<MetaView>;
  openRecoWindow(): Promise<void>;
  /** Importe la page de runes recommandée de la draft en cours dans le client. */
  importRunes(): Promise<{ ok: boolean; message: string }>;
  getRecommendations(): Promise<RecoView>;
  setExcludedChampions(ids: string[]): Promise<AppState>;
  openDraftInSimulator(): Promise<void>;
  setOverlayEnabled(on: boolean): Promise<AppState>;
  setTipsEnabled(on: boolean): Promise<AppState>;
  setFormChoice(f: "auto" | "blue" | "red"): Promise<AppState>;
  resetOverlayPosition(): Promise<AppState>;
  /** null : raccourci par défaut. Renvoie aussi une erreur si la combinaison est refusée. */
  setShortcut(name: "toggle" | "move", accelerator: string | null): Promise<{ state: AppState; error: string | null }>;
  /** Suspend les raccourcis globaux pendant la saisie d'une nouvelle combinaison. */
  setCapturing(on: boolean): Promise<void>;
  onState(cb: (s: AppState) => void): void;
}

export const IPC = {
  getState: "kayn:get-state",
  setOpenAtLogin: "kayn:set-open-at-login",
  reloadConfig: "kayn:reload-config",
  openUserDataDir: "kayn:open-user-data",
  setCollectorPaused: "kayn:set-collector-paused",
  getMyGames: "kayn:get-my-games",
  openStatsWindow: "kayn:open-stats-window",
  openMetaWindow: "kayn:open-meta-window",
  getMeta: "kayn:get-meta",
  openRecoWindow: "kayn:open-reco-window",
  importRunes: "kayn:import-runes",
  getRecommendations: "kayn:get-recommendations",
  setExcludedChampions: "kayn:set-excluded-champions",
  openDraftInSimulator: "kayn:open-draft",
  setOverlayEnabled: "kayn:set-overlay-enabled",
  setTipsEnabled: "kayn:set-tips-enabled",
  setFormChoice: "kayn:set-form-choice",
  resetOverlayPosition: "kayn:reset-overlay-position",
  setShortcut: "kayn:set-shortcut",
  setCapturing: "kayn:set-capturing",
  state: "kayn:state",
} as const;

// ---------- Overlay en jeu ----------

export interface OverlayApi {
  onView(cb: (v: import("./next-item.ts").OverlayView | null) => void): void;
  onMoving(cb: (moving: boolean) => void): void;
  setHeight(px: number): void;
}

export const OVERLAY_IPC = {
  view: "overlay:view",
  moving: "overlay:moving",
  height: "overlay:height",
} as const;
