// Processus principal de l'application de bureau : icône dans la zone de notification, fenêtre d'état,
// lancement au démarrage. Aucune console : en version installée, rien ne s'affiche hors de nos fenêtres.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { envCandidates, loadDesktopConfig, type DesktopConfig } from "./config.ts";
import { IPC, type AppState } from "./ipc.ts";

/** Lancé par Windows à l'ouverture de session : on reste discret dans la zone de notification. */
const HIDDEN_ARG = "--hidden";
const dev = !app.isPackaged;
const here = __dirname; // desktop/dist une fois compilé

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let config: DesktopConfig;
let quitting = false;

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
  return app.getLoginItemSettings({ args: loginArgs() }).openAtLogin;
}

function setOpenAtLogin(on: boolean): void {
  app.setLoginItemSettings({ openAtLogin: on, args: loginArgs() });
  refreshTrayMenu();
}

function state(): AppState {
  return {
    version: app.getVersion(),
    envFile: config.envFile,
    searched: config.searched,
    riotId: config.riotId ? `${config.riotId.gameName}#${config.riotId.tagLine}` : null,
    problems: config.problems,
    openAtLogin: openAtLogin(),
    dev,
  };
}

function pushState(): void {
  win?.webContents.send(IPC.state, state());
}

function showWindow(): void {
  if (!win) {
    win = new BrowserWindow({
      width: 460,
      height: 560,
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
    win.once("ready-to-show", () => win?.show());
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function refreshTrayMenu(): void {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Ouvrir Kayn Sim", click: showWindow },
    { type: "separator" },
    { label: "Lancer au démarrage de Windows", type: "checkbox", checked: openAtLogin(), click: (item) => { setOpenAtLogin(item.checked); pushState(); } },
    { type: "separator" },
    { label: "Quitter", click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(here, "icon.png")).resize({ width: 16, height: 16, quality: "best" });
  tray = new Tray(icon);
  tray.setToolTip("Kayn Sim");
  tray.on("click", showWindow);
  refreshTrayMenu();
}

function registerIpc(): void {
  ipcMain.handle(IPC.getState, () => state());
  ipcMain.handle(IPC.setOpenAtLogin, (_e, on: unknown) => { setOpenAtLogin(on === true); return state(); });
  ipcMain.handle(IPC.reloadConfig, () => { config = readConfig(); return state(); });
  ipcMain.handle(IPC.openUserDataDir, async () => { await shell.openPath(app.getPath("userData")); });
}

// Une seule instance : relancer l'appli ré-affiche simplement la fenêtre.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.setAppUserModelId("io.github.kayn-sim");
  app.whenReady().then(() => {
    config = readConfig();
    registerIpc();
    createTray();
    if (!process.argv.includes(HIDDEN_ARG)) showWindow();
  });
  // Toutes les fenêtres fermées : on reste dans la zone de notification.
  app.on("window-all-closed", () => { /* rien */ });
  app.on("before-quit", () => { quitting = true; });
}
