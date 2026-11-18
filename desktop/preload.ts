// Pont minimal et typé entre la fenêtre (sans accès à Node) et le processus principal.
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type AppState, type KaynApi } from "./ipc.ts";

const api: KaynApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  setOpenAtLogin: (on) => ipcRenderer.invoke(IPC.setOpenAtLogin, on),
  reloadConfig: () => ipcRenderer.invoke(IPC.reloadConfig),
  openUserDataDir: () => ipcRenderer.invoke(IPC.openUserDataDir),
  openDraftInSimulator: () => ipcRenderer.invoke(IPC.openDraftInSimulator),
  onState: (cb) => { ipcRenderer.on(IPC.state, (_e, s: AppState) => cb(s)); },
};

contextBridge.exposeInMainWorld("kayn", api);
