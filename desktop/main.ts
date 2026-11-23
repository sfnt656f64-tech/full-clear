// Processus principal de l'application de bureau : icône dans la zone de notification, fenêtre d'état,
// lancement au démarrage. Aucune console : en version installée, rien ne s'affiche hors de nos fenêtres.
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ClientWatcher } from "./client-watch.ts";
import { CollectorHost, GAME_PHASES } from "./collector-host.ts";
import { envCandidates, loadDesktopConfig, riotIdText, type DesktopConfig } from "./config.ts";
import { buildDraftView, type DraftView } from "./draft-view.ts";
import { readMyGames, readMyMastery } from "./stats/read.ts";
import { readMeta, readMetaMastery, readMetaPatches } from "./meta/read.ts";
import { recommend } from "./reco/recommend.ts";
import { draftPicks, pairIndex, type DraftPicks, type PairIndex } from "./reco/draft-pick.ts";
import type { DraftSnapshot } from "./champ-select.ts";
import { metaStats } from "./meta/meta-stats.ts";
import type { MetaView, RecoView } from "./ipc.ts";
import { findChamp } from "../src/data/champions";
import { IPC, type AppState } from "./ipc.ts";
import { LiveWatcher, type LiveSnapshot } from "./live-client.ts";
import { buildOverlayView, type OverlayView } from "./next-item.ts";
import { OverlayWindow } from "./overlay-window.ts";
import { DEFAULT_SHORTCUTS, displayAccelerator, isValidAccelerator, type ShortcutName } from "./shortcuts.ts";
import { loadSettings, parseWindowMode, saveSettings, type Settings, type WindowMode } from "./settings.ts";

/** Lancé par Windows à l'ouverture de session : on reste discret dans la zone de notification. */
const HIDDEN_ARG = "--hidden";
const dev = !app.isPackaged;
const here = __dirname; // desktop/dist une fois compilé
/** Identifiant Windows de l'appli (barre des tâches, notifications) : identique à appId dans package.json. */
const APP_ID = "io.github.kayn-sim";
/**
 * Nom de l'entrée « démarrage » dans HKCU\Software\Microsoft\Windows\CurrentVersion\Run.
 * Fixe, pour que le désinstalleur puisse la retirer (desktop/installer.nsh).
 */
const LOGIN_ITEM_NAME = "KaynSim";

// Dossier des réglages et du .env : %APPDATA%\kayn-sim, en développement comme une fois installée
// (sans cela, Electron le nommerait d'après le nom affiché de l'appli).
app.setPath("userData", join(app.getPath("appData"), "kayn-sim"));

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let config: DesktopConfig;
let quitting = false;
let draft: DraftView | null = null;
let draftAt = 0;
let prevPhase = "";
/** Phases après lesquelles la dernière draft n'a plus d'intérêt. */
const CLEAR_DRAFT = new Set(["None", "Lobby", "Matchmaking", "ReadyCheck"]);

let settings: Settings;
let settingsFile = "";
let liveSnap: LiveSnapshot | null = null;
let liveView: OverlayView | null = null;
let windowMode: WindowMode = "unknown";
let overlay: OverlayWindow;
let collector: CollectorHost;

/** Champions exclus (réglage), en clés numériques Riot. */
function excludedKeys(): number[] {
  return settings.excludedChampions.map((id) => findChamp(id)?.key).filter((k): k is number => k != null);
}

/** (Re)configure la collecte : clé et comptes du .env, pause manuelle mémorisée. */
function configureCollector(): void {
  collector.setPaused("user", settings.collectorPaused);
  collector.configure(config.apiKey, config.riotIds.map(riotIdText), excludedKeys());
}

/** Mode d'affichage du jeu, lu dans Config\game.cfg (simple lecture de fichier). */
function readWindowMode(): WindowMode {
  const dir = watcher.installDir;
  if (!dir) return "unknown";
  try { return parseWindowMode(readFileSync(join(dir, "Config", "game.cfg"), "utf8")); } catch { return "unknown"; }
}

function updateLive(): void {
  liveView = liveSnap ? buildOverlayView(liveSnap, settings.formChoice) : null;
  overlay.update(liveView);
  pushState();
}

const live = new LiveWatcher((snap) => {
  if (snap && !liveSnap) windowMode = readWindowMode();
  liveSnap = snap;
  updateLive();
});

const watcher = new ClientWatcher(
  () => config?.riotIds ?? [],
  (s) => {
    const phase = s.kind === "connected" ? s.phase : "";
    if (phase === "ChampSelect" && prevPhase !== "ChampSelect") {
      draft = null;
      // Fenêtre affichée sans prendre le focus : le client LoL garde le clavier.
      showWindow(false);
    }
    if (s.kind === "closed" || CLEAR_DRAFT.has(phase)) draft = null;
    if (phase !== prevPhase) windowMode = readWindowMode();
    prevPhase = phase;
    // Pause de la collecte du chargement à la fin de la partie : rien ne doit gêner le jeu.
    collector?.setPaused("game", GAME_PHASES.has(phase));
    pushState();
    if (tray) tray.setToolTip(s.kind === "connected" ? `Kayn Sim · ${s.phaseLabel}` : "Kayn Sim · client LoL fermé");
  },
  (snap) => {
    draft = buildDraftView(snap);
    draft.picks = safePicks(snap);
    draftAt = Date.now();
    pushState();
  },
);

function readConfig(): DesktopConfig {
  const userData = app.getPath("userData");
  mkdirSync(userData, { recursive: true });
  return loadDesktopConfig(envCandidates(dev ? app.getAppPath() : null, userData));
}

/** Arguments passés à Windows pour le démarrage automatique (en dev : electron.exe + chemin du dépôt). */
function loginArgs(): string[] {
  return dev ? [resolve(app.getAppPath()), HIDDEN_ARG] : [HIDDEN_ARG];
}

function openAtLogin(): boolean {
  const s = app.getLoginItemSettings({ args: loginArgs() });
  // Notre entrée (nom fixe), active : désactivée dans le Gestionnaire des tâches → décochée ici aussi.
  return s.launchItems?.some((i) => i.name === LOGIN_ITEM_NAME && i.enabled) ?? s.openAtLogin;
}

function setOpenAtLogin(on: boolean): void {
  app.setLoginItemSettings({ openAtLogin: on, args: loginArgs(), name: LOGIN_ITEM_NAME });
  refreshTrayMenu();
}

function state(): AppState {
  return {
    client: watcher.status,
    live: {
      inGame: !!liveSnap,
      view: liveView,
      overlayEnabled: settings.overlay.enabled,
      overlayVisible: overlay?.visible ?? false,
      overlayMoving: overlay?.moving ?? false,
      hiddenByUser: overlay?.hiddenByUser ?? false,
      formChoice: settings.formChoice,
      windowMode,
      shortcuts: {
        toggle: { accelerator: settings.shortcuts.toggle, label: displayAccelerator(settings.shortcuts.toggle), status: overlay?.shortcutStatus.toggle ?? "unknown" },
        move: { accelerator: settings.shortcuts.move, label: displayAccelerator(settings.shortcuts.move), status: overlay?.shortcutStatus.move ?? "unknown" },
      },
    },
    draft,
    draftLive: watcher.status.kind === "connected" && watcher.status.phase === "ChampSelect",
    draftAt,
    version: app.getVersion(),
    envFile: config.envFile,
    searched: config.searched,
    riotId: config.riotId ? riotIdText(config.riotId) : null,
    riotIds: config.riotIds.map(riotIdText),
    hasApiKey: !!config.apiKey,
    collector: collector?.state ?? { kind: "off", reason: "no-key" },
    collectorPaused: settings?.collectorPaused ?? false,
    excludedChampions: settings?.excludedChampions ?? [],
    problems: config.problems,
    openAtLogin: openAtLogin(),
    dev,
  };
}

function pushState(): void {
  if (!win && !statsWin) return;
  const s = state();
  win?.webContents.send(IPC.state, s);
  statsWin?.webContents.send(IPC.state, s);
}

let statsWin: BrowserWindow | null = null;
let metaWin: BrowserWindow | null = null;
let recoWin: BrowserWindow | null = null;
const dbFile = () => join(app.getPath("userData"), "riot.db");

/** Fenêtre d'outil (« Mes stats », « Méta ») : une seule de chaque, ré-affichée si déjà ouverte. */
function toolWindow(existing: BrowserWindow | null, title: string, page: string, width: number, onClosed: () => void): BrowserWindow {
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return existing;
  }
  const w = new BrowserWindow({
    width,
    height: 720,
    minWidth: 640,
    minHeight: 400,
    title,
    icon: join(here, "icon.png"),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#14141c",
    webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  w.removeMenu();
  w.on("closed", onClosed);
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  void w.loadFile(join(here, page));
  w.once("ready-to-show", () => w.show());
  return w;
}

function showStatsWindow(): void {
  statsWin = toolWindow(statsWin, "Kayn Sim · Mes stats", "stats-window/index.html", 1080, () => { statsWin = null; });
}

function showMetaWindow(): void {
  metaWin = toolWindow(metaWin, "Kayn Sim · Méta", "meta-window/index.html", 1240, () => { metaWin = null; });
}

function showRecoWindow(): void {
  recoWin = toolWindow(recoWin, "Kayn Sim · Champions recommandés", "reco-window/index.html", 1180, () => { recoWin = null; });
}

/** Patchs de méta pour les recommandations : les 2 derniers (équilibrage actuel, assez de parties). */
const RECO_PATCHES = 2;
let recoCache: { at: number; key: string; view: RecoView } | null = null;
function getRecoView(): RecoView {
  const excluded = excludedKeys();
  const key = excluded.join(",");
  if (recoCache && recoCache.key === key && Date.now() - recoCache.at < 60_000) return recoCache.view;
  const patches = readMetaPatches(dbFile()).slice(0, RECO_PATCHES).map((p) => p.patch);
  const input = readMeta(dbFile(), patches);
  const view: RecoView = {
    ...recommend({ myGames: readMyGames(dbFile()), meta: metaStats(input), metaParts: input.parts, mastery: readMetaMastery(dbFile()), metaMatches: input.matches, excluded, myMastery: readMyMastery(dbFile()) }),
    patches,
  };
  recoCache = { at: Date.now(), key, view };
  return view;
}

/** Duels et associations (3 derniers patchs : plus de parties), gardés 10 minutes. */
let pairCache: { at: number; index: PairIndex } | null = null;
function getPairIndex(): PairIndex {
  if (pairCache && Date.now() - pairCache.at < 10 * 60_000) return pairCache.index;
  const patches = readMetaPatches(dbFile()).slice(0, 3).map((p) => p.patch);
  pairCache = { at: Date.now(), index: pairIndex(readMeta(dbFile(), patches).parts) };
  return pairCache.index;
}

const DRAFT_ROLES: Record<string, string> = { jungle: "JUNGLE", middle: "MIDDLE" };

/** Tes meilleurs choix pour cette draft (jungle ou milieu seulement) ; jamais d'erreur bloquante pour la draft. */
let picksMemo: { key: string; at: number; value: DraftPicks | null } | null = null;
function safePicks(snap: DraftSnapshot): DraftPicks | null {
  const role = DRAFT_ROLES[snap.me.position];
  if (!role) return null;
  // Le client envoie la session très souvent : on ne recalcule que si la draft a changé (ou après 1 min).
  const key = JSON.stringify([role, snap.myTurn, snap.allies.map((a) => a.championId), snap.enemies.map((e) => e.championId), snap.unavailable]);
  if (picksMemo && picksMemo.key === key && Date.now() - picksMemo.at < 60_000) return picksMemo.value;
  const value = computePicks(snap, role);
  picksMemo = { key, at: Date.now(), value };
  return value;
}

function computePicks(snap: DraftSnapshot, role: string): DraftPicks | null {
  try {
    const reco = getRecoView();
    const r = reco.roles.find((x) => x.role === role);
    if (!r) return null;
    return draftPicks({
      role,
      myTurn: snap.myTurn,
      allies: snap.allies.map((a) => a.championId).filter(Boolean),
      enemies: snap.enemies.map((e) => e.championId).filter(Boolean),
      unavailable: snap.unavailable,
      excluded: excludedKeys(),
      pool: r.pool,
      meta: getMetaView(RECO_PATCHES).champions,
      index: getPairIndex(),
      provisional: reco.provisional,
    });
  } catch (e) {
    console.error("Choix de draft :", e);
    return null;
  }
}

/** Méta calculée, gardée une minute (le calcul relit toute la base). */
const metaCache = new Map<number, { at: number; view: MetaView }>();
function getMetaView(scope: number): MetaView {
  const n = Math.min(3, Math.max(1, Math.trunc(scope) || 1));
  const hit = metaCache.get(n);
  if (hit && Date.now() - hit.at < 60_000) return hit.view;
  const patches = readMetaPatches(dbFile());
  const selected = patches.slice(0, n).map((p) => p.patch);
  const input = readMeta(dbFile(), selected);
  const view: MetaView = { patches, selected, matches: input.matches, champions: metaStats(input) };
  metaCache.set(n, { at: Date.now(), view });
  return view;
}

function showWindow(focus = true): void {
  if (!win) {
    win = new BrowserWindow({
      width: 460,
      height: 720,
      minWidth: 380,
      minHeight: 420,
      title: "Kayn Sim",
      icon: join(here, "icon.png"),
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#14141c",
      webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.removeMenu();
    // Fermer la fenêtre la cache seulement : l'appli reste dans la zone de notification.
    win.on("close", (e) => { if (!quitting) { e.preventDefault(); win?.hide(); } });
    win.on("closed", () => { win = null; });
    // Liens externes : navigateur par défaut, jamais dans l'appli.
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: "deny" }; });
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    void win.loadFile(join(here, "renderer", "index.html"));
    win.once("ready-to-show", () => (focus ? win?.show() : win?.showInactive()));
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!focus) { if (!win.isVisible()) win.showInactive(); return; }
  win.show();
  win.focus();
}

function refreshTrayMenu(): void {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Ouvrir Kayn Sim", click: () => showWindow() },
    { label: "Mes stats", click: () => showStatsWindow() },
    { label: "Méta", click: () => showMetaWindow() },
    { label: "Champions recommandés", click: () => showRecoWindow() },
    { type: "separator" },
    {
      label: `Masquer / afficher l'overlay (${displayAccelerator(settings.shortcuts.toggle)})`,
      enabled: !!overlay?.isInGame && settings.overlay.enabled,
      click: () => overlay.toggleVisible(),
    },
    { label: "Overlay en jeu", type: "checkbox", checked: settings.overlay.enabled, click: (item) => setOverlayEnabled(item.checked) },
    { label: "Lancer au démarrage de Windows", type: "checkbox", checked: openAtLogin(), click: (item) => { setOpenAtLogin(item.checked); pushState(); } },
    { type: "separator" },
    { label: "Quitter", click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(here, "icon.png")).resize({ width: 16, height: 16, quality: "best" });
  tray = new Tray(icon);
  tray.setToolTip("Kayn Sim");
  tray.on("click", () => showWindow());
  refreshTrayMenu();
}

function setOverlayEnabled(on: boolean): void {
  settings.overlay.enabled = on;
  saveSettings(settingsFile, settings);
  overlay.setEnabled(on);
  refreshTrayMenu();
  pushState();
}

function registerIpc(): void {
  ipcMain.handle(IPC.setOverlayEnabled, (_e, on: unknown) => { setOverlayEnabled(on === true); return state(); });
  ipcMain.handle(IPC.setFormChoice, (_e, f: unknown) => {
    settings.formChoice = f === "blue" || f === "red" ? f : "auto";
    saveSettings(settingsFile, settings);
    updateLive();
    return state();
  });
  ipcMain.handle(IPC.resetOverlayPosition, () => { overlay.resetPosition(); return state(); });
  ipcMain.handle(IPC.setCapturing, (_e, on: unknown) => overlay.setCapturing(on === true));
  ipcMain.handle(IPC.setShortcut, (_e, name: unknown, acc: unknown) => {
    if (name !== "toggle" && name !== "move") return { state: state(), error: "Raccourci inconnu." };
    const value = acc === null ? DEFAULT_SHORTCUTS[name] : acc;
    if (!isValidAccelerator(value)) return { state: state(), error: "Combinaison non prise en charge : Ctrl, Alt et/ou Maj + une lettre, un chiffre ou F1–F24." };
    const other: ShortcutName = name === "toggle" ? "move" : "toggle";
    if (settings.shortcuts[other] === value) return { state: state(), error: "Cette combinaison est déjà utilisée par l'autre raccourci." };
    settings.shortcuts[name] = value;
    saveSettings(settingsFile, settings);
    overlay.applyShortcuts();
    refreshTrayMenu();
    const taken = overlay.shortcutStatus[name] === "taken";
    return { state: state(), error: taken ? `${displayAccelerator(value)} est déjà pris par une autre application : choisis-en un autre.` : null };
  });
  ipcMain.handle(IPC.getState, () => state());
  ipcMain.handle(IPC.setOpenAtLogin, (_e, on: unknown) => { setOpenAtLogin(on === true); return state(); });
  ipcMain.handle(IPC.reloadConfig, () => { config = readConfig(); watcher.refresh(); configureCollector(); return state(); });
  ipcMain.handle(IPC.getMyGames, () => readMyGames(dbFile()));
  ipcMain.handle(IPC.openStatsWindow, () => showStatsWindow());
  ipcMain.handle(IPC.openMetaWindow, () => showMetaWindow());
  ipcMain.handle(IPC.getMeta, (_e, scope: unknown) => getMetaView(Number(scope)));
  ipcMain.handle(IPC.openRecoWindow, () => showRecoWindow());
  ipcMain.handle(IPC.getRecommendations, () => getRecoView());
  ipcMain.handle(IPC.setExcludedChampions, (_e, ids: unknown) => {
    // Seulement des champions qui existent (identifiants Data Dragon).
    settings.excludedChampions = Array.isArray(ids) ? [...new Set(ids.filter((x): x is string => typeof x === "string" && !!findChamp(x)?.id))] : settings.excludedChampions;
    saveSettings(settingsFile, settings);
    configureCollector(); // le pool suivi dans la méta change
    pushState();
    return state();
  });
  ipcMain.handle(IPC.setCollectorPaused, (_e, on: unknown) => {
    settings.collectorPaused = on === true;
    saveSettings(settingsFile, settings);
    collector.setPaused("user", settings.collectorPaused);
    return state();
  });
  ipcMain.handle(IPC.openUserDataDir, async () => { await shell.openPath(app.getPath("userData")); });
  ipcMain.handle(IPC.openDraftInSimulator, async () => {
    if (draft) await shell.openExternal(`${config.siteUrl.replace(/#.*$/, "")}#${draft.link}`);
  });
}

// Une seule instance : relancer l'appli ré-affiche simplement la fenêtre.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.setAppUserModelId(APP_ID);
  app.whenReady().then(() => {
    config = readConfig();
    settingsFile = join(app.getPath("userData"), "settings.json");
    settings = loadSettings(settingsFile);
    overlay = new OverlayWindow({
      dir: here,
      position: () => settings.overlay,
      savePosition: (x, y) => { settings.overlay.x = x; settings.overlay.y = y; saveSettings(settingsFile, settings); },
      shortcuts: () => settings.shortcuts,
      onChange: () => { pushState(); refreshTrayMenu(); },
    });
    overlay.enabled = settings.overlay.enabled;
    collector = new CollectorHost(here, dbFile(), pushState);
    configureCollector();
    registerIpc();
    createTray();
    overlay.applyShortcuts(); // diagnostic immédiat : raccourcis libres ou déjà pris
    watcher.start();
    live.start();
    if (!process.argv.includes(HIDDEN_ARG)) showWindow();
  });
  // Toutes les fenêtres fermées : on reste dans la zone de notification.
  app.on("window-all-closed", () => { /* rien */ });
  app.on("before-quit", () => { quitting = true; watcher.stop(); live.stop(); overlay?.destroy(); collector?.stop(); });
  app.on("will-quit", () => globalShortcut.unregisterAll());
}
