// Fenêtre d'overlay : séparée du jeu (aucune injection), transparente, toujours au premier plan,
// traversée par la souris (les clics vont au jeu). Nécessite le mode « Sans bordure » :
// en plein écran exclusif, Windows n'affiche aucune autre fenêtre par-dessus le jeu.
import { BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import { join } from "node:path";
import { OVERLAY_IPC } from "./ipc.ts";
import type { ShortcutName, Shortcuts, ShortcutStatus } from "./shortcuts.ts";
import type { OverlayView } from "./next-item.ts";

const WIDTH = 300;
const MIN_HEIGHT = 60;
const MAX_HEIGHT = 260;

export interface OverlayOptions {
  dir: string;
  /** Position mémorisée. */
  position: () => { x?: number; y?: number };
  savePosition: (x: number, y: number) => void;
  shortcuts: () => Shortcuts;
  onChange: () => void;
}

export class OverlayWindow {
  private win: BrowserWindow | null = null;
  private view: OverlayView | null = null;
  private inGame = false;
  /** Masqué par le raccourci (jusqu'à la fin de la partie). */
  hiddenByUser = false;
  moving = false;
  enabled = true;
  shortcutStatus: Record<ShortcutName, ShortcutStatus> = { toggle: "unknown", move: "unknown" };
  /** Raccourcis actuellement enregistrés auprès de Windows (pour les retirer exactement). */
  private registered: string[] = [];
  /** Saisie d'un raccourci en cours dans la fenêtre : on ne réenregistre rien. */
  private capturing = false;
  private readonly opt: OverlayOptions;

  constructor(opt: OverlayOptions) {
    this.opt = opt;
    ipcMain.on(OVERLAY_IPC.height, (e, h: unknown) => {
      if (!this.win || e.sender !== this.win.webContents || typeof h !== "number") return;
      const [x, y] = this.win.getPosition();
      this.win.setBounds({ x, y, width: WIDTH, height: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(h))) });
    });
  }

  get visible(): boolean { return !!this.win?.isVisible(); }
  get isInGame(): boolean { return this.inGame; }

  /**
   * Enregistre les raccourcis en partie. Hors partie, les teste seulement (enregistrement puis retrait)
   * pour signaler tout de suite une combinaison déjà prise par une autre appli.
   */
  applyShortcuts(): void {
    this.unregister();
    const sc = this.opt.shortcuts();
    const actions: Record<ShortcutName, () => void> = { toggle: () => this.toggleVisible(), move: () => this.setMoving(!this.moving) };
    for (const name of ["toggle", "move"] as const) {
      let ok = false;
      try { ok = globalShortcut.register(sc[name], actions[name]); } catch { ok = false; }
      if (ok) this.registered.push(sc[name]);
      this.shortcutStatus[name] = ok ? (this.inGame && !this.capturing ? "active" : "free") : "taken";
    }
    if (!this.inGame || this.capturing) this.unregister();
    this.opt.onChange();
  }

  /** Pendant la saisie d'un nouveau raccourci, les anciens ne doivent pas se déclencher. */
  setCapturing(on: boolean): void {
    this.capturing = on;
    if (on) this.unregister();
    else this.applyShortcuts();
  }

  /** Nouvelle recommandation (null : plus de partie). */
  update(view: OverlayView | null): void {
    this.view = view;
    if (view && !this.inGame) this.gameStarted();
    if (!view && this.inGame) this.gameEnded();
    this.win?.webContents.send(OVERLAY_IPC.view, view);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.sync();
  }

  resetPosition(): void {
    const p = this.defaultPosition();
    this.win?.setPosition(p.x, p.y);
    this.opt.savePosition(p.x, p.y);
  }

  toggleVisible(): void {
    this.hiddenByUser = !this.hiddenByUser;
    if (this.hiddenByUser && this.moving) this.setMoving(false);
    this.sync();
  }

  setMoving(on: boolean): void {
    if (!this.win || (on && !this.visible)) return;
    this.moving = on;
    // En déplacement : la fenêtre reçoit la souris. Sinon : clics transmis au jeu, jamais de focus.
    this.win.setIgnoreMouseEvents(!on, { forward: true });
    this.win.setFocusable(on);
    this.win.webContents.send(OVERLAY_IPC.moving, on);
    if (!on) {
      const [x, y] = this.win.getPosition();
      this.opt.savePosition(x, y);
      this.win.blur();
    }
    this.opt.onChange();
  }

  destroy(): void {
    this.unregister();
    this.win?.destroy();
    this.win = null;
  }

  private gameStarted(): void {
    this.inGame = true;
    this.hiddenByUser = false;
    // Raccourcis globaux pendant la partie uniquement (pas de conflit avec d'autres applis le reste du temps).
    this.applyShortcuts();
    this.sync();
  }

  private gameEnded(): void {
    this.inGame = false;
    if (this.moving) this.setMoving(false);
    this.applyShortcuts(); // retire les raccourcis, garde le diagnostic « libre / pris »
    this.sync();
  }

  private unregister(): void {
    for (const acc of this.registered) globalShortcut.unregister(acc);
    this.registered = [];
  }

  private sync(): void {
    const show = this.enabled && this.inGame && !this.hiddenByUser;
    if (show) {
      this.ensure();
      if (!this.win!.isVisible()) this.win!.showInactive();
      this.win!.setAlwaysOnTop(true, "screen-saver");
    } else if (this.win?.isVisible()) {
      if (this.moving) this.setMoving(false);
      this.win.hide();
    }
    this.opt.onChange();
  }

  private defaultPosition(): { x: number; y: number } {
    const area = screen.getPrimaryDisplay().workArea;
    // En haut à droite, sous la zone des stats du jeu.
    return { x: area.x + area.width - WIDTH - 16, y: area.y + Math.round(area.height * 0.18) };
  }

  /** Position mémorisée, ramenée sur un écran visible si l'affichage a changé. */
  private startPosition(): { x: number; y: number } {
    const p = this.opt.position();
    if (p.x === undefined || p.y === undefined) return this.defaultPosition();
    const d = screen.getDisplayNearestPoint({ x: p.x, y: p.y }).workArea;
    return {
      x: Math.min(Math.max(p.x, d.x), d.x + d.width - WIDTH),
      y: Math.min(Math.max(p.y, d.y), d.y + d.height - MIN_HEIGHT),
    };
  }

  private ensure(): void {
    if (this.win) return;
    const { x, y } = this.startPosition();
    this.win = new BrowserWindow({
      x, y, width: WIDTH, height: 120,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      title: "Full Clear · overlay",
      webPreferences: { preload: join(this.opt.dir, "preload-overlay.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    this.win.setIgnoreMouseEvents(true, { forward: true });
    this.win.setAlwaysOnTop(true, "screen-saver");
    this.win.webContents.on("will-navigate", (e) => e.preventDefault());
    this.win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.win.webContents.on("did-finish-load", () => this.win?.webContents.send(OVERLAY_IPC.view, this.view));
    this.win.on("moved", () => { if (this.win && this.moving) { const [nx, ny] = this.win.getPosition(); this.opt.savePosition(nx, ny); } });
    this.win.on("closed", () => { this.win = null; });
    void this.win.loadFile(join(this.opt.dir, "overlay", "index.html"));
  }
}
