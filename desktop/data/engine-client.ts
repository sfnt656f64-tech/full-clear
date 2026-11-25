// Côté processus principal : envoie les calculs au worker du moteur et attend la réponse (jamais de calcul ici).
// Le worker est relancé s'il s'arrête ; une demande en cours reçoit alors une erreur.
import { Worker } from "node:worker_threads";
import type { EngineCalls } from "./engine-worker.ts";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; fn: string };

export class EngineClient {
  private worker: Worker | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly file: string;
  private readonly dbFile: string;
  private readonly log: ((line: string) => void) | null;

  constructor(file: string, dbFile: string, log: ((line: string) => void) | null = null) {
    this.file = file;
    this.dbFile = dbFile;
    this.log = log;
  }

  private start(): Worker {
    const w = new Worker(this.file, { workerData: { dbFile: this.dbFile } });
    w.on("message", (m: { id: number; ok: boolean; value?: unknown; error?: string; ms: number }) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      this.log?.(`[moteur] ${p.fn} ${m.ms.toFixed(0)} ms`);
      if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error));
    });
    w.on("error", (e) => console.error("Moteur de données :", e));
    w.on("exit", () => {
      this.worker = null;
      for (const [id, p] of this.pending) { p.reject(new Error("moteur de données arrêté")); this.pending.delete(id); }
    });
    w.unref();
    return w;
  }

  call<K extends keyof EngineCalls>(fn: K, ...args: Parameters<EngineCalls[K]>): Promise<ReturnType<EngineCalls[K]>> {
    this.worker ??= this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, fn });
      this.worker!.postMessage({ id, fn, args });
    });
  }

  stop(): void { void this.worker?.terminate(); this.worker = null; }
}
