// Pont de la fenêtre d'overlay : reçoit la recommandation, signale sa hauteur. Rien d'autre.
import { contextBridge, ipcRenderer } from "electron";
import { OVERLAY_IPC, type OverlayApi } from "./ipc.ts";
import type { OverlayView } from "./next-item.ts";

const api: OverlayApi = {
  onView: (cb) => { ipcRenderer.on(OVERLAY_IPC.view, (_e, v: OverlayView | null) => cb(v)); },
  onMoving: (cb) => { ipcRenderer.on(OVERLAY_IPC.moving, (_e, m: boolean) => cb(m)); },
  setHeight: (h) => ipcRenderer.send(OVERLAY_IPC.height, h),
};

contextBridge.exposeInMainWorld("overlay", api);
