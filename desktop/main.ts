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
import { readGankData, readMeta, readMetaMastery, readMetaPatches } from "./meta/read.ts";
import { recommend } from "./reco/recommend.ts";
import { draftPicks, pairIndex, type DraftPicks, type PairIndex } from "./reco/draft-pick.ts";
import type { DraftSnapshot } from "./champ-select.ts";
import { guidePage, metaPage, type RecommendedPage } from "./runes/rune-page.ts";
import { laneRows, roleShares, type Lane, type LaneRow, type RoleShares } from "./reco/lanes.ts";
import type { ChampLite } from "./draft-view.ts";
import { importRunePage, lcuPerks } from "./runes/import.ts";
import type { LcuCredentials } from "./lcu.ts";
import { champByKey } from "../src/data/champions";
import { metaStats } from "./meta/meta-stats.ts";
import type { MetaView, RecoView } from "./ipc.ts";
import { findChamp } from "../src/data/champions";
import { IPC, type AppState } from "./ipc.ts";
import { LiveWatcher, type LiveSnapshot } from "./live-client.ts";
import { buildOverlayView, type OverlayView } from "./next-item.ts";
import { pregameTips, tipsAt } from "./coach/pregame.ts";
import { statBuild, type StatBuild } from "./coach/stat-build.ts";
import { readEnemyItems, SHOP } from "./next-item.ts";
import { gamePlan, planTips, type GamePlan } from "./coach/game-plan.ts";
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

function updateLive(): void {
  liveView = liveSnap ? buildOverlayView(liveSnap, settings.formChoice, SHOP, liveStatBuild(liveSnap)) : null;
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
    prevPhase = phase;
    // Pause de la collecte du chargement à la fin de la partie : rien ne doit gêner le jeu.
    collector?.setPaused("game", GAME_PHASES.has(phase));
    pushState();
    // Fin de partie : Riot publie la partie après quelques minutes ; on la cherche à 2 puis 6 minutes.
    if (phase === "EndOfGame" && prevPhase !== "EndOfGame") {
      for (const ms of [2 * 60_000, 6 * 60_000]) setTimeout(() => collector?.checkNewGames(), ms).unref?.();
    }
    if (tray) tray.setToolTip(s.kind === "connected" ? `Kayn Sim · ${s.phaseLabel}` : "Kayn Sim · client LoL fermé");
  },
  (snap) => {
    draft = buildDraftView(snap);
    draft.lanes = safeLanes(snap, draft);
    draft.picks = safePicks(snap, draft.lanes);
    draft.runePage = safeRunePage(snap, draft);
    draftAt = Date.now();
    draft.plan = safePlan(snap, draft);
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
const ALL_ROLES: Record<string, string> = { top: "TOP", jungle: "JUNGLE", middle: "MIDDLE", bottom: "BOTTOM", utility: "UTILITY" };

let lcuCreds: LcuCredentials | null = null;

/** Méta des patchs récents (runes, rôles, builds), gardée 5 minutes. */
let metaInputCache: { at: number; input: ReturnType<typeof readMeta> } | null = null;
function recentMeta(): ReturnType<typeof readMeta> {
  if (metaInputCache && Date.now() - metaInputCache.at < 5 * 60_000) return metaInputCache.input;
  metaInputCache = { at: Date.now(), input: readMeta(dbFile(), readMetaPatches(dbFile()).slice(0, RECO_PATCHES).map((p) => p.patch)) };
  return metaInputCache.input;
}
const recentParts = () => recentMeta().parts;

/** Build statistique de ton champion (autre que Kayn) pour la partie en cours ; recalculé si la situation change. */
let statMemo: { key: string; value: StatBuild | null } | null = null;
function liveStatBuild(snap: LiveSnapshot): StatBuild | null {
  const ch = snap.me.champion ? findChamp(snap.me.champion) : undefined;
  if (!ch?.key || ch.id === "Kayn") return null;
  const enemies = snap.enemies.map((e) => (e.champion ? findChamp(e.champion) ?? null : null));
  const enemyItems = readEnemyItems(snap.enemies, enemies, SHOP);
  // Rôle : celui de la draft de cette partie, sinon le rôle le plus joué du champion dans la méta.
  const fromDraft = draft && Date.now() - draftAt < DRAFT_MAX_AGE ? ALL_ROLES[draft.me.position] : undefined;
  const key = [ch.key, fromDraft, enemies.map((e) => e?.id).join(","), enemyItems.healers, enemyItems.adShare == null ? "-" : Math.round(enemyItems.adShare * 10)].join("|");
  if (statMemo?.key === key) return statMemo.value;
  let value: StatBuild | null = null;
  try {
    const meta = recentMeta();
    const rows = meta.parts.filter((p) => p.championId === ch.key);
    let role = fromDraft;
    if (!role || rows.filter((r) => r.role === role).length < 20) {
      const counts = new Map<string, number>();
      for (const r of rows) if (r.role) counts.set(r.role, (counts.get(r.role) ?? 0) + 1);
      role = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    if (role) {
      value = statBuild({
        parts: rows.filter((r) => r.role === role),
        builds: meta.builds.filter((b) => b.championId === ch.key && b.role === role),
        role, enemies, enemyItems, shop: SHOP,
      });
    }
  } catch (e) {
    console.error("Build statistique :", e);
  }
  statMemo = { key, value };
  return value;
}

/**
 * Page de runes du champion survolé ou verrouillé : guide pour Kayn (forme recommandée connue),
 * sinon la méta Émeraude+ récente dans ton rôle (ou son rôle le plus joué).
 */
function safeRunePage(snap: DraftSnapshot, view: DraftView): (RecommendedPage & { championName: string }) | null {
  const id = snap.me.championId || snap.me.intentId;
  const ch = id ? champByKey(id) : undefined;
  if (!ch) return null;
  try {
    if (view.isKayn && view.form) {
      const g = guidePage(view.form.value);
      if (g) return { ...g, championName: ch.name };
    }
    const rows = recentParts().filter((p) => p.championId === id);
    let role = ALL_ROLES[snap.me.position];
    if (!role || rows.filter((r) => r.role === role).length < 20) {
      const counts = new Map<string, number>();
      for (const r of rows) if (r.role) counts.set(r.role, (counts.get(r.role) ?? 0) + 1);
      role = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? role;
    }
    const page = metaPage(rows.filter((r) => r.role === role), ch.nameEn ?? ch.name);
    return page ? { ...page, championName: ch.name } : null;
  } catch (e) {
    console.error("Page de runes :", e);
    return null;
  }
}

/** Tes meilleurs choix pour cette draft (jungle ou milieu seulement) ; jamais d'erreur bloquante pour la draft. */
/** Parties par rôle de chaque champion (méta récente), gardées avec les lignes de méta. */
let sharesCache: { parts: unknown; shares: RoleShares } | null = null;
/** Kills de début de partie (3 derniers patchs), gardés 10 minutes. */
let gankCache: { at: number; data: ReturnType<typeof readGankData> } | null = null;
function getGankData(): ReturnType<typeof readGankData> {
  if (gankCache && Date.now() - gankCache.at < 10 * 60_000) return gankCache.data;
  gankCache = { at: Date.now(), data: readGankData(dbFile(), readMetaPatches(dbFile()).slice(0, 3).map((p) => p.patch)) };
  return gankCache.data;
}

/**
 * Plan d'avant-partie : seulement en jungle, une fois tes 4 alliés et les 5 adversaires connus et ton champion
 * verrouillé. Calculé une fois par draft (il ne change plus ensuite).
 */
let planMemo: { key: string; value: GamePlan | null } | null = null;
function safePlan(snap: DraftSnapshot, view: DraftView): GamePlan | null {
  if (!view.lanes || !snap.me.championId || snap.me.position !== "jungle") return null;
  if (snap.enemies.filter((e) => e.championId).length < 5 || snap.allies.filter((a) => a.championId).length < 4) return null;
  const key = JSON.stringify([snap.me.championId, snap.side, snap.allies.map((a) => a.championId), snap.enemies.map((e) => e.championId)]);
  if (planMemo?.key === key) return planMemo.value;
  let value: GamePlan | null = null;
  try {
    const data = getGankData();
    value = gamePlan({ meChampion: snap.me.championId, side: snap.side, lanes: view.lanes, kills: data.kills, parts: data.parts, index: getPairIndex() });
  } catch (e) {
    console.error("Plan d'avant-partie :", e);
  }
  planMemo = { key, value };
  return value;
}

function getRoleShares(): RoleShares {
  const parts = recentParts();
  if (sharesCache?.parts !== parts) sharesCache = { parts, shares: roleShares(parts) };
  return sharesCache.shares;
}

/** Les deux équipes rangées par rôle (rôles adverses probables d'après la méta). */
function safeLanes(snap: DraftSnapshot, view: DraftView): LaneRow<ChampLite>[] | null {
  try {
    const allies = [
      { champ: view.me.champion, position: snap.me.position, me: true },
      ...snap.allies.slice(0, 4).map((a, i) => ({ champ: view.allies[i], position: a.position })),
    ];
    const enemies = snap.enemies.slice(0, 5).flatMap((e, i) => (e.championId && view.enemies[i] ? [{ id: e.championId, champ: view.enemies[i]! }] : []));
    return laneRows(allies, enemies, getRoleShares());
  } catch (e) {
    console.error("Rôles de la draft :", e);
    return null;
  }
}

let picksMemo: { key: string; at: number; value: DraftPicks | null } | null = null;
function safePicks(snap: DraftSnapshot, lanes: LaneRow<ChampLite>[] | null): DraftPicks | null {
  const role = DRAFT_ROLES[snap.me.position];
  if (!role) return null;
  // Le client envoie la session très souvent : on ne recalcule que si la draft a changé (ou après 1 min).
  const key = JSON.stringify([role, snap.myTurn, snap.allies.map((a) => a.championId), snap.enemies.map((e) => e.championId), snap.unavailable]);
  if (picksMemo && picksMemo.key === key && Date.now() - picksMemo.at < 60_000) return picksMemo.value;
  const enemyLanes = new Map<number, Lane>();
  snap.enemies.forEach((e) => {
    const row = lanes?.find((r) => r.enemy && view_id(r.enemy) === e.championId);
    if (row && e.championId) enemyLanes.set(e.championId, row.lane);
  });
  const value = computePicks(snap, role, enemyLanes);
  picksMemo = { key, at: Date.now(), value };
  return value;
}

/** Clé numérique d'un champion de la vue (identifiant Data Dragon). */
const view_id = (c: ChampLite): number => findChamp(c.id)?.key ?? 0;

function computePicks(snap: DraftSnapshot, role: string, enemyLanes: Map<number, Lane>): DraftPicks | null {
  try {
    const reco = getRecoView();
    const r = reco.roles.find((x) => x.role === role);
    if (!r) return null;
    return draftPicks({
      role,
      myTurn: snap.myTurn,
      allies: snap.allies.map((a) => a.championId).filter(Boolean),
      enemies: snap.enemies.map((e) => e.championId).filter(Boolean),
      enemyLanes,
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
  ipcMain.handle(IPC.getMyGames, () => readMyGames(dbFile()));
  ipcMain.handle(IPC.openStatsWindow, () => showStatsWindow());
  ipcMain.handle(IPC.openMetaWindow, () => showMetaWindow());
  ipcMain.handle(IPC.getMeta, (_e, scope: unknown) => getMetaView(Number(scope)));
  ipcMain.handle(IPC.openRecoWindow, () => showRecoWindow());
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
