// Contrat entre le processus principal et la fenêtre (exposé par preload.ts sous window.kayn).
import type { DraftView } from "./draft-view.ts";

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

export interface AppState {
  client: ClientStatus;
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
  openDraftInSimulator(): Promise<void>;
  onState(cb: (s: AppState) => void): void;
}

export const IPC = {
  getState: "kayn:get-state",
  setOpenAtLogin: "kayn:set-open-at-login",
  reloadConfig: "kayn:reload-config",
  openUserDataDir: "kayn:open-user-data",
  openDraftInSimulator: "kayn:open-draft",
  state: "kayn:state",
} as const;
