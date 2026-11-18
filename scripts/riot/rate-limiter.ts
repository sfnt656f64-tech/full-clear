// Limiteur de requêtes à fenêtres glissantes, pour respecter les limites de la clé Riot :
// 20 requêtes par seconde ET 100 requêtes par 2 minutes (les deux à la fois).
// Les fenêtres sont légèrement élargies pour absorber le décalage d'horloge avec les serveurs Riot.

export interface Window { limit: number; ms: number }

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)),
};

/** Limites de la clé personnelle (20/s, 100/2 min), avec une marge sur la durée des fenêtres. */
export const PERSONAL_KEY_WINDOWS: Window[] = [
  { limit: 20, ms: 1_000 + 100 },
  { limit: 100, ms: 120_000 + 1_000 },
];

export class RateLimiter {
  private stamps: number[] = [];
  private blockedUntil = 0;
  private queue: Promise<void> = Promise.resolve();

  private readonly windows: Window[];
  private readonly clock: Clock;

  constructor(windows: Window[] = PERSONAL_KEY_WINDOWS, clock: Clock = realClock) {
    this.windows = windows;
    this.clock = clock;
  }

  /** Attend qu'une requête soit autorisée, puis la compte. Les appels sont servis dans l'ordre. */
  acquire(): Promise<void> {
    const next = this.queue.then(() => this.waitTurn());
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Bloque toutes les requêtes pendant `ms` (réponse 429 avec Retry-After). */
  pause(ms: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, this.clock.now() + ms);
  }

  /** Délai à attendre avant la prochaine requête (0 = tout de suite). */
  delay(): number {
    const now = this.clock.now();
    const longest = Math.max(...this.windows.map((w) => w.ms));
    this.stamps = this.stamps.filter((t) => now - t < longest);
    let wait = Math.max(0, this.blockedUntil - now);
    for (const w of this.windows) {
      const inWindow = this.stamps.filter((t) => now - t < w.ms);
      if (inWindow.length >= w.limit) wait = Math.max(wait, inWindow[inWindow.length - w.limit] + w.ms - now);
    }
    return wait;
  }

  private async waitTurn(): Promise<void> {
    for (let d = this.delay(); d > 0; d = this.delay()) await this.clock.sleep(d);
    this.stamps.push(this.clock.now());
  }
}
