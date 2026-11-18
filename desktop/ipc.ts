// Contrat entre le processus principal et la fenêtre (exposé par preload.ts sous window.kayn).

export interface AppState {
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
  onState(cb: (s: AppState) => void): void;
}

export const IPC = {
  getState: "kayn:get-state",
  setOpenAtLogin: "kayn:set-open-at-login",
  reloadConfig: "kayn:reload-config",
  openUserDataDir: "kayn:open-user-data",
  state: "kayn:state",
} as const;
