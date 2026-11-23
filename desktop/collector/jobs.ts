// Travaux de la collecte. Chaque travail est idempotent : le refaire après une interruption ne crée pas de doublon.
//
//   account       Riot ID → PUUID (account-v1), puis listes des parties
//   myMatchIds    une page de 100 parties Solo/Duo de la saison en cours (rafraîchie régulièrement)
//   myHistoryIds  une page de 100 parties Solo/Duo de tout l'historique disponible (parcouru une fois,
//                 jusqu'à ce que l'API ne renvoie plus rien), en priorité plus basse
//   myMatch       une partie de la saison en cours + sa chronologie (2 requêtes) → my_games
//   myOldMatch    idem pour une partie d'une saison précédente
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
export const historyKey = (puuid: string, start: number) => `myHistoryIds:${puuid}:${start}`;
/** Même clé pour une partie, qu'elle vienne de la liste de la saison ou de l'historique : jamais deux fois. */
export const matchKey = (matchId: string, puuid: string) => `myMatch:${matchId}:${puuid}`;

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

/** Relance la 1ʳᵉ page de la saison si elle date de plus de REFRESH_MS ; lance l'historique une fois. */
function refreshIds(ctx: JobContext, puuid: string, riotId: string): void {
  ctx.store.enqueue("myHistoryIds", historyKey(puuid, 0), PRIORITY.mineOld, { puuid, riotId, start: 0 });
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

interface IdsPayload { puuid: string; riotId: string; start: number }

/** Une page de la liste des parties ; la suivante est ajoutée tant que la page est pleine. */
async function listPage(ctx: JobContext, p: IdsPayload, scope: "season" | "history"): Promise<void> {
  const season = scope === "season";
  const prio = season ? PRIORITY.mine : PRIORITY.mineOld;
  const q = new URLSearchParams({ queue: String(QUEUE_SOLO_DUO), start: String(p.start), count: String(PAGE) });
  // Sans startTime, match-v5 renvoie tout l'historique qu'il conserve : on remonte aussi loin que l'API le permet.
  if (season) q.set("startTime", String(Math.floor(SEASON_START / 1000)));
  const ids = (await ctx.api.get<string[]>("europe", `/lol/match/v5/matches/by-puuid/${encodeURIComponent(p.puuid)}/ids?${q}`, prio)) ?? [];
  let fresh = 0;
  ctx.store.tx(() => {
    for (const matchId of ids) {
      if (ctx.store.enqueue(season ? "myMatch" : "myOldMatch", matchKey(matchId, p.puuid), prio, { matchId, puuid: p.puuid, riotId: p.riotId, prio })) fresh++;
    }
    if (ids.length === PAGE) {
      const nextP = { ...p, start: p.start + PAGE };
      if (season) {
        // Au rafraîchissement, on ne continue que s'il y avait du nouveau.
        const next = idsKey(p.puuid, nextP.start);
        if (!ctx.store.enqueue("myMatchIds", next, prio, nextP) && fresh > 0) ctx.store.requeue(next);
      } else {
        ctx.store.enqueue("myHistoryIds", historyKey(p.puuid, nextP.start), prio, nextP);
      }
    }
  });
}

const myMatchIds: Handler = (ctx, p: IdsPayload) => listPage(ctx, p, "season");
const myHistoryIds: Handler = (ctx, p: IdsPayload) => listPage(ctx, p, "history");

const myMatch: Handler = async (ctx, p: { matchId: string; puuid: string; riotId: string; prio?: number }) => {
  const prio = p.prio ?? PRIORITY.mine;
  const m = await ctx.api.get<MatchV5>("europe", `/lol/match/v5/matches/${encodeURIComponent(p.matchId)}`, prio, { allow404: true });
  if (!m || m.info.queueId !== QUEUE_SOLO_DUO) return;
  // Chronologie absente pour certaines parties anciennes : or et CS à 15 min restent vides.
  const t = await ctx.api.get<TimelineV5>("europe", `/lol/match/v5/matches/${encodeURIComponent(p.matchId)}/timeline`, prio, { allow404: true });
  const g = summarizeMyGame(m, t, p.puuid, p.riotId);
  if (g) ctx.store.putGame(g);
};

export const HANDLERS: Record<string, Handler> = { account, myMatchIds, myHistoryIds, myMatch, myOldMatch: myMatch };

/** Libellés pour l'affichage. */
export const JOB_LABELS: Record<string, string> = {
  account: "Comptes",
  myMatchIds: "Listes de parties (saison)",
  myMatch: "Mes parties (saison)",
  myHistoryIds: "Listes de parties (anciennes saisons)",
  myOldMatch: "Mes parties (anciennes saisons)",
};
