// Contrat entre le processus principal et la fenêtre (exposé par preload.ts sous window.kayn).
import type { RefInfo, RefTier } from "./analysis/ref-tier.ts";
import type { DraftView } from "./draft-view.ts";
import type { HostState } from "./collector-host.ts";
import type { MyGameRow } from "./stats/my-stats.ts";
import type { MetaChampion } from "./meta/meta-stats.ts";
import type { MetaPatchInfo } from "./meta/read.ts";
import type { Recommendations } from "./reco/recommend.ts";
import type { GameAnalysis } from "./analysis/analysis.ts";
import type { ChampionRow, EvolutionPoint, Overview, OverviewFilter } from "./analysis/overview.ts";
import type { Radar } from "./analysis/radar.ts";
import type { Heat } from "./data/engine.ts";
import type { PotentialGroups } from "./reco/potential.ts";
import type { PoolAdvice } from "./reco/pool-advice.ts";

/** Tendance d'un champion entre les deux derniers patchs (méta Émeraude+). */
export interface MetaTrend { delta: number; latest: { patch: string; winRate: number; games: number }; previous: { patch: string; winRate: number; games: number } }
import type { GoalsView } from "./analysis/goals.ts";
export type { GoalsView };

/** Vue d'ensemble de l'onglet « Analyse ». */
export interface OverviewView {
  filter: OverviewFilter;
  /** Référence des positions, médianes et radars. */
  reference: RefInfo;
  /** Choix des filtres : tes champions (parties dans le rôle, la période et le compte choisis), saisons, comptes. */
  options: { champions: { id: number; games: number }[]; seasons: number[]; accounts: string[] };
  overview: Overview;
  evolution: { by: "month" | "patch"; points: EvolutionPoint[] };
  /** « Tous les champions » : tes champions comparés entre eux. */
  table: ChampionRow[] | null;
  /** Carte de chaleur, déjà regroupée par case (au lieu de milliers de points). */
  heat: Heat;
  /** Radar de la sélection, et d'un champion à comparer (mêmes filtres). */
  radar: Radar | null;
  compare: { championId: number; radar: Radar | null } | null;
  /** Champions comparables (au moins 5 parties avec les filtres hors champion). */
  compareOptions: number[];
}

/** Onglet « Analyse » : tes dernières parties relues, et l'analyse de celle choisie. */
export interface AnalysisView {
  /** Radar de la partie choisie, et ta moyenne sur ce champion dans ce rôle. */
  radar?: { game: Radar | null; average: Radar | null };
  games: { key: string; championId: number; win: boolean; kda: string; startMs: number; role: string }[];
  selected: string | null;
  analysis: GameAnalysis | null;
  /** Référence des positions et du radar (absente sans partie). */
  reference?: RefInfo;
}

/** Champions recommandés (fenêtre « Champions recommandés »), avec les patchs de méta utilisés. */
export interface RecoView extends Recommendations {
  patches: string[];
  /** Référence des radars et du classement. */
  reference: RefInfo;
  /** Classement par potentiel et radars de tes champions, par rôle. */
  potential: Record<string, PotentialGroups>;
  /** Pool conseillé, par rôle. */
  advice: Record<string, PoolAdvice>;
  /** Tendance entre les deux derniers patchs, par rôle puis par champion. */
  trends: Record<string, Record<number, MetaTrend>>;
}

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
  /** Niveau de référence choisi. */
  refTier: RefTier;
  /** Dossier de données, et reprise de l'ancien dossier « kayn-sim » (changement de nom). */
  data: { dir: string; migratedFrom: string | null; legacyKept: string | null; error: string | null; /** Ancien dossier modifié après la reprise (date de la reprise). */ changedAfter: string | null };
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
  /** Analyse d'une partie (clé « matchId|compte »), ou de la dernière. */
  getAnalysis(key: string | null, filter?: OverviewFilter): Promise<AnalysisView>;
  /** Navigation demandée par le processus principal (menu de l'icône, simulateur). */
  onNavigate(cb: (nav: Navigation) => void): void;
  /** Niveau de référence des comparaisons (Analyse, Champions). */
  setRefTier(tier: RefTier): Promise<AppState>;
  getOverview(filter: OverviewFilter, compareChampionId?: number | null): Promise<OverviewView>;
  /** Suivi de tes objectifs (jungle). */
  getGoals(): Promise<GoalsView>;
  /** Recommence le suivi aujourd'hui (comparaison avec les 4 semaines d'avant). */
  restartGoals(): Promise<GoalsView>;
  setGoalTarget(key: string, value: number | null): Promise<GoalsView>;
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
  getAnalysis: "kayn:get-analysis",
  setRefTier: "kayn:set-ref-tier",
  navigate: "kayn:navigate",
  getOverview: "kayn:get-overview",
  getGoals: "kayn:get-goals",
  restartGoals: "kayn:restart-goals",
  setGoalTarget: "kayn:set-goal-target",
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

/** Vue de la fenêtre unique : onglet, sous-vue de Champions, ancre du simulateur (draft). */
export interface Navigation { tab: "home" | "draft" | "analysis" | "champions" | "settings"; sub?: "reco" | "stats" | "meta" | "sim"; hash?: string }
