// Processus principal de l'application de bureau : icône dans la zone de notification, fenêtre d'état,
// lancement au démarrage. Aucune console : en version installée, rien ne s'affiche hors de nos fenêtres.
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ClientWatcher } from "./client-watch.ts";
import { CollectorHost, GAME_PHASES } from "./collector-host.ts";
import { envCandidates, loadDesktopConfig, riotIdText, type DesktopConfig } from "./config.ts";
import { buildDraftView, type DraftView } from "./draft-view.ts";
import type { DraftSnapshot } from "./champ-select.ts";
import { importRunePage, lcuPerks } from "./runes/import.ts";
import type { LcuCredentials } from "./lcu.ts";
import type { OverviewFilter } from "./analysis/overview.ts";
import { DEFAULT_GOALS, type GoalsView } from "./analysis/goals.ts";
import type { StatBuild } from "./coach/stat-build.ts";
import { EngineClient } from "./data/engine-client.ts";
import { findChamp } from "../src/data/champions";
import { IPC, type AppState } from "./ipc.ts";
import { LiveWatcher, type LiveSnapshot } from "./live-client.ts";
import { buildOverlayView, type OverlayView } from "./next-item.ts";
import { pregameTips, tipsAt } from "./coach/pregame.ts";
import { planTips } from "./coach/game-plan.ts";
import { SHOP } from "./next-item.ts";
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
// KAYN_SIM_USER_DATA : dossier de données de test (développement) ; sinon %APPDATA%kayn-sim.
app.setPath("userData", process.env.KAYN_SIM_USER_DATA || join(app.getPath("appData"), "kayn-sim"));

/** KAYN_SIM_PROFILE=1 : temps de chaque appel IPC et taille de la réponse, dans la console (développement). */
const PROFILE = process.env.KAYN_SIM_PROFILE === "1";
if (PROFILE) {
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel: string, fn: Parameters<typeof ipcMain.handle>[1]) => handle(channel, async (e, ...args) => {
    const t0 = performance.now();
    const r = await fn(e, ...args);
    const ms = performance.now() - t0;
    const kb = r === undefined ? 0 : Buffer.byteLength(JSON.stringify(r)) / 1024;
    console.log(`[ipc] ${channel} ${ms.toFixed(0)} ms, ${kb.toFixed(0)} Ko`);
    return r;
  });
}
if (PROFILE) {
  // Blocages du processus principal (la fenêtre se fige pendant ce temps) : retard d'un minuteur de 50 ms.
  let last = performance.now();
  setInterval(() => {
    const now = performance.now(), lag = now - last - 50;
    if (lag > 100) console.log(`[blocage] processus principal bloqué ${lag.toFixed(0)} ms`);
    last = now;
  }, 50).unref();
}

const dbFile = () => join(app.getPath("userData"), "riot.db");
/** Moteur de données dans un worker : tous les calculs lourds (analyse, recommandations, méta, draft). */
const engine = new EngineClient(join(__dirname, "engine-worker.cjs"), dbFile(), PROFILE ? (l) => console.log(l) : null);
let lcuCreds: LcuCredentials | null = null;
const ALL_ROLES_POS = new Set(["top", "jungle", "middle", "bottom", "utility"]);

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let config: DesktopConfig;
let quitting = false;
let draft: DraftView | null = null;
let draftAt = 0;
/** Numéro de la dernière demande de compléments de draft (les réponses plus anciennes sont ignorées). */
let draftSeq = 0;
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

/** Conseils d'avant-partie de la partie en cours, et début de leur affichage. */
let coach: { tips: string[]; start: number } | null = null;
let coachTimer: NodeJS.Timeout | null = null;
/** Une draft de plus de 15 minutes n'est pas celle de cette partie. */
const DRAFT_MAX_AGE = 15 * 60_000;

function startCoach(): void {
  coach = null;
  if (!settings.overlay.tips || !draft?.lanes || Date.now() - draftAt > DRAFT_MAX_AGE) return;
  const form = draft.isKayn ? (settings.formChoice !== "auto" ? settings.formChoice : draft.form?.value ?? null) : null;
  // Plan d'avant-partie d'abord (jungle), puis les autres conseils : 6 au plus, deux à la fois.
  const tips = [...(draft.plan ? planTips(draft.plan) : []), ...pregameTips({ lanes: draft.lanes, form })].slice(0, 6);
  if (!tips.length) return;
  coach = { tips, start: Date.now() };
  // Défilement : on ne renvoie la vue que quand la paire affichée change.
  let shown = "";
  coachTimer = setInterval(() => {
    const now = coach ? tipsAt(coach.tips, Date.now() - coach.start) : [];
    if (now.join("|") !== shown) { shown = now.join("|"); updateLive(); }
    if (!now.length) stopCoach();
  }, 1000);
}

function stopCoach(): void {
  if (coachTimer) clearInterval(coachTimer);
  coachTimer = null;
  coach = null;
}

/** Build statistique (autre champion que Kayn) : demandé au moteur quand la situation change, la vue suit. */
let stat: { key: string; value: StatBuild | null } = { key: "", value: null };
function requestStatBuild(snap: LiveSnapshot): void {
  const pos = draft && Date.now() - draftAt < DRAFT_MAX_AGE && ALL_ROLES_POS.has(draft.me.position) ? draft.me.position : null;
  const key = JSON.stringify([snap.me.champion, pos, snap.enemies]);
  if (key === stat.key) return;
  stat = { key, value: stat.value };
  engine.call("statBuild", snap, pos).then((value) => {
    if (stat.key !== key) return;
    stat = { key, value };
    updateLive();
  }).catch((e) => console.error("Build statistique :", e));
}

function updateLive(): void {
  if (liveSnap) requestStatBuild(liveSnap);
  liveView = liveSnap ? buildOverlayView(liveSnap, settings.formChoice, SHOP, stat.value) : null;
  if (liveView && coach && settings.overlay.tips) liveView.tips = tipsAt(coach.tips, Date.now() - coach.start);
  overlay.update(liveView);
  pushState();
}

const live = new LiveWatcher((snap) => {
  if (snap && !liveSnap) { windowMode = readWindowMode(); startCoach(); }
  if (!snap) stopCoach();
  liveSnap = snap;
  updateLive();
});

const watcher = new ClientWatcher(
  () => config?.riotIds ?? [],
  (s, creds) => {
    lcuCreds = creds;
    const phase = s.kind === "connected" ? s.phase : "";
    if (phase === "ChampSelect" && prevPhase !== "ChampSelect") {
      draft = null;
      // Fenêtre affichée sans prendre le focus : le client LoL garde le clavier.
      showWindow(false);
    }
    if (s.kind === "closed" || CLEAR_DRAFT.has(phase)) draft = null;
    if (phase !== prevPhase) windowMode = readWindowMode();
    // Fin de partie : Riot publie la partie après quelques minutes ; on la cherche à 2 puis 6 minutes.
    if (phase === "EndOfGame" && prevPhase !== "EndOfGame") {
      for (const ms of [2 * 60_000, 6 * 60_000]) setTimeout(() => collector?.checkNewGames(), ms).unref?.();
    }
    prevPhase = phase;
    // Pause de la collecte du chargement à la fin de la partie : rien ne doit gêner le jeu.
    collector?.setPaused("game", GAME_PHASES.has(phase));
    pushState();
    if (tray) tray.setToolTip(s.kind === "connected" ? `Kayn Sim · ${s.phaseLabel}` : "Kayn Sim · client LoL fermé");
  },
  (snap) => {
    const view = buildDraftView(snap);
    // En attendant le moteur : les compléments précédents de cette draft (pas de clignotement).
    if (draft) Object.assign(view, { lanes: draft.lanes, picks: draft.picks, plan: draft.plan, runePage: draft.runePage });
    draft = view;
    draftAt = Date.now();
    pushState();
    const seq = ++draftSeq;
    engine.call("draftExtras", snap as DraftSnapshot, view, excludedKeys()).then((x) => {
      if (seq !== draftSeq || draft !== view) return;
      Object.assign(view, x);
      pushState();
    }).catch((e) => console.error("Draft :", e));
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
      tipsEnabled: settings.overlay.tips,
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

const ANY_FILTER: OverviewFilter = { championId: null, role: null, period: { kind: "all" }, account: null };

/** Filtre reçu de la fenêtre, vérifié. */
function cleanFilter(f: unknown): OverviewFilter {
  const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
  const p = (o.period && typeof o.period === "object" ? o.period : {}) as Record<string, unknown>;
  const period: OverviewFilter["period"] = p.kind === "season" && typeof p.season === "number" ? { kind: "season", season: p.season }
    : p.kind === "30d" ? { kind: "30d" } : p.kind === "patch" ? { kind: "patch" } : { kind: "all" };
  return {
    championId: typeof o.championId === "number" ? o.championId : null,
    role: typeof o.role === "string" && /^[A-Z]{3,8}$/.test(o.role) ? o.role : null,
    period,
    account: typeof o.account === "string" ? o.account : null,
  };
}

/** Début du suivi : fixé au premier affichage (début de la journée), puis gardé dans les réglages. */
function getGoalsView(): Promise<GoalsView> {
  if (settings.goals.startMs == null) {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    settings.goals.startMs = d.getTime();
    saveSettings(settingsFile, settings);
  }
  return engine.call("goals", settings.goals.startMs, settings.goals.targets, excludedKeys());
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
  ipcMain.handle(IPC.setTipsEnabled, (_e, on: unknown) => {
    settings.overlay.tips = on === true;
    saveSettings(settingsFile, settings);
    if (!settings.overlay.tips) stopCoach();
    updateLive();
    return state();
  });
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
  ipcMain.handle(IPC.getMyGames, () => engine.call("myGames"));
  ipcMain.handle(IPC.openStatsWindow, () => showStatsWindow());
  ipcMain.handle(IPC.openMetaWindow, () => showMetaWindow());
  ipcMain.handle(IPC.getMeta, (_e, scope: unknown) => engine.call("metaView", Number(scope)));
  ipcMain.handle(IPC.openRecoWindow, () => showRecoWindow());
  ipcMain.handle(IPC.getAnalysis, (_e, key: unknown, filter: unknown) => engine.call("analysis", typeof key === "string" ? key : null, filter ? cleanFilter(filter) : ANY_FILTER, excludedKeys()));
  ipcMain.handle(IPC.getOverview, (_e, filter: unknown, compare: unknown) => engine.call("overview", cleanFilter(filter), typeof compare === "number" ? compare : null, excludedKeys()));
  ipcMain.handle(IPC.getGoals, () => getGoalsView());
  ipcMain.handle(IPC.restartGoals, () => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    settings.goals.startMs = d.getTime();
    saveSettings(settingsFile, settings);
    return getGoalsView();
  });
  ipcMain.handle(IPC.setGoalTarget, (_e, key: unknown, value: unknown) => {
    const known = DEFAULT_GOALS.flatMap((g) => g.metrics.map((m) => m.key));
    if (typeof key === "string" && known.includes(key)) {
      if (typeof value === "number" && Number.isFinite(value)) settings.goals.targets[key] = value;
      else delete settings.goals.targets[key];
      saveSettings(settingsFile, settings);
    }
    return getGoalsView();
  });
  ipcMain.handle(IPC.importRunes, async () => {
    const page = draft?.runePage;
    if (!page) return { ok: false, message: "Pas de page de runes à importer pour l'instant." };
    if (!lcuCreds) return { ok: false, message: "Client LoL non détecté." };
    try {
      return await importRunePage(lcuPerks(lcuCreds), page);
    } catch (e) {
      return { ok: false, message: `Le client a refusé l'import (${e instanceof Error ? e.message : String(e)}).` };
    }
  });
  ipcMain.handle(IPC.getRecommendations, () => engine.call("reco", excludedKeys()));
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
