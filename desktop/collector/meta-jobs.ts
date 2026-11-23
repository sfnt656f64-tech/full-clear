// Collecte de la méta Émeraude+ EUW (API Riot officielle uniquement, aucun site tiers).
//
//   metaLeague    une page de league-v4 (Émeraude/Diamant I–IV, ou Master/Grandmaster/Challenger) :
//                 joueurs actifs tirés au hasard, relus chaque semaine
//   metaPlayer    les 10 dernières parties Solo/Duo du joueur (14 jours)
//   metaMatch     la partie → 10 lignes anonymes ; maîtrise du joueur source sur son champion
//   metaTimeline  ordre d'achat des items (champions de ton pool), et début de partie des 10 participants
//                 (kills, assists avant 15 min, or à 15 min), pour les parties où figure un champion de ton pool
//
// Confidentialité : le PUUID d'un joueur ne sert qu'à interroger l'API. La clé de dédoublonnage est un
// hachage, et le contenu des travaux metaPlayer / metaMatch est effacé une fois terminés.
import { createHash } from "node:crypto";
import { PRIORITY } from "./scheduler.ts";
import type { JobContext } from "./jobs.ts";
import { buildOrders, earlyStats, summarizeMetaMatch, type MetaMatchV5, type TimelineEventsV5 } from "./meta-parse.ts";
import type { TimelineV5 } from "./my-games.ts";

const QUEUE = "RANKED_SOLO_5x5";
const QUEUE_ID = 420;
export const DIVISION_TIERS = ["EMERALD", "DIAMOND"] as const;
export const DIVISIONS = ["I", "II", "III", "IV"] as const;
/**
 * Ligues du sommet : peu de joueurs tirés, pour que la méta reste celle d'Émeraude–Diamant
 * (8 divisions × 40 joueurs par page, sur plusieurs pages).
 */
export const APEX: Record<string, { path: string; sample: number }> = {
  MASTER: { path: "masterleagues", sample: 80 },
  GRANDMASTER: { path: "grandmasterleagues", sample: 30 },
  CHALLENGER: { path: "challengerleagues", sample: 15 },
};
/** Joueurs tirés par page de 205 (Émeraude/Diamant), et pages lues au plus par division et par semaine. */
export const SAMPLE_PER_PAGE = 40;
export const MAX_PAGES = 15;
/** Parties récentes demandées par joueur, sur cette fenêtre. */
const MATCHES_PER_PLAYER = 10;
const WINDOW_MS = 14 * 86_400_000;
/** Patchs gardés en base (les plus récents). */
export const KEEP_PATCHES = 3;

/**
 * Ordre dans la file (même priorité) : chronologies, parties, 1ʳᵉ page de chaque classement, joueurs (aléatoire,
 * entre 0 et 1), et enfin les pages suivantes. Les pages passent par euw1 : si elles passaient toutes avant les
 * joueurs, le quota europe (parties) resterait inutilisé pendant plusieurs minutes.
 */
const RANK = { timeline: -2, match: -1, league: 0, nextPage: 2 } as const;

/** Les travaux dont le contenu (PUUID) est effacé une fois terminés. */
export const FORGET_KINDS = new Set(["metaPlayer", "metaMatch"]);

export const hashId = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 20);
const week = (now: number): number => Math.floor(now / (7 * 86_400_000));

interface LeagueEntry { puuid?: string; wins: number; losses: number; inactive?: boolean }

/** Pages de league-v4 de la semaine (sans effet si déjà en file). */
export function scheduleMeta(ctx: JobContext): void {
  const w = week(ctx.now());
  for (const tier of DIVISION_TIERS) {
    for (const division of DIVISIONS) ctx.store.enqueue("metaLeague", `metaLeague:${tier}:${division}:1:${w}`, PRIORITY.meta, { tier, division, page: 1, week: w }, RANK.league);
  }
  for (const tier of Object.keys(APEX)) ctx.store.enqueue("metaLeague", `metaLeague:${tier}:${w}`, PRIORITY.meta, { tier, week: w }, RANK.league);
}

/** Tirage sans remise de `n` éléments. */
function sample<T>(list: T[], n: number, rnd: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export async function metaLeague(ctx: JobContext, p: { tier: string; division?: string; page?: number; week: number }, rnd = Math.random): Promise<void> {
  const apex = APEX[p.tier];
  const entries = apex
    ? ((await ctx.api.get<{ entries: LeagueEntry[] }>("euw1", `/lol/league/v4/${apex.path}/by-queue/${QUEUE}`, PRIORITY.meta))?.entries ?? [])
    : ((await ctx.api.get<LeagueEntry[]>("euw1", `/lol/league/v4/entries/${QUEUE}/${p.tier}/${p.division}?page=${p.page}`, PRIORITY.meta)) ?? []);
  // Joueurs actifs avec assez de parties pour que leur rang soit représentatif.
  const active = entries.filter((e): e is LeagueEntry & { puuid: string } => !!e.puuid && !e.inactive && e.wins + e.losses >= 20);
  ctx.store.tx(() => {
    for (const e of sample(active, apex ? apex.sample : SAMPLE_PER_PAGE, rnd)) {
      ctx.store.enqueue("metaPlayer", `metaPlayer:${hashId(e.puuid)}:${p.week}`, PRIORITY.meta, { puuid: e.puuid, tier: p.tier }, rnd());
    }
    if (!apex && entries.length >= 205 && (p.page ?? 1) < MAX_PAGES) {
      const page = (p.page ?? 1) + 1;
      ctx.store.enqueue("metaLeague", `metaLeague:${p.tier}:${p.division}:${page}:${p.week}`, PRIORITY.meta, { ...p, page }, RANK.nextPage);
    }
  });
}

export async function metaPlayer(ctx: JobContext, p: { puuid: string; tier: string }): Promise<void> {
  const q = new URLSearchParams({ queue: String(QUEUE_ID), startTime: String(Math.floor((ctx.now() - WINDOW_MS) / 1000)), count: String(MATCHES_PER_PLAYER) });
  const ids = (await ctx.api.get<string[]>("europe", `/lol/match/v5/matches/by-puuid/${encodeURIComponent(p.puuid)}/ids?${q}`, PRIORITY.meta)) ?? [];
  ctx.store.tx(() => {
    for (const matchId of ids) {
      if (!ctx.store.hasMetaGame(matchId)) ctx.store.enqueue("metaMatch", `metaMatch:${matchId}`, PRIORITY.meta, { matchId, puuid: p.puuid, tier: p.tier }, RANK.match);
    }
  });
}

let sinceLastPurge = 0;

export async function metaMatch(ctx: JobContext, p: { matchId: string; puuid: string; tier: string }): Promise<void> {
  if (ctx.store.hasMetaGame(p.matchId)) return;
  const m = await ctx.api.get<MetaMatchV5>("europe", `/lol/match/v5/matches/${encodeURIComponent(p.matchId)}`, PRIORITY.meta, { allow404: true });
  if (!m || m.info.queueId !== QUEUE_ID) return;
  const g = summarizeMetaMatch(m);
  ctx.store.putMetaGame(g, p.tier);
  if (g.remake) return;

  // Maîtrise du joueur source sur le champion joué (difficulté de prise en main).
  const src = m.info.participants.find((x) => x.puuid === p.puuid);
  if (src) {
    const mastery = await ctx.api.get<{ championPoints: number }>("euw1",
      `/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(p.puuid)}/by-champion/${src.championId}`, PRIORITY.meta, { allow404: true });
    ctx.store.putMastery(g.matchId, src.championId, src.teamPosition ?? "", src.win, mastery?.championPoints ?? 0);
  }

  // Ordre d'achat : seulement pour les champions de ton pool (1 requête de plus).
  const pool = ctx.pool();
  const parts = g.parts.filter((x) => pool.has(x.championId)).map((x) => ({ pid: x.participantId, championId: x.championId, role: x.role, win: x.win }));
  if (parts.length) ctx.store.enqueue("metaTimeline", `metaTimeline:${g.matchId}`, PRIORITY.meta, { matchId: g.matchId, parts }, RANK.timeline);

  if (++sinceLastPurge >= 200) {
    sinceLastPurge = 0;
    ctx.store.purgeMeta(ctx.store.metaPatches().slice(0, KEEP_PATCHES).map((x) => x.patch));
  }
}

export async function metaTimeline(ctx: JobContext, p: { matchId: string; parts: { pid: number; championId: number; role: string; win: boolean }[] }): Promise<void> {
  const t = await ctx.api.get<TimelineEventsV5 & TimelineV5>("europe", `/lol/match/v5/matches/${encodeURIComponent(p.matchId)}/timeline`, PRIORITY.meta, { allow404: true });
  if (!t) return;
  const orders = buildOrders(t, p.parts.map((x) => x.pid));
  const early = earlyStats(t, ctx.store.metaTeams(p.matchId));
  ctx.store.tx(() => {
    ctx.store.putEarly(p.matchId, early);
    for (const x of p.parts) ctx.store.putBuild(p.matchId, x.pid, x.championId, x.role, x.win, orders.get(x.pid) ?? []);
  });
}

export const META_LABELS: Record<string, string> = {
  metaLeague: "Méta : pages de classement",
  metaPlayer: "Méta : joueurs",
  metaMatch: "Méta : parties",
  metaTimeline: "Méta : ordres d'achat",
};
