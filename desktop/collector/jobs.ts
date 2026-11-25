// Travaux de la collecte. Chaque travail est idempotent : le refaire après une interruption ne crée pas de doublon.
//
//   account       Riot ID → PUUID (account-v1), puis listes des parties
//   myMatchIds    une page de 100 parties Solo/Duo de la saison en cours (rafraîchie régulièrement)
//   myHistoryIds  une page de 100 parties Solo/Duo de tout l'historique disponible (parcouru une fois,
//                 jusqu'à ce que l'API ne renvoie plus rien), en priorité plus basse
//   myMatch       une partie de la saison en cours + sa chronologie (2 requêtes) → my_games
//   myOldMatch    idem pour une partie d'une saison précédente
//   myMastery     ta maîtrise de champion (points, tous champions), une fois par jour et par compte
//   myReread      relecture (v6) d'une de tes parties : chronologie complète (carte, objectifs)
//   myDetail      détail anonyme d'une partie enregistrée avant la v8 (partie + chronologie : analyses poussées)
//   myDamage      complète une partie enregistrée avant la v7 : tes dégâts aux champions (la partie seule)
//   myRefresh     relecture d'une partie enregistrée avant la v4 (participation aux kills), une seule fois
import { SEASON_START } from "../../scripts/riot/season.ts";
import { parseRiotId } from "../../scripts/riot/config.ts";
import { PRIORITY, type RiotScheduler } from "./scheduler.ts";
import type { CollectorStore } from "./store.ts";
import { damageOf, summarizeMyGame, type MatchV5, type TimelineV5 } from "./my-games.ts";
import { cleanDetail, packDetail } from "./detail.ts";
import { META_LABELS, metaJungleMastery, metaLeague, metaMatch, metaPlayer, metaTimeline } from "./meta-jobs.ts";

export const QUEUE_SOLO_DUO = 420;
/** Normale en draft : seule file hors classée aux règles standard de la Faille gardée pour les stats. */
export const QUEUE_DRAFT_NORMAL = 400;
const PAGE = 100;
/** Délai minimal entre deux vérifications de nouvelles parties sur un compte. */
export const REFRESH_MS = 20 * 60_000;

export interface JobContext {
  store: CollectorStore;
  api: RiotScheduler;
  now: () => number;
  /** Ton pool (clés de champions) : ordre d'achat collecté pour ces champions dans la méta. */
  pool: () => Set<number>;
}

type Handler = (ctx: JobContext, payload: never) => Promise<void>;

export const accountKey = (riotId: string) => `account:${riotId.toLocaleLowerCase()}`;
export const idsKey = (puuid: string, start: number) => `myMatchIds:${puuid}:${start}`;
export const historyKey = (puuid: string, start: number) => `myHistoryIds:${puuid}:${start}`;
export const allIdsKey = (puuid: string, start: number) => `myAllIds:${puuid}:${start}`;
/** Tous les modes : après l'historique classé (même priorité), pour ne pas relire des parties classées pas encore enregistrées. */
const ALL_MODES_RANK = 10;
/** Même clé pour une partie, qu'elle vienne de la liste de la saison ou de l'historique : jamais deux fois. */
export const matchKey = (matchId: string, puuid: string) => `myMatch:${matchId}:${puuid}`;

/** Ajoute (ou relance si le dernier passage est ancien) la recherche de parties pour tes comptes. */
/** Tes parties relues pour l'analyse (v6), par compte : toutes (-1 = sans limite, comme LIMIT -1 en SQLite). */
export const REREAD_LAST = -1;

/** `force` : vérifie tout de suite les nouvelles parties (fin de partie), sans attendre REFRESH_MS. */
export function scheduleAccounts(ctx: JobContext, riotIds: string[], force = false): void {
  for (const riotId of riotIds) {
    const key = accountKey(riotId);
    const puuid = ctx.store.get(key);
    if (!puuid) {
      if (!ctx.store.enqueue("account", key, PRIORITY.mine, { riotId })) ctx.store.requeue(key);
      continue;
    }
    refreshIds(ctx, puuid, riotId, force);
    scheduleMastery(ctx, puuid, riotId);
    scheduleReread(ctx, puuid, riotId);
    scheduleDamage(ctx, puuid, riotId);
    scheduleDetail(ctx, puuid, riotId);
  }
  scheduleRefresh(ctx, riotIds);
}

const DAY_MS = 86_400_000;
export const masteryKey = (riotId: string, now: number) => `myMastery:${riotId.toLocaleLowerCase()}:${Math.floor(now / DAY_MS)}`;

/** Maîtrise du compte : une fois par jour (clé datée). */
function scheduleMastery(ctx: JobContext, puuid: string, riotId: string): void {
  ctx.store.enqueue("myMastery", masteryKey(riotId, ctx.now()), PRIORITY.mine, { puuid, riotId });
}

const myMastery: Handler = async (ctx, p: { puuid: string; riotId: string }) => {
  const rows = (await ctx.api.get<{ championId: number; championPoints: number; championLevel: number; lastPlayTime: number }[]>(
    "euw1", `/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(p.puuid)}`, PRIORITY.mine)) ?? [];
  ctx.store.putMyMastery(p.riotId, rows.map((r) => ({ championId: r.championId, points: r.championPoints, level: r.championLevel, lastPlayMs: r.lastPlayTime })));
};

/** Relecture v6 de tes dernières parties (carte des kills et morts, objectifs) : une fois par partie. */
function scheduleReread(ctx: JobContext, puuid: string, riotId: string): void {
  const todo = ctx.store.gamesWithoutTimeline(riotId, REREAD_LAST);
  if (!todo.length) return;
  ctx.store.tx(() => {
    for (const matchId of todo) ctx.store.enqueue("myReread", `myReread:${matchId}:${puuid}`, PRIORITY.mineOld, { matchId, puuid, riotId, prio: PRIORITY.mineOld });
  });
}

/** Parties sans détail (avant la v8) : relues une fois (partie + chronologie). */
function scheduleDetail(ctx: JobContext, puuid: string, riotId: string): void {
  const todo = ctx.store.gamesWithoutDetail(riotId);
  if (!todo.length) return;
  ctx.store.tx(() => {
    for (const matchId of todo) ctx.store.enqueue("myDetail", `myDetail:${matchId}:${puuid}`, PRIORITY.mineOld, { matchId, puuid, riotId, prio: PRIORITY.mineOld });
  });
}

/** Parties sans dégâts (avant la v7) : relecture légère, une fois par partie. */
function scheduleDamage(ctx: JobContext, puuid: string, riotId: string): void {
  const todo = ctx.store.gamesWithoutDamage(riotId);
  if (!todo.length) return;
  ctx.store.tx(() => {
    for (const matchId of todo) ctx.store.enqueue("myDamage", `myDamage:${matchId}:${puuid}`, PRIORITY.mineOld, { matchId, puuid, riotId });
  });
}

const myDamage: Handler = async (ctx, p: { matchId: string; puuid: string; riotId: string }) => {
  const m = await ctx.api.get<MatchV5>("europe", `/lol/match/v5/matches/${encodeURIComponent(p.matchId)}`, PRIORITY.mineOld, { allow404: true });
  const me = m?.info.participants.find((x) => x.puuid === p.puuid);
  if (!m || !me) return;
  const mates = m.info.participants.filter((x) => me.teamId == null || x.teamId === me.teamId);
  const d = damageOf(me, mates);
  ctx.store.setDamage(p.matchId, p.riotId, d.damage, d.teamDamage);
};

/** Parties enregistrées avant la v4 : relues une fois, en priorité basse (clé unique : jamais deux fois). */
function scheduleRefresh(ctx: JobContext, riotIds: string[]): void {
  const todo = ctx.store.gamesToRefresh();
  if (!todo.length) return;
  ctx.store.tx(() => {
    for (const g of todo) {
      const riotId = riotIds.find((r) => r === g.account);
      const puuid = riotId && ctx.store.get(accountKey(riotId));
      if (puuid) ctx.store.enqueue("myRefresh", `myRefresh:${g.matchId}:${puuid}`, PRIORITY.mineOld, { matchId: g.matchId, puuid, riotId, prio: PRIORITY.mineOld });
    }
  });
}

/** Relance la 1ʳᵉ page de la saison si elle date de plus de REFRESH_MS ; lance l'historique une fois. */
function refreshIds(ctx: JobContext, puuid: string, riotId: string, force = false): void {
  ctx.store.enqueue("myHistoryIds", historyKey(puuid, 0), PRIORITY.mineOld, { puuid, riotId, start: 0 });
  const key = idsKey(puuid, 0);
  const st = ctx.store.jobStatus(key);
  if (!st) ctx.store.enqueue("myMatchIds", key, PRIORITY.mine, { puuid, riotId, start: 0 });
  else if (st.status !== "pending" && st.status !== "running" && (force || ctx.now() - st.updatedAt >= REFRESH_MS)) ctx.store.requeue(key);
  // Tous les modes (expérience sur un champion, normales en draft) : même rythme, priorité basse.
  const all = allIdsKey(puuid, 0);
  const sa = ctx.store.jobStatus(all);
  if (!sa) ctx.store.enqueue("myAllIds", all, PRIORITY.mineOld, { puuid, riotId, start: 0 }, ALL_MODES_RANK);
  else if (sa.status !== "pending" && sa.status !== "running" && (force || ctx.now() - sa.updatedAt >= REFRESH_MS)) ctx.store.requeue(all);
}

const account: Handler = async (ctx, p: { riotId: string }) => {
  const id = parseRiotId(p.riotId);
  if (!id) throw new Error(`Riot ID invalide : ${p.riotId}`);
  const acc = await ctx.api.get<{ puuid: string }>("europe", `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(id[0])}/${encodeURIComponent(id[1])}`, PRIORITY.mine, { allow404: true });
  if (!acc) throw new Error(`Compte ${p.riotId} introuvable.`);
  ctx.store.set(accountKey(p.riotId), acc.puuid);
  refreshIds(ctx, acc.puuid, p.riotId);
  scheduleMastery(ctx, acc.puuid, p.riotId);
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

/**
 * Liste de toutes tes parties, tous modes : chaque partie inconnue est lue une fois (champion, mode, victoire).
 * Page suivante tant que la page est pleine et apporte du nouveau (au premier passage : tout l'historique de l'API).
 */
const myAllIds: Handler = async (ctx, p: IdsPayload) => {
  const q = new URLSearchParams({ start: String(p.start), count: String(PAGE) });
  const ids = (await ctx.api.get<string[]>("europe", `/lol/match/v5/matches/by-puuid/${encodeURIComponent(p.puuid)}/ids?${q}`, PRIORITY.mineOld)) ?? [];
  let fresh = 0;
  ctx.store.tx(() => {
    for (const matchId of ids) {
      if (ctx.store.knownGame(matchId, p.riotId)) continue;
      if (ctx.store.enqueue("myOther", `myOther:${matchId}:${p.puuid}`, PRIORITY.mineOld, { matchId, puuid: p.puuid, riotId: p.riotId }, ALL_MODES_RANK)) fresh++;
    }
    if (ids.length === PAGE && fresh > 0) {
      const next = allIdsKey(p.puuid, p.start + PAGE);
      if (!ctx.store.enqueue("myAllIds", next, PRIORITY.mineOld, { ...p, start: p.start + PAGE }, ALL_MODES_RANK)) ctx.store.requeue(next);
    }
  });
};

/** Partie hors Solo/Duo : champion, mode, victoire ; normale en draft : aussi son détail anonyme (stats). */
const myOther: Handler = async (ctx, p: { matchId: string; puuid: string; riotId: string }) => {
  const m = await ctx.api.get<MatchV5>("europe", `/lol/match/v5/matches/${encodeURIComponent(p.matchId)}`, PRIORITY.mineOld, { allow404: true });
  if (!m || m.info.queueId === QUEUE_SOLO_DUO) return; // Solo/Duo : déjà lue par la collecte de tes parties
  const me = (m.info.participants as unknown as { puuid: string; championId: number; teamPosition?: string; win: boolean; gameEndedInEarlySurrender?: boolean }[]).find((x) => x.puuid === p.puuid);
  if (!me) return;
  const start = (m.info as { gameStartTimestamp?: number }).gameStartTimestamp ?? m.info.gameCreation;
  ctx.store.putOtherGame({ matchId: p.matchId, account: p.riotId, startMs: start, queue: m.info.queueId, championId: me.championId, role: me.teamPosition ?? "", win: me.win, remake: !!me.gameEndedInEarlySurrender });
  if (m.info.queueId === QUEUE_DRAFT_NORMAL && !me.gameEndedInEarlySurrender) {
    const t = await ctx.api.get<TimelineV5>("europe", `/lol/match/v5/matches/${encodeURIComponent(p.matchId)}/timeline`, PRIORITY.mineOld, { allow404: true });
    ctx.store.putDetail(p.matchId, p.riotId, packDetail(cleanDetail(p.riotId, m as never, t as never, p.puuid)));
  }
};

const myMatchIds: Handler = (ctx, p: IdsPayload) => listPage(ctx, p, "season");
const myHistoryIds: Handler = (ctx, p: IdsPayload) => listPage(ctx, p, "history");

const myMatch: Handler = async (ctx, p: { matchId: string; puuid: string; riotId: string; prio?: number }) => {
  const prio = p.prio ?? PRIORITY.mine;
  const m = await ctx.api.get<MatchV5>("europe", `/lol/match/v5/matches/${encodeURIComponent(p.matchId)}`, prio, { allow404: true });
  if (!m || m.info.queueId !== QUEUE_SOLO_DUO) return;
  // Chronologie absente pour certaines parties anciennes : or et CS à 15 min restent vides.
  const t = await ctx.api.get<TimelineV5>("europe", `/lol/match/v5/matches/${encodeURIComponent(p.matchId)}/timeline`, prio, { allow404: true });
  const g = summarizeMyGame(m, t, p.puuid, p.riotId);
  if (!g) return;
  ctx.store.putGame(g);
  // Détail anonyme (aucun PUUID ni pseudo) pour les analyses poussées.
  ctx.store.putDetail(p.matchId, p.riotId, packDetail(cleanDetail(p.riotId, m as never, t as never, p.puuid)));
};

export const HANDLERS: Record<string, Handler> = {
  account, myMatchIds, myHistoryIds, myMatch, myAllIds, myOther, myOldMatch: myMatch, myRefresh: myMatch, myMastery, myReread: myMatch, myDamage, myDetail: myMatch,
  metaLeague: metaLeague as Handler, metaPlayer: metaPlayer as Handler, metaMatch: metaMatch as Handler, metaTimeline: metaTimeline as Handler, metaJungleMastery: metaJungleMastery as Handler,
};

/** Libellés pour l'affichage. */
export const JOB_LABELS: Record<string, string> = {
  account: "Comptes",
  myMatchIds: "Listes de parties (saison)",
  myMatch: "Mes parties (saison)",
  myHistoryIds: "Listes de parties (anciennes saisons)",
  myAllIds: "Listes de parties (tous modes)",
  myOther: "Parties hors classée (expérience, normales en draft)",
  myOldMatch: "Mes parties (anciennes saisons)",
  myMastery: "Ma maîtrise de champion",
  myReread: "Mes parties : relecture pour l'analyse",
  myDamage: "Mes parties : dégâts (radar)",
  myDetail: "Mes parties : détail pour l'analyse",
  myRefresh: "Mes parties : participation aux kills (mise à jour)",
  ...META_LABELS,
};
