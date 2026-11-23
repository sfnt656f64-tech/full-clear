// Planificateur des requêtes à l'API Riot pour la collecte en arrière-plan.
//
// - Un quota par routage (Riot compte les limites de la clé séparément pour europe et euw1).
// - Le collecteur se réserve 15/s et 90/2 min sur les 20/s et 100/2 min de la clé personnelle :
//   la marge laisse passer npm run stats / npm run live lancés en même temps.
// - Priorités : tes parties passent avant la méta.
// - Pause (partie en cours, pause manuelle, clé refusée) : les requêtes en attente patientent.
// - La clé ne passe que dans l'en-tête X-Riot-Token ; elle est retirée de tout message d'erreur.
import { RateLimiter, realClock, type Clock, type Window } from "../../scripts/riot/rate-limiter.ts";

export type Routing = "europe" | "euw1";
export const ROUTINGS: Routing[] = ["europe", "euw1"];

/** Priorités : plus petit = servi d'abord. Tes parties de la saison, puis tes anciennes saisons, puis la méta. */
export const PRIORITY = { mine: 0, mineOld: 1, meta: 2 } as const;

export const COLLECTOR_WINDOWS: Window[] = [
  { limit: 15, ms: 1_000 + 100 },
  { limit: 90, ms: 120_000 + 1_000 },
];
export const BUDGET_2MIN = 90;

export class RiotHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RiotHttpError";
    this.status = status;
  }
}

/** Clé refusée (401/403) : la collecte s'arrête jusqu'à ce que la clé soit corrigée. */
export class KeyRefusedError extends RiotHttpError {
  constructor(status: number) {
    super(`Clé API refusée (HTTP ${status}). Vérifie RIOT_API_KEY dans le .env.`, status);
    this.name = "KeyRefusedError";
  }
}

interface Waiter { priority: number; seq: number; resolve: () => void; reject: (e: Error) => void }

export interface SchedulerOptions {
  apiKey: string;
  fetch?: typeof fetch;
  clock?: Clock;
  windows?: Window[];
  maxRetries?: number;
  onKeyRefused?: () => void;
}

export class RiotScheduler {
  private apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: Clock;
  private readonly maxRetries: number;
  private readonly onKeyRefused: () => void;
  private readonly limiters = new Map<Routing, RateLimiter>();
  private readonly queues = new Map<Routing, Waiter[]>();
  /** Horodatage des requêtes envoyées (2 dernières minutes), pour l'affichage. */
  private readonly sent = new Map<Routing, number[]>();
  private readonly pumping = new Set<Routing>();
  private readonly pauses = new Set<string>();
  private resumeWaiters: (() => void)[] = [];
  private seq = 0;

  constructor(o: SchedulerOptions) {
    this.apiKey = o.apiKey;
    this.fetchImpl = o.fetch ?? fetch;
    this.clock = o.clock ?? realClock;
    this.maxRetries = o.maxRetries ?? 4;
    this.onKeyRefused = o.onKeyRefused ?? (() => {});
    for (const r of ROUTINGS) {
      this.limiters.set(r, new RateLimiter(o.windows ?? COLLECTOR_WINDOWS, this.clock));
      this.queues.set(r, []);
      this.sent.set(r, []);
    }
  }

  setApiKey(key: string): void { this.apiKey = key; }

  get paused(): boolean { return this.pauses.size > 0; }
  get pauseReasons(): string[] { return [...this.pauses]; }

  pause(reason: string): void { this.pauses.add(reason); }

  resume(reason: string): void {
    this.pauses.delete(reason);
    if (!this.pauses.size) {
      const w = this.resumeWaiters;
      this.resumeWaiters = [];
      for (const f of w) f();
    }
  }

  /** Requêtes envoyées dans les 2 dernières minutes, par routage. */
  usage(): Record<Routing, number> {
    const now = this.clock.now();
    return Object.fromEntries(ROUTINGS.map((r) => {
      const s = this.sent.get(r)!.filter((t) => now - t < 120_000);
      this.sent.set(r, s);
      return [r, s.length];
    })) as Record<Routing, number>;
  }

  /** Demandes en attente d'un créneau, par routage. */
  queued(): Record<Routing, number> {
    return Object.fromEntries(ROUTINGS.map((r) => [r, this.queues.get(r)!.length])) as Record<Routing, number>;
  }

  /** Attend un créneau sur ce routage (par priorité, puis dans l'ordre d'arrivée). */
  acquire(r: Routing, priority: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queues.get(r)!.push({ priority, seq: this.seq++, resolve, reject });
      void this.pump(r);
    });
  }

  private waitResume(): Promise<void> {
    return this.paused ? new Promise((ok) => this.resumeWaiters.push(ok)) : Promise.resolve();
  }

  private async pump(r: Routing): Promise<void> {
    if (this.pumping.has(r)) return;
    this.pumping.add(r);
    try {
      const q = this.queues.get(r)!;
      const lim = this.limiters.get(r)!;
      while (q.length) {
        if (this.paused) { await this.waitResume(); continue; }
        const d = lim.delay();
        // Attente découpée : une pause ou une demande plus prioritaire est prise en compte en cours de route.
        if (d > 0) { await this.clock.sleep(Math.min(d, 1000)); continue; }
        q.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
        const w = q.shift()!;
        lim.record();
        this.sent.get(r)!.push(this.clock.now());
        w.resolve();
      }
    } finally {
      this.pumping.delete(r);
    }
  }

  private scrub(s: string): string {
    return this.apiKey ? s.split(this.apiKey).join("[clé masquée]") : s;
  }

  /** GET JSON. null pour un 404 si allow404. Gère 429 (Retry-After), 5xx et coupures réseau. */
  async get<T>(r: Routing, path: string, priority: number, opt: { allow404?: boolean } = {}): Promise<T | null> {
    const url = `https://${r}.api.riotgames.com${path}`;
    for (let attempt = 0; ; attempt++) {
      await this.acquire(r, priority);
      let res: Response;
      try {
        res = await this.fetchImpl(url, { headers: { "X-Riot-Token": this.apiKey, Accept: "application/json" } });
      } catch (e) {
        if (attempt >= this.maxRetries) throw new RiotHttpError(this.scrub(`Réseau indisponible (${path}) : ${(e as Error).message}`), 0);
        await this.clock.sleep(2000 * 2 ** attempt);
        continue;
      }
      if (res.ok) return (await res.json()) as T;
      if (res.status === 404 && opt.allow404) return null;
      if (res.status === 401 || res.status === 403) {
        this.pause("key");
        this.onKeyRefused();
        throw new KeyRefusedError(res.status);
      }
      if (res.status === 429 && attempt < this.maxRetries) {
        const s = Number(res.headers.get("retry-after"));
        this.limiters.get(r)!.pause((Number.isFinite(s) && s > 0 ? s : 5) * 1000);
        continue;
      }
      if (res.status >= 500 && attempt < this.maxRetries) {
        await this.clock.sleep(2000 * 2 ** attempt);
        continue;
      }
      throw new RiotHttpError(this.scrub(`HTTP ${res.status} (${path})`), res.status);
    }
  }
}
