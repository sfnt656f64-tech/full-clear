// Processus principal de l'application de bureau : icône dans la zone de notification, fenêtre d'état,
// lancement au démarrage. Aucune console : en version installée, rien ne s'affiche hors de nos fenêtres.
import { execFileSync } from "node:child_process";
import { DATA_DIR, LEGACY_DIR, legacyChangedSince, migrateUserData, type MigrationResult } from "./migrate.ts";
import { DEFAULT_REF_TIER, isRefTier } from "./analysis/ref-tier.ts";
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Notification, shell, Tray } from "electron";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
import type { DraftContext } from "./data/engine.ts";
import { journal, openJournal } from "./journal.ts";
import { MAX_PROGRESS } from "./reco/pool-view.ts";
import { ERRORS, pickTheme, themeReview, type ErrorKey } from "./analysis/lesson.ts";
import { champByKey, findChamp } from "../src/data/champions";
import { IPC, type AppState, type Navigation , type ThemeView } from "./ipc.ts";
import { LiveWatcher, type LiveSnapshot } from "./live-client.ts";
import { buildPlanView, type OverlayView , type MatchChampions } from "./next-item.ts";
import { plainPlan, type PlainPlan } from "./coach/plain.ts";
import { SHOP } from "./next-item.ts";
import { OverlayWindow } from "./overlay-window.ts";
import { DEFAULT_SHORTCUTS, displayAccelerator, isValidAccelerator, type ShortcutName } from "./shortcuts.ts";
import { loadSettings, parseWindowMode, saveSettings, type Settings, type WindowMode } from "./settings.ts";

/** Lancé par Windows à l'ouverture de session : on reste discret dans la zone de notification. */
const HIDDEN_ARG = "--hidden";
const dev = !app.isPackaged;
const here = __dirname; // desktop/dist une fois compilé
/**
 * Identifiant Windows de l'appli (barre des tâches, notifications) : identique à appId dans package.json.
 * Inchangé depuis « Kayn Sim » : l'installeur de Full Clear reconnaît ainsi l'ancienne version et la remplace
 * (désinstallation de l'ancienne, raccourcis compris) au lieu d'installer une deuxième appli à côté.
 */
const APP_ID = "io.github.kayn-sim";
/**
 * Nom de l'entrée « démarrage » dans HKCU\Software\Microsoft\Windows\CurrentVersion\Run.
 * Fixe, pour que le désinstalleur puisse la retirer (desktop/installer.nsh).
 */
const LOGIN_ITEM_NAME = "FullClear";
/** Entrée de démarrage de l'ancienne version (« Kayn Sim »), reprise puis retirée au premier lancement. */
const LEGACY_LOGIN_ITEM_NAME = "KaynSim";

// Dossier des réglages, du .env et de la base : %APPDATA%\full-clear, en développement comme une fois installée
// (sans cela, Electron le nommerait d'après le nom affiché de l'appli). Au premier lancement, l'ancien dossier
// %APPDATA%\kayn-sim y est recopié (desktop/migrate.ts) et gardé tel quel ; si la copie échoue, l'appli continue
// sur l'ancien dossier, sans rien perdre.
// FULL_CLEAR_USER_DATA (ou KAYN_SIM_USER_DATA) : dossier de données de test (développement).
// FULL_CLEAR_APPDATA : autre dossier %APPDATA% (test de la reprise, sans toucher au vrai).
if (process.env.FULL_CLEAR_APPDATA) app.setPath("appData", process.env.FULL_CLEAR_APPDATA);
const testData = process.env.FULL_CLEAR_USER_DATA || process.env.KAYN_SIM_USER_DATA;
const migration: MigrationResult = testData ? { status: "none" } : migrateUserData(app.getPath("appData"));
app.setPath("userData", testData || join(app.getPath("appData"), migration.status === "failed" ? LEGACY_DIR : DATA_DIR));

/** FULL_CLEAR_PROFILE=1 : temps de chaque appel IPC et taille de la réponse, dans la console (développement). */
const PROFILE = (process.env.FULL_CLEAR_PROFILE || process.env.KAYN_SIM_PROFILE) === "1";
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

/** Plan de la partie en cours, écrit en draft (vue simple) : affiché tel quel dans l'overlay, rien ne change ensuite. */
let coach: PlainPlan | null = null;
/** Une draft de plus de 15 minutes n'est pas celle de cette partie. */
const DRAFT_MAX_AGE = 15 * 60_000;

function startCoach(): void {
  coach = settings.overlay.tips && draft?.plain && Date.now() - draftAt <= DRAFT_MAX_AGE ? draft.plain : null;
}

function stopCoach(): void {
  coach = null;
}

/** Vue simple du plan de la draft : plan de partie + build (Kayn : modèle ; autres : méta), d'après les champions seulement. */
async function draftPlain(view: DraftView): Promise<PlainPlan | null> {
  const me = view.me.champion?.id ?? null;
  if (!me) return null;
  const m: MatchChampions = { me, allies: view.allies.map((a) => a?.id ?? null), enemies: view.enemies.map((e) => e?.id ?? null) };
  const pos = ALL_ROLES_POS.has(view.me.position) ? view.me.position : null;
  const stat = me === "Kayn" ? null : await engine.call("statBuild", m, pos).catch(() => null);
  const key = findChamp(me)?.key;
  const role = pos ? ROLE_OF_POS[pos] : null;
  const enemyKeys = view.enemies.map((e) => (e ? findChamp(e.id)?.key ?? 0 : 0)).filter(Boolean);
  const situational = key && role ? await engine.call("situational", key, role, enemyKeys).catch(() => []) : [];
  const theme = settings.theme ? { key: settings.theme.key, short: ERRORS[settings.theme.key as ErrorKey]?.short ?? "" } : null;
  return plainPlan(view.strategy ?? null, buildPlanView(m, settings.formChoice, SHOP, stat), theme, situational);
}

/** Champions de la partie (aucune autre donnée du jeu : ni or, ni items, ni événements). */
const championsOf = (snap: LiveSnapshot): MatchChampions => ({ me: snap.me.champion, allies: snap.allies, enemies: snap.enemies.map((e) => e.champion) });

/** Build statistique (autre champion que Kayn) : calculé une fois d'après les champions de la partie. */
let stat: { key: string; value: StatBuild | null } = { key: "", value: null };
function requestStatBuild(snap: LiveSnapshot): void {
  const pos = draft && Date.now() - draftAt < DRAFT_MAX_AGE && ALL_ROLES_POS.has(draft.me.position) ? draft.me.position : null;
  const m = championsOf(snap);
  const key = JSON.stringify([m, pos]);
  if (key === stat.key) return;
  stat = { key, value: stat.value };
  engine.call("statBuild", m, pos).then((value) => {
    if (stat.key !== key) return;
    stat = { key, value };
    updateLive();
  }).catch((e) => console.error("Build statistique :", e));
}

function updateLive(): void {
  if (liveSnap) requestStatBuild(liveSnap);
  liveView = liveSnap ? buildPlanView(championsOf(liveSnap), settings.formChoice, SHOP, stat.value) : null;
  if (liveView && coach && settings.overlay.tips) liveView.plan = coach;
  overlay.update(liveView);
  pushState();
}

/** Partie en cours (champions seulement) ou fin de partie (null). */
function onLive(snap: LiveSnapshot | null): void {
  if (snap && !liveSnap) { windowMode = readWindowMode(); startCoach(); }
  if (!snap) stopCoach();
  liveSnap = snap;
  updateLive();
}
const live = new LiveWatcher(onLive);

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
    if (tray) tray.setToolTip(s.kind === "connected" ? `Full Clear · ${s.phaseLabel}` : "Full Clear · client LoL fermé");
  },
  (snap) => onDraft(snap),
);

/** Nouvelle lecture de la draft : vue immédiate, puis compléments du moteur (rôles, choix, plan de partie, runes). */
function onDraft(snap: DraftSnapshot): void {
    const view = buildDraftView(snap);
    // En attendant le moteur : les compléments précédents de cette draft (pas de clignotement).
    if (draft) Object.assign(view, { lanes: draft.lanes, picks: draft.picks, plan: draft.plan, strategy: draft.strategy, plain: draft.plain, runePage: draft.runePage });
    draft = view;
    draftAt = Date.now();
    pushState();
    const seq = ++draftSeq;
    engine.call("draftExtras", snap as DraftSnapshot, view, excludedKeys(), draftContext()).then((x) => {
      if (seq !== draftSeq || draft !== view) return;
      Object.assign(view, x);
      pushState();
      return draftPlain(view).then((plain) => {
        if (seq !== draftSeq || draft !== view) return;
        view.plain = plain;
        pushState();
      });
    }).catch((e) => console.error("Draft :", e));
}

// FULL_CLEAR_FAKE_LIVE=<fichier JSON> (test seulement) : partie simulée (champions), pour vérifier l'overlay sans jeu ;
// fichier vide ou absent : pas de partie.
if (testData && process.env.FULL_CLEAR_FAKE_LIVE) {
  const file = process.env.FULL_CLEAR_FAKE_LIVE;
  let last = "";
  setInterval(() => {
    let text = "";
    try { text = readFileSync(file, "utf8"); } catch { /* absent : pas de partie */ }
    if (text === last) return;
    last = text;
    try { onLive(text.trim() ? (JSON.parse(text) as LiveSnapshot) : null); } catch { /* en cours d'écriture */ }
  }, 1000).unref?.();
}

// FULL_CLEAR_FAKE_DRAFT=<fichier JSON> (avec un dossier de données de test seulement) : draft simulée, relue quand le
// fichier change, pour vérifier l'onglet Draft sans client LoL.
if (testData && process.env.FULL_CLEAR_FAKE_DRAFT) {
  const file = process.env.FULL_CLEAR_FAKE_DRAFT;
  let last = "";
  setInterval(() => {
    try {
      const text = readFileSync(file, "utf8");
      if (text !== last) { last = text; onDraft(JSON.parse(text) as DraftSnapshot); }
    } catch { /* fichier absent ou en cours d'écriture */ }
  }, 1000).unref?.();
}

/** Analyses d'après-partie des dernières parties (classées, flexibles et normales en draft). */
const postGames = (limit: number) => engine.call("postGames", excludedKeys(), settings.refTier, settings.goals.targets, limit, settings.championFlags, (settings.theme?.key ?? null) as ErrorKey | null);

/**
 * Thème de la semaine : l'erreur personnelle la plus fréquente sur tes 20 dernières parties. Au bout de 7 jours, bilan
 * (avant / pendant, avec la marge), puis nouveau thème.
 */
const WEEK_MS = 7 * 24 * 3600_000;
const ROLE_OF_POS: Record<string, string> = { top: "TOP", jungle: "JUNGLE", middle: "MIDDLE", bottom: "BOTTOM", utility: "UTILITY" };
async function ensureTheme(): Promise<void> {
  const now = Date.now();
  if (settings.theme && now - settings.theme.startMs < WEEK_MS) return;
  if (settings.theme) {
    const t = settings.theme;
    const since = (await engine.call("errorStats", excludedKeys(), Infinity, t.startMs)).find((s) => s.key === t.key);
    if (since) settings.lastReview = { key: t.key, label: since.label, text: themeReview(t.before, since), endMs: now };
  }
  const pick = pickTheme(await engine.call("errorStats", excludedKeys(), Infinity, 0));
  settings.theme = pick ? { key: pick.key, startMs: now, before: { perGame: pick.perGame, margin: pick.margin, games: pick.games } } : null;
  saveSettings(settingsFile, settings);
  journal("thème", pick ? `nouveau thème : ${pick.key}` : "pas encore de thème (moins de 20 parties relues)");
}

/** Thème en cours : l'erreur, l'exercice, des exemples à revoir, la semaine en cours et le bilan précédent. */
async function themeView(): Promise<ThemeView> {
  await ensureTheme().catch((e) => journal("thème", `erreur : ${e instanceof Error ? e.message : String(e)}`));
  const t = settings.theme;
  const recent = await engine.call("errorStats", excludedKeys(), Infinity, 0);
  const cur = t ? recent.find((s) => s.key === t.key) ?? null : null;
  const since = t ? (await engine.call("errorStats", excludedKeys(), Infinity, t.startMs)).find((s) => s.key === t.key) ?? null : null;
  return {
    current: t && cur ? { key: t.key as ErrorKey, label: ERRORS[t.key as ErrorKey].label, short: ERRORS[t.key as ErrorKey].short, exercise: ERRORS[t.key as ErrorKey].exercise, startMs: t.startMs, examples: cur.examples, recent: cur, week: since ? themeReview(t.before, since) : null } : null,
    review: settings.lastReview, all: recent,
  };
}

/**
 * Analyse automatique : dès qu'une nouvelle partie apparaît dans la base (collecte), une notification Windows la
 * signale ; un clic ouvre son analyse dans Progresser. Au premier lancement, la dernière partie est seulement notée.
 * Vérifié au plus toutes les 30 s, quand la collecte avance.
 */
let postGameTimer: NodeJS.Timeout | null = null;
function checkPostGame(): void {
  if (postGameTimer) return;
  postGameTimer = setTimeout(() => {
    postGameTimer = null;
    void ensureTheme().catch(() => {}).then(() => postGames(1)).then(([p]) => {
      if (!p) { journal("analyse", "aucune partie analysable"); return; }
      if (p.matchId === settings.lastPostGame) return;
      const first = settings.lastPostGame == null;
      settings.lastPostGame = p.matchId;
      saveSettings(settingsFile, settings);
      journal("analyse", `nouvelle partie ${p.matchId} (${first ? "premier lancement : pas de notification" : "notification"})`);
      win?.webContents.send(IPC.postGameReady, p.matchId);
      if (first) return;
      if (!Notification.isSupported()) { journal("notification", "non prise en charge par Windows"); return; }
      const name = champByKey(p.championId)?.name ?? "ta partie";
      const n = new Notification({
        title: "Analyse d'après-partie prête",
        body: `${name} · ${p.win ? "victoire" : "défaite"}. Clique pour voir ce que cette partie t'apprend.`,
        silent: true,
      });
      n.on("click", () => { journal("notification", `clic ${p.matchId}`); navigate({ tab: "analysis", hash: `postgame:${p.matchId}` }); });
      n.on("show", () => journal("notification", `affichée ${p.matchId}`));
      // Notification bloquée (réglages Windows, mode « Ne pas déranger » des jeux) : la fenêtre s'ouvre sur l'analyse,
      // sans prendre le focus, et clignote dans la barre des tâches.
      n.on("failed", (_e, err) => {
        journal("notification", `échec ${p.matchId} : ${err} → fenêtre ouverte sur l'analyse`);
        if (overlay?.isInGame) return;
        navigate({ tab: "analysis", hash: `postgame:${p.matchId}` }, false);
        win?.flashFrame(true);
      });
      n.show();
      if (PROFILE) console.log(`[après-partie] notification : ${p.matchId}`);
    }).catch((e) => { journal("analyse", `erreur : ${e instanceof Error ? e.message : String(e)}`); console.error("Analyse d'après-partie :", e); });
  }, 30_000);
  postGameTimer.unref?.();
}

/** Réglages utiles à la draft : mode du pool, drapeaux, référence, objectifs. */
function draftContext(): DraftContext {
  return { goal: settings.poolGoal, flags: settings.championFlags, tier: settings.refTier, goalsStartMs: settings.goals.startMs, targets: settings.goals.targets };
}

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

/**
 * Lancement au démarrage de l'ancienne version (« KaynSim », vers l'ancien exécutable) : retiré, et repris sous le
 * nouveau nom s'il était actif (pas s'il avait été désactivé dans le Gestionnaire des tâches).
 */
function migrateLoginItem(): void {
  // Version installée seulement : une version de développement ou de test ne touche jamais au registre de l'appli
  // installée.
  if (process.platform !== "win32" || dev || testData || process.env.FULL_CLEAR_APPDATA) return;
  const RUN = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  const APPROVED = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
  const reg = (args: string[]) => execFileSync("reg", args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  try { reg(["query", RUN, "/v", LEGACY_LOGIN_ITEM_NAME]); } catch { return; } // pas d'ancienne entrée
  let disabled = false;
  try { disabled = /REG_BINARY\s+03/i.test(reg(["query", APPROVED, "/v", LEGACY_LOGIN_ITEM_NAME])); } catch { /* jamais désactivée */ }
  for (const key of [RUN, APPROVED]) { try { reg(["delete", key, "/v", LEGACY_LOGIN_ITEM_NAME, "/f"]); } catch { /* absente */ } }
  if (!disabled) setOpenAtLogin(true);
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
    refTier: settings?.refTier ?? DEFAULT_REF_TIER,
    poolGoal: settings?.poolGoal ?? "progress",
    championFlags: settings?.championFlags ?? {},
    data: {
      dir: app.getPath("userData"),
      migratedFrom: migration.status === "migrated" ? migration.from : null,
      // Ancien dossier encore présent : à supprimer à la main une fois que tout fonctionne.
      legacyKept: !testData && existsSync(join(app.getPath("appData"), LEGACY_DIR)) && app.getPath("userData") !== join(app.getPath("appData"), LEGACY_DIR) ? join(app.getPath("appData"), LEGACY_DIR) : null,
      changedAfter: testData ? null : legacyChangedSince(app.getPath("appData")),
      error: migration.status === "failed" ? `Reprise de ${migration.from} impossible (${migration.error}) : l'appli continue sur l'ancien dossier, rien n'est perdu.` : null,
    },
    problems: config.problems,
    openAtLogin: openAtLogin(),
    dev,
  };
}

function pushState(): void {
  if (!win) return;
  const s = state();
  // Fenêtre unique : la page principale et ses vues intégrées (Mes stats, Méta, Champions recommandés).
  for (const f of win.webContents.mainFrame.framesInSubtree) {
    try { f.send(IPC.state, s); } catch { /* cadre en cours de chargement */ }
  }
}

/** Affiche la fenêtre et ouvre une vue (onglet, sous-vue, ancre du simulateur). */
function navigate(nav: Navigation, focus = true): void {
  showWindow(focus);
  const send = () => win?.webContents.send(IPC.navigate, nav);
  if (win?.webContents.isLoading()) win.webContents.once("did-finish-load", send); else send();
}
const showStatsWindow = () => navigate({ tab: "champions", sub: "stats" });
const showMetaWindow = () => navigate({ tab: "champions", sub: "meta" });
const showRecoWindow = () => navigate({ tab: "champions", sub: "reco" });

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
      width: 1240,
      height: 820,
      minWidth: 900,
      minHeight: 560,
      title: "Full Clear",
      icon: join(here, "icon.png"),
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#14141c",
      // Vues intégrées (Champions) : le pont de preload y est aussi exposé (pages locales de l'appli seulement).
      webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInSubFrames: true },
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
    { label: "Ouvrir Full Clear", click: () => showWindow() },
    { label: "Champions recommandés", click: () => showRecoWindow() },
    { label: "Mes stats", click: () => showStatsWindow() },
    { label: "Méta", click: () => showMetaWindow() },
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
  tray.setToolTip("Full Clear");
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
  ipcMain.handle(IPC.getAnalysis, (_e, key: unknown, filter: unknown) => engine.call("analysis", typeof key === "string" ? key : null, filter ? cleanFilter(filter) : ANY_FILTER, excludedKeys(), settings.refTier));
  ipcMain.handle(IPC.setRefTier, (_e, tier: unknown) => {
    if (isRefTier(tier)) { settings.refTier = tier; saveSettings(settingsFile, settings); }
    pushState();
    return state();
  });
  ipcMain.handle(IPC.getOverview, (_e, filter: unknown, compare: unknown) => engine.call("overview", cleanFilter(filter), typeof compare === "number" ? compare : null, excludedKeys(), settings.refTier));
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
  ipcMain.handle(IPC.getRecommendations, () => engine.call("reco", excludedKeys(), settings.refTier, settings.poolGoal, settings.championFlags));
  ipcMain.handle(IPC.getProgression, () => engine.call("progression", excludedKeys(), settings.refTier, settings.poolGoal, settings.championFlags));
  ipcMain.handle(IPC.getPostGames, () => postGames(20));
  ipcMain.handle(IPC.getPool, () => engine.call("pool", excludedKeys(), settings.refTier, settings.championFlags));
  ipcMain.handle(IPC.getTheme, () => themeView());
  // « Analyser ma dernière partie » : demande tout de suite à la collecte de chercher les nouvelles parties.
  ipcMain.handle(IPC.checkNewGames, () => { journal("analyse", "recherche demandée"); collector?.checkNewGames(); checkPostGame(); });
  ipcMain.handle(IPC.setPoolGoal, (_e, goal: unknown) => {
    if (goal === "win" || goal === "progress") { settings.poolGoal = goal; saveSettings(settingsFile, settings); }
    pushState();
    return state();
  });
  ipcMain.handle(IPC.setChampionFlag, (_e, id: unknown, flag: unknown) => {
    // Seulement des champions qui existent ; null retire le choix.
    if (typeof id === "string" && findChamp(id)?.id) {
      const key = findChamp(id)!.id as string;
      // « Je veux progresser dessus » : 2 champions au plus (au-delà, la fenêtre demande lesquels garder).
      const progress = Object.entries(settings.championFlags).filter(([k, f]) => f === "progress" && k !== key).length;
      if (flag === "progress" && progress >= MAX_PROGRESS) return { ...state(), flagError: `Tu as déjà ${progress} champions de progression : retire-en un d'abord.` };
      if (flag === "notForMe" || flag === "progress") settings.championFlags[key] = flag; else delete settings.championFlags[key];
      saveSettings(settingsFile, settings);
    }
    pushState();
    return state();
  });
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
    // Simulateur intégré (Champions › Simulateur Kayn), avec la draft en cours.
    if (draft) navigate({ tab: "champions", sub: "sim", hash: draft.link });
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
    openJournal(join(app.getPath("userData"), "journal.log"));
    journal("démarrage", `version ${app.getVersion()}`);
    settings = loadSettings(settingsFile);
    overlay = new OverlayWindow({
      dir: here,
      position: () => settings.overlay,
      savePosition: (x, y) => { settings.overlay.x = x; settings.overlay.y = y; saveSettings(settingsFile, settings); },
      shortcuts: () => settings.shortcuts,
      onChange: () => { pushState(); refreshTrayMenu(); },
    });
    overlay.enabled = settings.overlay.enabled;
    collector = new CollectorHost(here, dbFile(), () => { pushState(); checkPostGame(); });
    configureCollector();
    registerIpc();
    createTray();
    migrateLoginItem();
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
