// Moteur de la collecte : exécute les travaux de la file (store.jobs) au rythme permis par le planificateur.
// Indépendant d'Electron (testable) : le processus de fond (collector-main.ts) ne fait que le brancher.
import { HANDLERS, JOB_LABELS, scheduleAccounts, type JobContext } from "./jobs.ts";
import { BUDGET_2MIN, KeyRefusedError, ROUTINGS, type RiotScheduler, type Routing } from "./scheduler.ts";
import type { CollectorStore, Job, JobStatus } from "./store.ts";

/** Travaux exécutés en même temps (le quota de requêtes reste le vrai frein). */
const CONCURRENCY = 3;
/** Attente quand la file est vide, avant de revérifier (nouveaux travaux, rafraîchissement des comptes). */
const IDLE_MS = 30_000;

export type CollectorState = "idle" | "running" | "paused" | "key-refused" | "no-key" | "stopped";

export interface CollectorStatus {
  state: CollectorState;
  /** Raisons de la pause : « game » (partie en cours), « user » (pause manuelle), « key » (clé refusée). */
  pauseReasons: string[];
  jobs: { kind: string; label: string; pending: number; done: number; failed: number }[];
  /** Requêtes sur les 2 dernières minutes, par routage, et budget du collecteur. */
  usage: Record<Routing, number>;
  budget: number;
  /** Tes parties enregistrées, par compte. */
  myGames: Record<string, number>;
  lastError: string | null;
}

export interface CollectorOptions {
  store: CollectorStore;
  api: RiotScheduler;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onStatus?: (s: CollectorStatus) => void;
}

export class Collector {
  private readonly ctx: JobContext;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onStatus: (s: CollectorStatus) => void;
  private accounts: string[] = [];
  private running = false;
  private stopped = false;
  private active = 0;
  private keyRefused = false;
  private lastError: string | null = null;
  private wake: (() => void) | null = null;

  constructor(o: CollectorOptions) {
    const now = o.now ?? Date.now;
    this.ctx = { store: o.store, api: o.api, now };
    this.sleep = o.sleep ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
    this.onStatus = o.onStatus ?? (() => {});
  }

  /** Comptes à suivre (« Nom#TAG ») ; relance la recherche de nouvelles parties. */
  configure(accounts: string[]): void {
    this.accounts = accounts;
    this.keyRefused = false;
    this.ctx.api.resume("key");
    scheduleAccounts(this.ctx, accounts);
    this.poke();
  }

  pause(reason: string): void { this.ctx.api.pause(reason); this.publish(); }

  resume(reason: string): void {
    this.ctx.api.resume(reason);
    this.publish();
    this.poke();
  }

  /** Lance les boucles de travail (une seule fois). */
  start(): void {
    if (this.running) return;
    this.running = true;
    for (let i = 0; i < CONCURRENCY; i++) void this.worker();
  }

  stop(): void {
    this.stopped = true;
    this.poke();
  }

  /** Réveille une boucle en attente (nouveaux travaux, reprise). */
  private poke(): void {
    const w = this.wake;
    this.wake = null;
    w?.();
  }

  private idle(ms: number): Promise<void> {
    return new Promise((ok) => {
      const prev = this.wake;
      this.wake = () => { prev?.(); ok(); };
      void this.sleep(ms).then(ok);
    });
  }

  private async worker(): Promise<void> {
    while (!this.stopped) {
      if (this.ctx.api.paused) { await this.idle(5_000); continue; }
      const job = this.ctx.store.claimNext();
      if (!job) {
        this.publish();
        await this.idle(IDLE_MS);
        // File vide : on revérifie de temps en temps les nouvelles parties de tes comptes.
        if (!this.stopped && !this.ctx.api.paused) scheduleAccounts(this.ctx, this.accounts);
        continue;
      }
      await this.run(job);
    }
  }

  private async run(job: Job): Promise<void> {
    const handler = HANDLERS[job.kind];
    this.active++;
    this.publish();
    try {
      if (!handler) throw new Error(`Type de travail inconnu : ${job.kind}`);
      await handler(this.ctx, job.payload as never);
      this.ctx.store.done(job.id);
    } catch (e) {
      if (e instanceof KeyRefusedError) {
        // Pas la faute du travail : on le rend tel quel, et tout s'arrête jusqu'à une nouvelle clé.
        this.keyRefused = true;
        this.ctx.store.release(job.id);
      } else {
        this.ctx.store.failed(job, (e as Error).message);
      }
      this.lastError = (e as Error).message;
    } finally {
      this.active--;
      this.publish();
    }
  }

  status(): CollectorStatus {
    const counts = this.ctx.store.counts();
    const api = this.ctx.api;
    const reasons = api.pauseReasons;
    const state: CollectorState = this.stopped ? "stopped"
      : this.keyRefused ? "key-refused"
      : reasons.length ? "paused"
      : this.active > 0 ? "running"
      : "idle";
    return {
      state,
      pauseReasons: reasons,
      jobs: Object.keys(JOB_LABELS).map((kind) => {
        const c: Partial<Record<JobStatus, number>> = counts[kind] ?? {};
        return { kind, label: JOB_LABELS[kind], pending: (c.pending ?? 0) + (c.running ?? 0), done: c.done ?? 0, failed: c.failed ?? 0 };
      }),
      usage: api.usage(),
      budget: BUDGET_2MIN,
      myGames: this.ctx.store.gameCounts(),
      lastError: this.lastError,
    };
  }

  private lastPublished = "";
  private publish(): void {
    const s = this.status();
    const key = JSON.stringify(s);
    if (key === this.lastPublished) return;
    this.lastPublished = key;
    this.onStatus(s);
  }

  /** Publication périodique (le quota utilisé évolue même sans nouveau travail). */
  tick(): void { this.publish(); }
}

export { ROUTINGS };
