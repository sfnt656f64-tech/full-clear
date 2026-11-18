// Travaux de la collecte. Chaque travail est idempotent : le refaire après une interruption ne crée pas de doublon.
//
//   account     Riot ID → PUUID (account-v1), puis liste des parties
//   myMatchIds  une page de 100 parties Solo/Duo de la saison (match-v5), puis une tâche par partie
//   myMatch     une partie + sa chronologie (2 requêtes) → my_games
import { SEASON_START } from "../../scripts/riot/season.ts";
import { parseRiotId } from "../../scripts/riot/config.ts";
import { PRIORITY, type RiotScheduler } from "./scheduler.ts";
import type { CollectorStore } from "./store.ts";
import { summarizeMyGame, type MatchV5, type TimelineV5 } from "./my-games.ts";

export const QUEUE_SOLO_DUO = 420;
const PAGE = 100;
/** Délai minimal entre deux vérifications de nouvelles parties sur un compte. */
export const REFRESH_MS = 20 * 60_000;

export interface JobContext {
  store: CollectorStore;
  api: RiotScheduler;
  now: () => number;
}

type Handler = (ctx: JobContext, payload: never) => Promise<void>;

export const accountKey = (riotId: string) => `account:${riotId.toLocaleLowerCase()}`;
export const idsKey = (puuid: string, start: number) => `myMatchIds:${puuid}:${start}`;

/** Ajoute (ou relance si le dernier passage est ancien) la recherche de parties pour tes comptes. */
export function scheduleAccounts(ctx: JobContext, riotIds: string[]): void {
  for (const riotId of riotIds) {
    const key = accountKey(riotId);
    const puuid = ctx.store.get(key);
    if (!puuid) {
      if (!ctx.store.enqueue("account", key, PRIORITY.mine, { riotId })) ctx.store.requeue(key);
      continue;
    }
    refreshIds(ctx, puuid, riotId);
  }
}

/** Relance la 1ʳᵉ page de parties si elle date de plus de REFRESH_MS. */
function refreshIds(ctx: JobContext, puuid: string, riotId: string): void {
  const key = idsKey(puuid, 0);
  const st = ctx.store.jobStatus(key);
  if (!st) ctx.store.enqueue("myMatchIds", key, PRIORITY.mine, { puuid, riotId, start: 0 });
  else if (st.status !== "pending" && st.status !== "running" && ctx.now() - st.updatedAt >= REFRESH_MS) ctx.store.requeue(key);
}

const account: Handler = async (ctx, p: { riotId: string }) => {
  const id = parseRiotId(p.riotId);
  if (!id) throw new Error(`Riot ID invalide : ${p.riotId}`);
  const acc = await ctx.api.get<{ puuid: string }>("europe", `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(id[0])}/${encodeURIComponent(id[1])}`, PRIORITY.mine, { allow404: true });
  if (!acc) throw new Error(`Compte ${p.riotId} introuvable.`);
  ctx.store.set(accountKey(p.riotId), acc.puuid);
  refreshIds(ctx, acc.puuid, p.riotId);
};

const myMatchIds: Handler = async (ctx, p: { puuid: string; riotId: string; start: number }) => {
  const q = new URLSearchParams({ queue: String(QUEUE_SOLO_DUO), startTime: String(Math.floor(SEASON_START / 1000)), start: String(p.start), count: String(PAGE) });
  const ids = (await ctx.api.get<string[]>("europe", `/lol/match/v5/matches/by-puuid/${encodeURIComponent(p.puuid)}/ids?${q}`, PRIORITY.mine)) ?? [];
  let fresh = 0;
  ctx.store.tx(() => {
    for (const matchId of ids) if (ctx.store.enqueue("myMatch", `myMatch:${matchId}:${p.puuid}`, PRIORITY.mine, { matchId, puuid: p.puuid, riotId: p.riotId })) fresh++;
    // Page pleine : il y en a peut-être d'autres. Au rafraîchissement, on ne continue que s'il y avait du nouveau.
    if (ids.length === PAGE) {
      const next = idsKey(p.puuid, p.start + PAGE);
      if (!ctx.store.enqueue("myMatchIds", next, PRIORITY.mine, { ...p, start: p.start + PAGE }) && fresh > 0) ctx.store.requeue(next);
    }
  });
};

const myMatch: Handler = async (ctx, p: { matchId: string; puuid: string; riotId: string }) => {
  const m = await ctx.api.get<MatchV5>("europe", `/lol/match/v5/matches/${encodeURIComponent(p.matchId)}`, PRIORITY.mine, { allow404: true });
  if (!m || m.info.queueId !== QUEUE_SOLO_DUO) return;
  const t = await ctx.api.get<TimelineV5>("europe", `/lol/match/v5/matches/${encodeURIComponent(p.matchId)}/timeline`, PRIORITY.mine, { allow404: true });
  const g = summarizeMyGame(m, t, p.puuid, p.riotId);
  if (g) ctx.store.putGame(g);
};

export const HANDLERS: Record<string, Handler> = { account, myMatchIds, myMatch };

/** Libellés pour l'affichage. */
export const JOB_LABELS: Record<string, string> = {
  account: "Comptes",
  myMatchIds: "Listes de parties",
  myMatch: "Mes parties",
};
