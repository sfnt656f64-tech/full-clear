// Pont minimal et typé entre la fenêtre (sans accès à Node) et le processus principal.
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AppState, type KaynApi } from "./ipc.ts";

const api: KaynApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  setOpenAtLogin: (on) => ipcRenderer.invoke(IPC.setOpenAtLogin, on),
  reloadConfig: () => ipcRenderer.invoke(IPC.reloadConfig),
  openUserDataDir: () => ipcRenderer.invoke(IPC.openUserDataDir),
  setCollectorPaused: (on) => ipcRenderer.invoke(IPC.setCollectorPaused, on),
  getMyGames: () => ipcRenderer.invoke(IPC.getMyGames),
  openStatsWindow: () => ipcRenderer.invoke(IPC.openStatsWindow),
  openDraftInSimulator: () => ipcRenderer.invoke(IPC.openDraftInSimulator),
  setOverlayEnabled: (on) => ipcRenderer.invoke(IPC.setOverlayEnabled, on),
  setFormChoice: (f) => ipcRenderer.invoke(IPC.setFormChoice, f),
  resetOverlayPosition: () => ipcRenderer.invoke(IPC.resetOverlayPosition),
  setShortcut: (name, acc) => ipcRenderer.invoke(IPC.setShortcut, name, acc),
  setCapturing: (on) => ipcRenderer.invoke(IPC.setCapturing, on),
  onState: (cb) => { ipcRenderer.on(IPC.state, (_e, s: AppState) => cb(s)); },
};

contextBridge.exposeInMainWorld("kayn", api);
