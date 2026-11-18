// Client minimal de l'API Riot (account-v1, spectator-v5, match-v5).
//
// Sécurité : la clé ne passe que dans l'en-tête X-Riot-Token. Elle n'apparaît jamais dans une URL,
// un log ou un message d'erreur (les messages sont nettoyés par précaution).
// Limites : toutes les requêtes passent par un RateLimiter (20/s et 100/2 min) ; une réponse 429
// bloque toutes les requêtes pendant la durée Retry-After indiquée par Riot.
import { RateLimiter, realClock, type Clock } from "./rate-limiter.ts";

export class RiotApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RiotApiError";
    this.status = status;
  }
}

export interface RiotClientOptions {
  apiKey: string;
  /** Routage régional pour account-v1 et match-v5 (EUW : europe). */
  region?: string;
  /** Plateforme pour spectator-v5 (EUW : euw1). */
  platform?: string;
  fetch?: typeof fetch;
  limiter?: RateLimiter;
  clock?: Clock;
  /** Nouvelles tentatives après une erreur 429 ou 5xx. */
  maxRetries?: number;
}

export interface Account { puuid: string; gameName: string; tagLine: string }

export interface ActiveGameParticipant {
  puuid: string | null;
  teamId: number;
  championId: number;
  riotId?: string;
  bot?: boolean;
}
export interface ActiveGame {
  gameId: number;
  gameMode: string;
  gameQueueConfigId: number;
  gameLength: number;
  participants: ActiveGameParticipant[];
}

/** File Solo/Duo. */
export const QUEUE_SOLO_DUO = 420;

export class RiotClient {
  private readonly apiKey: string;
  private readonly region: string;
  private readonly platform: string;
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: RateLimiter;
  private readonly clock: Clock;
  private readonly maxRetries: number;

  constructor(o: RiotClientOptions) {
    if (!o.apiKey) throw new Error("Clé API Riot absente.");
    this.apiKey = o.apiKey;
    this.region = o.region ?? "europe";
    this.platform = o.platform ?? "euw1";
    this.fetchImpl = o.fetch ?? fetch;
    this.clock = o.clock ?? realClock;
    this.limiter = o.limiter ?? new RateLimiter(undefined, this.clock);
    this.maxRetries = o.maxRetries ?? 4;
  }

  /** Retire toute trace de la clé d'un texte (défense en profondeur). */
  private scrub(s: string): string {
    return s.split(this.apiKey).join("[clé masquée]");
  }

  private async get<T>(host: string, path: string, opt: { allow404?: boolean } = {}): Promise<T | null> {
    const url = `https://${host}.api.riotgames.com${path}`;
    for (let attempt = 0; ; attempt++) {
      await this.limiter.acquire();
      let res: Response;
      try {
        res = await this.fetchImpl(url, { headers: { "X-Riot-Token": this.apiKey, Accept: "application/json" } });
      } catch (e) {
        if (attempt >= this.maxRetries) throw new RiotApiError(this.scrub(`Réseau indisponible pour ${path} : ${(e as Error).message}`), 0);
        await this.clock.sleep(1000 * 2 ** attempt);
        continue;
      }
      if (res.ok) return (await res.json()) as T;
      if (res.status === 404 && opt.allow404) return null;
      if (res.status === 429 && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        this.limiter.pause((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2) * 1000);
        continue;
      }
      if (res.status >= 500 && attempt < this.maxRetries) {
        await this.clock.sleep(1000 * 2 ** attempt);
        continue;
      }
      if (res.status === 401 || res.status === 403)
        throw new RiotApiError(`Clé API refusée (HTTP ${res.status}). Vérifie RIOT_API_KEY dans .env : la clé a peut-être été régénérée ou révoquée.`, res.status);
      throw new RiotApiError(this.scrub(`Erreur HTTP ${res.status} sur ${path}`), res.status);
    }
  }

  /** account-v1 : compte à partir du Riot ID (Nom#TAG). Null si introuvable. */
  account(gameName: string, tagLine: string): Promise<Account | null> {
    return this.get<Account>(this.region, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`, { allow404: true });
  }

  /** spectator-v5 : partie en cours. Null si le joueur n'est pas en partie. */
  activeGame(puuid: string): Promise<ActiveGame | null> {
    return this.get<ActiveGame>(this.platform, `/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(puuid)}`, { allow404: true });
  }

  /** match-v5 : identifiants des parties (100 max par appel). */
  async matchIds(puuid: string, q: { queue?: number; startTime?: number; start?: number; count?: number } = {}): Promise<string[]> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v != null) params.set(k, String(v));
    return (await this.get<string[]>(this.region, `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${params}`)) ?? [];
  }

  /** match-v5 : détail d'une partie. */
  match<T = unknown>(id: string): Promise<T | null> {
    return this.get<T>(this.region, `/lol/match/v5/matches/${encodeURIComponent(id)}`, { allow404: true });
  }

  /** match-v5 : chronologie d'une partie (achats d'items…). */
  timeline<T = unknown>(id: string): Promise<T | null> {
    return this.get<T>(this.region, `/lol/match/v5/matches/${encodeURIComponent(id)}/timeline`, { allow404: true });
  }
}
