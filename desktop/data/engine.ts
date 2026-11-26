// Moteur de données : tous les calculs lourds de l'appli (onglet Analyse, objectifs, recommandations, méta, draft,
// build en jeu). Il tourne dans un worker (engine-worker.ts), jamais dans le processus principal : la fenêtre
// ne se fige plus pendant un calcul.
//
// Caches :
// - tes parties : relues seulement quand la base change (version = nombre et dernier identifiant des lignes) ;
//   le détail des parties (décompression) est incrémental : seules les nouvelles parties sont décodées ;
// - la méta : relue au plus toutes les 10 minutes (elle grossit en continu pendant la collecte, sans changer
//   les résultats d'une minute à l'autre) ;
// - les vues : gardées tant que ni la base ni les paramètres ne changent.
import { DEFAULT_REF_TIER, REF_TIERS, type RefInfo, type RefTier } from "../analysis/ref-tier.ts";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { champByKey, findChamp } from "../../src/data/champions";
import { readMyGames, readMyMastery } from "../stats/read.ts";
import { readGankData, readMeta, readMetaMastery, readMetaPatches } from "../meta/read.ts";
import { metaStats } from "../meta/meta-stats.ts";
import { recommend } from "../reco/recommend.ts";
import { progressPriority } from "../reco/progress-draft.ts";
import { draftPicks, pairIndex, type DraftPicks, type PairIndex } from "../reco/draft-pick.ts";
import { laneRows, roleShares, type Lane, type LaneRow, type RoleShares } from "../reco/lanes.ts";
import { potentialGroups, type PotentialGroups } from "../reco/potential.ts";
import { compoStrengths, poolAdvice, type PoolAdvice } from "../reco/pool-advice.ts";
import { metaStyles } from "../reco/recommend.ts";
import type { MetaTrend } from "../ipc.ts";
import { guidePage, metaPage, type RecommendedPage } from "../runes/rune-page.ts";
import { gamePlan, type GamePlan } from "../coach/game-plan.ts";
import { remindersFrom, strategy, type Reminder, type Strategy } from "../coach/strategy.ts";
import { statBuild, type StatBuild } from "../coach/stat-build.ts";
import { SHOP, type MatchChampions } from "../next-item.ts";
import { readAllMyEvents, readAnalysisGames, readMetaDuels, readMetaMetrics, readMyEvents } from "../analysis/read.ts";
import { analyseGame, type AnalysisGame, type DuelValues, type MetaMetricRow, type Values } from "../analysis/analysis.ts";
import { championTable, evolution, filterGames, MetaRef, overview, type OverviewFilter } from "../analysis/overview.ts";
import { radarOf } from "../analysis/radar.ts";
import { DEFAULT_GOALS, gameMetrics, goalsView, type GameMetrics, type GoalsView } from "../analysis/goals.ts";
import { unpackDetail } from "../collector/detail.ts";
import { myDuelValues, opponentValues } from "../analysis/opponent.ts";
import type { DraftSnapshot } from "../champ-select.ts";
import type { ChampLite, DraftView } from "../draft-view.ts";
import type { AnalysisView, MetaView, OverviewView, PoolGoal, ProgressionView, RecoView, TrackEntry } from "../ipc.ts";
import ddChamps from "../../src/data/generated/champions.json";
import { METRICS as ALL_METRICS } from "../analysis/analysis.ts";
import { AXES } from "../analysis/radar.ts";
import { myGameFromDetail } from "../analysis/opponent.ts";
import { postGame, type PostGame } from "../analysis/postgame.ts";
import { DEFAULT_TAU, firstGamesEffect, statsSpread, WEIGHTS, type AxisGame } from "../reco/progress.ts";
import { readJungleMastery, readJungleMeta, readOtherGames } from "../reco/progress-read.ts";
import { progressAdvice, progression, readiness, RIFT_QUEUES, STAGE_LABEL, STANDARD_QUEUES, type ChampionFlag } from "../reco/progression.ts";

const DIFFICULTY = new Map((Object.values(ddChamps) as { key: string | number; info: { difficulty: number } }[]).map((x) => [Number(x.key), x.info.difficulty]));
import type { MyGameRow } from "../stats/my-stats.ts";

/** Patchs de méta pour les recommandations : les 2 derniers (équilibrage actuel, assez de parties). */
const RECO_PATCHES = 2;
/** La méta est relue au plus toutes les 10 minutes. */
const META_TTL = 10 * 60_000;
const DRAFT_ROLES: Record<string, string> = { jungle: "JUNGLE", middle: "MIDDLE" };
const ALL_ROLES: Record<string, string> = { top: "TOP", jungle: "JUNGLE", middle: "MIDDLE", bottom: "BOTTOM", utility: "UTILITY" };
/** Réglages utiles à la draft (mode du pool, drapeaux, référence, objectifs). */
export interface DraftContext { goal: PoolGoal; flags: Record<string, ChampionFlag>; tier: RefTier; goalsStartMs: number | null; targets: Record<string, number> }
export const DEFAULT_DRAFT_CONTEXT: DraftContext = { goal: "win", flags: {}, tier: DEFAULT_REF_TIER, goalsStartMs: null, targets: {} };
/** Grille de la carte de chaleur (cases de 155 unités). */
export const HEAT_GRID = 96;
const MAP_SIZE = 14_900;

export interface Heat {
  /**
   * Cases non vides, en liste plate [indice, nombre, indice, nombre…], pour les kills et les morts avant et après
   * 15 min (« toute la partie » = la somme des deux, faite dans la fenêtre).
   */
  kills: { early: number[]; late: number[] };
  deaths: { early: number[]; late: number[] };
}

export class Engine {
  private readonly dbFile: string;
  constructor(dbFile: string) { this.dbFile = dbFile; }

  // ---------- Version de tes données ----------

  private versionMemo: { at: number; v: string } | null = null;
  /** Change quand une de tes parties, son détail ou ses événements sont ajoutés ou relus (requête très légère). */
  myVersion(): string {
    if (this.versionMemo && Date.now() - this.versionMemo.at < 500) return this.versionMemo.v;
    let v = "0";
    if (existsSync(this.dbFile)) {
      let db: DatabaseSync | null = null;
      try {
        db = new DatabaseSync(this.dbFile, { readOnly: true });
        db.exec("pragma busy_timeout = 2000");
        const r = db.prepare(`select (select count(*) from my_games) a, (select coalesce(max(rowid), 0) from my_games) b,
          (select count(*) from my_detail) c, (select coalesce(max(rowid), 0) from my_detail) d, (select count(*) from my_events) e`).get() as Record<string, number>;
        v = `${r.a}.${r.b}.${r.c}.${r.d}.${r.e}`;
      } catch {
        v = "x"; // tables pas encore créées
      } finally {
        db?.close();
      }
    }
    this.versionMemo = { at: Date.now(), v };
    return v;
  }

  // ---------- Méta (relue au plus toutes les 10 minutes) ----------

  private metaCache = new Map<string, { at: number; value: unknown }>();
  private cached<T>(key: string, ttl: number, fn: () => T): T {
    const hit = this.metaCache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value as T;
    const value = fn();
    this.metaCache.set(key, { at: Date.now(), value });
    return value;
  }
  private patches(n: number): string[] { return this.cached(`patches`, META_TTL, () => readMetaPatches(this.dbFile)).slice(0, n).map((p) => p.patch); }
  private recentMeta() { return this.cached("recentMeta", META_TTL, () => readMeta(this.dbFile, this.patches(RECO_PATCHES))); }
  private pairs(): PairIndex { return this.cached("pairs", META_TTL, () => pairIndex(readMeta(this.dbFile, this.patches(3)).parts)); }
  private shares(): RoleShares { return this.cached("shares", META_TTL, () => roleShares(this.recentMeta().parts)); }
  private ganks() { return this.cached("ganks", META_TTL, () => readGankData(this.dbFile, this.patches(3))); }
  private metaRows(role: string, tier: RefTier): MetaMetricRow[] {
    return this.cached(`metaRows:${role}:${tier}`, META_TTL, () => {
      const duels = readMetaDuels(this.dbFile, this.patches(3), role, tier);
      return readMetaMetrics(this.dbFile, this.patches(3), role, tier).map((r) => ({ ...duels.get(`${r.matchId}|${r.participantId}`), ...r, gd15: r.gd15 }));
    });
  }
  private metaRef(roles: string[], tier: RefTier): MetaRef {
    const byRole = new Map(roles.map((r) => [r, this.metaRows(r, tier)]));
    const p = this.patches(1)[0];
    // Saison de la méta (16.x → 2026) : les parties d'une autre saison sont comparées à l'adversaire direct.
    return new MetaRef(byRole, p ? 2010 + Number(p.split(".")[0]) : null);
  }

  metaView(scope: number): MetaView {
    const n = Math.min(3, Math.max(1, Math.trunc(scope) || 1));
    return this.cached(`metaView:${n}`, 60_000, () => {
      const patches = readMetaPatches(this.dbFile);
      const selected = patches.slice(0, n).map((p) => p.patch);
      const input = readMeta(this.dbFile, selected);
      return { patches, selected, matches: input.matches, champions: metaStats(input) };
    });
  }

  // ---------- Tes parties (détail : décodage incrémental) ----------

  private detail = new Map<string, { rowid: number; metrics: GameMetrics | null; opp: Values | null; mine: DuelValues }>();
  private detailVersion = "";
  private details(): Map<string, { rowid: number; metrics: GameMetrics | null; opp: Values | null; mine: DuelValues }> {
    const v = this.myVersion();
    if (v === this.detailVersion) return this.detail;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(this.dbFile, { readOnly: true });
      db.exec("pragma busy_timeout = 2000");
      const rows = db.prepare("select rowid, match_id, account from my_detail").all() as { rowid: number; match_id: string; account: string }[];
      const keep = new Set<string>();
      const get = db.prepare("select data from my_detail where rowid = ?");
      for (const r of rows) {
        const key = `${r.match_id}|${r.account}`;
        keep.add(key);
        const known = this.detail.get(key);
        if (known && known.rowid === r.rowid) continue; // déjà décodée
        const d = unpackDetail((get.get(r.rowid) as { data: Uint8Array }).data);
        this.detail.set(key, { rowid: r.rowid, metrics: gameMetrics(d), opp: opponentValues(d), mine: myDuelValues(d) });
      }
      for (const k of [...this.detail.keys()]) if (!keep.has(k)) this.detail.delete(k);
      this.detailVersion = v;
    } catch {
      // table pas encore créée (avant la v8) : on garde ce qu'on a
    } finally {
      db?.close();
    }
    return this.detail;
  }

  private gamesMemo: { v: string; games: AnalysisGame[] } | null = null;
  /** Toutes tes parties pour l'analyse (avec ton adversaire direct), hors champions exclus. */
  private analysisGames(excluded: number[]): AnalysisGame[] {
    const v = this.myVersion();
    if (this.gamesMemo?.v !== v) {
      const det = this.details();
      this.gamesMemo = { v, games: readAnalysisGames(this.dbFile, -1, []).map((g) => { const x = det.get(`${g.matchId}|${g.account}`); return { ...x?.mine, ...g, opp: x?.opp ?? null }; }) };
    }
    const ex = new Set(excluded);
    return this.gamesMemo.games.filter((g) => !ex.has(g.championId));
  }

  private eventsMemo: { v: string; byGame: ReturnType<typeof readAllMyEvents> } | null = null;
  private allEvents() {
    const v = this.myVersion();
    if (this.eventsMemo?.v !== v) this.eventsMemo = { v, byGame: readAllMyEvents(this.dbFile) };
    return this.eventsMemo.byGame;
  }

  /** Résultats gardés tant que la base et les paramètres ne changent pas (méta : 10 minutes). */
  private viewMemo = new Map<string, { v: string; at: number; value: unknown }>();
  private memo<T>(key: string, fn: () => T): T {
    const v = this.myVersion();
    const hit = this.viewMemo.get(key);
    if (hit && hit.v === v && Date.now() - hit.at < META_TTL) return hit.value as T;
    const value = fn();
    this.viewMemo.set(key, { v, at: Date.now(), value });
    if (this.viewMemo.size > 50) this.viewMemo.delete(this.viewMemo.keys().next().value!);
    return value;
  }

  // ---------- Onglet Analyse ----------

/** Référence affichée : niveau choisi et parties de méta (joueurs) du rôle. */
  private refInfo(roles: string[], tier: RefTier): RefInfo {
    return { tier, label: REF_TIERS[tier].label, short: REF_TIERS[tier].short, games: roles.reduce((s, r) => s + this.metaRows(r, tier).length, 0) };
  }

  overview(filter: OverviewFilter, compare: number | null, excluded: number[], tier: RefTier = DEFAULT_REF_TIER): OverviewView {
    return this.memo(`overview:${JSON.stringify([filter, compare, excluded, tier])}`, () => {
      const all = this.analysisGames(excluded);
      const games = filterGames(all, filter);
      const roles = [...new Set(games.map((g) => g.role))];
      const ref = this.metaRef(roles, tier);
      // Champions proposés : ceux joués avec les autres filtres (rôle, période, compte).
      const forChamps = filterGames(all, { ...filter, championId: null });
      const counts = new Map<number, number>();
      for (const g of forChamps) counts.set(g.championId, (counts.get(g.championId) ?? 0) + 1);
      const seasons = [...new Set(all.map((g) => g.season).filter((s): s is number => !!s))].sort((a, b) => b - a);
      const cmp = compare != null && compare !== filter.championId ? forChamps.filter((g) => g.championId === compare) : null;
      return {
        filter,
        options: { champions: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, games: n })), seasons, accounts: [...new Set(all.map((g) => g.account))].sort() },
        overview: overview(games, ref, filter, seasons[0] ?? null),
        evolution: evolution(games),
        table: filter.championId == null ? championTable(games, ref) : null,
        heat: this.heat(games),
        radar: radarOf(games, ref),
        compare: cmp ? { championId: compare!, radar: radarOf(cmp, this.metaRef([...new Set(cmp.map((g) => g.role))], tier)) } : null,
        reference: this.refInfo(roles, tier),
        compareOptions: [...counts.entries()].filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]).map(([id]) => id),
      };
    });
  }

  /** Carte de chaleur prête à dessiner : nombre d'événements par case (au lieu de milliers de points). */
  private heat(games: AnalysisGame[]): Heat {
    const events = this.allEvents();
    const grids = { kills: { early: new Map<number, number>(), late: new Map<number, number>() }, deaths: { early: new Map<number, number>(), late: new Map<number, number>() } };
    const add = (m: Map<number, number>, i: number) => m.set(i, (m.get(i) ?? 0) + 1);
    for (const g of games) {
      for (const e of events.get(`${g.matchId}|${g.account}`) ?? []) {
        if (e.kind === "assist") continue;
        const gx = Math.min(HEAT_GRID - 1, Math.max(0, Math.floor((e.x / MAP_SIZE) * HEAT_GRID)));
        const gy = Math.min(HEAT_GRID - 1, Math.max(0, Math.floor((1 - e.y / MAP_SIZE) * HEAT_GRID)));
        const i = gy * HEAT_GRID + gx;
        const grid = e.kind === "kill" ? grids.kills : grids.deaths;
        add(e.t < 15 * 60_000 ? grid.early : grid.late, i);
      }
    }
    const pack = (m: Map<number, number>) => [...m.entries()].flat();
    return {
      kills: { early: pack(grids.kills.early), late: pack(grids.kills.late) },
      deaths: { early: pack(grids.deaths.early), late: pack(grids.deaths.late) },
    };
  }

  analysis(key: string | null, filter: OverviewFilter, excluded: number[], tier: RefTier = DEFAULT_REF_TIER): AnalysisView {
    return this.memo(`analysis:${JSON.stringify([key, filter, excluded, tier])}`, () => {
      const all = this.analysisGames(excluded);
      const games = filterGames(all, filter).slice(0, 30);
      const list = games.map((g) => ({ key: `${g.matchId}|${g.account}`, championId: g.championId, win: g.win, kda: `${g.kills}/${g.deaths}/${g.assists}`, startMs: g.startMs, role: g.role }));
      const game = games.find((g) => `${g.matchId}|${g.account}` === key) ?? games[0];
      if (!game) return { games: list, selected: null, analysis: null };
      const ref = this.metaRef([game.role], tier);
      const analysis = analyseGame(game, readMyEvents(this.dbFile, game.matchId, game.account), games, ref, REF_TIERS[tier].short);
      const same = all.filter((g) => g.championId === game.championId && g.role === game.role);
      return { games: list, selected: `${game.matchId}|${game.account}`, analysis, radar: { game: radarOf([game], ref, 1), average: radarOf(same, ref) }, reference: this.refInfo([game.role], tier) };
    });
  }

  goals(startMs: number, targets: Record<string, number>, excluded: number[]): GoalsView {
    return this.memo(`goals:${JSON.stringify([startMs, targets, excluded])}`, () => {
      const ex = new Set(excluded);
      const metrics = [...this.details().values()].flatMap((d) => (d.metrics && !ex.has(d.metrics.championId) ? [d.metrics] : []));
      return goalsView(metrics, startMs, DEFAULT_GOALS, targets);
    });
  }

  myGames(): MyGameRow[] { return this.memo("myGames", () => readMyGames(this.dbFile)); }

  // ---------- Recommandations ----------

  reco(excluded: number[], tier: RefTier = DEFAULT_REF_TIER, goal: PoolGoal = "win", flags: Record<string, ChampionFlag> = {}): RecoView {
    return this.memo(`reco:${excluded.join(",")}:${tier}:${goal}:${JSON.stringify(flags)}`, () => {
      const patches = this.patches(RECO_PATCHES);
      const input = this.recentMeta();
      const reco = recommend({ myGames: readMyGames(this.dbFile), meta: metaStats(input), metaParts: input.parts, mastery: readMetaMastery(this.dbFile), metaMatches: input.matches, excluded, myMastery: readMyMastery(this.dbFile) });
      const potential = this.potential(reco, excluded, tier);
      const styles = metaStyles(input.parts);
      const all = this.analysisGames(excluded);
      const season = Math.max(0, ...all.map((g) => g.season ?? 0));
      const advice: Record<string, PoolAdvice> = {};
      const trends: Record<string, Record<number, MetaTrend>> = {};
      for (const r of reco.roles) {
        const earlyIndex = new Map<number, number>();
        for (const [k, st] of styles) { const [id, role] = k.split("|"); if (role === r.role) earlyIndex.set(Number(id), st.early); }
        advice[r.role] = poolAdvice({
          role: r.role, groups: potential[r.role], pool: r.pool, tryList: r.tryList,
          myGames: all.filter((g) => g.role === r.role && g.season === season).map((g) => ({ championId: g.championId, win: g.win })),
          earlyIndex, compo: this.cached(`compo:${r.role}`, META_TTL, () => compoStrengths(input.parts, r.role)),
        });
        trends[r.role] = this.trends(r.role);
      }
      // Objectif « Progresser » (jungle) : 2 champions de progression + ton meilleur « À garder » en confort.
      const jungle = reco.roles.find((r) => r.role === "JUNGLE");
      if (goal === "progress" && jungle && potential.JUNGLE) {
        const p = this.progressionCore(excluded, tier, flags);
        advice.JUNGLE = progressAdvice(p, potential.JUNGLE.keep.map((k) => ({ championId: k.championId, games: k.games })), jungle.pool[0]?.championId ?? null) as unknown as PoolAdvice;
      }
      return { ...reco, patches, potential, advice, trends, goal, reference: this.refInfo(reco.roles.map((r) => r.role), tier) };
    });
  }

/** Win rate de chaque champion sur les deux derniers patchs (au moins 30 parties sur chacun). */
  private trends(role: string): Record<number, MetaTrend> {
    return this.cached(`trends:${role}`, META_TTL, () => {
      const [p0, p1] = this.patches(2);
      if (!p0 || !p1) return {};
      const stats = (p: string) => this.cached(`statsPatch:${p}`, META_TTL, () => metaStats(readMeta(this.dbFile, [p])));
      const prev = new Map(stats(p1).filter((m) => m.role === role).map((m) => [m.championId, m]));
      const out: Record<number, MetaTrend> = {};
      for (const m of stats(p0)) {
        const o = prev.get(m.championId);
        if (m.role !== role || !o || m.games < 30 || o.games < 30) continue;
        out[m.championId] = { delta: m.winRate - o.winRate, latest: { patch: p0, winRate: m.winRate, games: m.games }, previous: { patch: p1, winRate: o.winRate, games: o.games } };
      }
      return out;
    });
  }

// ---------- Progression ----------

  private flagMap(flags: Record<string, ChampionFlag>): Map<number, ChampionFlag> {
    const m = new Map<number, ChampionFlag>();
    for (const [id, f] of Object.entries(flags)) { const k = findChamp(id)?.key; if (k != null) m.set(k, f); }
    return m;
  }

  /** Parties de méta (jungle, référence choisie) avec leur position sur chaque axe : effet de tes axes forts. */
  private axisGames(tier: RefTier): Map<number, AxisGame[]> {
    return this.cached(`axisGames:${tier}`, META_TTL, () => {
      const ref = this.metaRef(["JUNGLE"], tier);
      const out = new Map<number, AxisGame[]>();
      for (const r of this.metaRows("JUNGLE", tier)) {
        const rad = radarOf([{ ...r, role: "JUNGLE" } as unknown as AnalysisGame], ref, 1);
        if (!rad) continue;
        (out.get(r.championId) ?? out.set(r.championId, []).get(r.championId)!).push({ win: r.win, axes: rad.values });
      }
      return out;
    });
  }

  /** Tes normales en draft et classées flexibles (règles standard de la Faille), reconstruites depuis leur détail. */
  private draftNormals(): AnalysisGame[] {
    return this.memo("draftNormals", () => {
      const keys = new Set(readOtherGames(this.dbFile).filter((g) => (g.queue === 400 || g.queue === 440) && !g.remake).map((g) => `${g.matchId}|${g.account}`));
      if (!keys.size) return [];
      const out: AnalysisGame[] = [];
      let db: DatabaseSync | null = null;
      try {
        db = new DatabaseSync(this.dbFile, { readOnly: true });
        const get = db.prepare("select data from my_detail where match_id = ? and account = ?");
        for (const k of keys) {
          const [m, a] = k.split("|");
          const row = get.get(m, a) as { data: Uint8Array } | undefined;
          const g = row ? myGameFromDetail(unpackDetail(row.data)) : null;
          if (g) out.push(g);
        }
      } catch { /* table absente */ } finally { db?.close(); }
      return out;
    });
  }

  /** `ratio` : rapport « 1 point de stats = r points de win rate » (1 par défaut ; test de sensibilité). */
  private progressionCore(excluded: number[], tier: RefTier, flags: Record<string, ChampionFlag>, ratio?: number) {
    return this.memo(`progressionCore:${excluded.join(",")}:${tier}:${JSON.stringify(flags)}:${ratio ?? ""}`, () => {
      const all = this.analysisGames(excluded);
      const season = Math.max(0, ...all.map((g) => g.season ?? 0));
      const ref = this.metaRef(["JUNGLE"], tier);
      const jungle = all.filter((g) => g.role === "JUNGLE");
      const recent = all.filter((g) => (g.season ?? 0) >= season - 1);
      const byChamp = new Map<number, AnalysisGame[]>();
      for (const g of jungle.filter((x) => (x.season ?? 0) >= season - 1)) (byChamp.get(g.championId) ?? byChamp.set(g.championId, []).get(g.championId)!).push(g);
      const mine = new Map([...byChamp].map(([c, gs]) => [c, { games: gs.length, wins: gs.filter((g) => g.win).length, radar: radarOf(gs, ref) }]));
      const played = new Map<number, number>();
      for (const g of recent) played.set(g.championId, (played.get(g.championId) ?? 0) + 1);
      // τ : écart réel de tes stats d'un champion à l'autre (champions à 10 parties ou plus).
      const spread = statsSpread([...mine.values()].filter((m) => m.games >= 10 && m.radar?.score != null && m.radar.margin != null).map((m) => ({ score: m.radar!.score!, margin: m.radar!.margin! })));
      const tau = spread ?? DEFAULT_TAU;
      const p = progression({
        metaRates: readJungleMeta(this.dbFile, this.patches(3)), mastery: this.cached("jungleMastery", META_TTL, () => readJungleMastery(this.dbFile)),
        difficulty: (c) => DIFFICULTY.get(c) ?? 5, axisGames: this.axisGames(tier),
        myRadar: radarOf(jungle.filter((g) => g.season === season), ref), mine, played, points: readMyMastery(this.dbFile),
        excluded: new Set(excluded), flags: this.flagMap(flags), tau, ratio,
      });
      return { ...p, mine, tau, season };
    });
  }

  /** Mode « Progresser » : classement, confort, ta vitesse d'apprentissage, calibrage, suivi « prêt pour la classée ». */
  progression(excluded: number[], tier: RefTier = DEFAULT_REF_TIER, goal: PoolGoal = "progress", flags: Record<string, ChampionFlag> = {}): ProgressionView {
    return this.memo(`progression:${excluded.join(",")}:${tier}:${goal}:${JSON.stringify(flags)}`, () => {
      const core = this.progressionCore(excluded, tier, flags);
      const all = this.analysisGames(excluded);
      const others = readOtherGames(this.dbFile).filter((g) => !g.remake);
      const normals = this.draftNormals();
      const ref = this.metaRef(["JUNGLE"], tier);
      const fm = this.flagMap(flags);

      // Ta vitesse d'apprentissage : comptes fusionnés, ordre chronologique, champions découverts pendant l'historique.
      const byKey = new Map(ALL_METRICS.map((m) => [m.key, m]));
      const vsOpp = (g: AnalysisGame) => {
        const xs = AXES.flatMap((a) => a.metrics).flatMap((k) => { const m = byKey.get(k)!, v = m.value(g), o = g.opp ? m.value(g.opp) : null; return v == null || o == null ? [] : [v === o ? 50 : (m.better === "+" ? v > o : v < o) ? 100 : 0]; });
        return xs.length >= 5 ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
      };
      const points = readMyMastery(this.dbFile);
      const histStart = new Map<string, number>();
      for (const g of all) histStart.set(g.account, Math.min(histStart.get(g.account) ?? Infinity, g.startMs));
      const DAY = 86_400_000;
      const groups: { score: number | null }[][] = [];
      const byC = new Map<number, AnalysisGame[]>();
      for (const g of all) (byC.get(g.championId) ?? byC.set(g.championId, []).get(g.championId)!).push(g);
      for (const gs0 of byC.values()) {
        const gs = [...gs0].sort((a, b) => a.startMs - b.startMs);
        if (gs.length < 20) continue;
        const early = gs[0].startMs - histStart.get(gs[0].account)! < 30 * DAY;
        if (early || (points.get(gs[0].championId) ?? 0) > gs.length * 1_500 * 2) continue;
        groups.push(gs.map((g) => ({ score: vsOpp(g) })));
      }

      // Points de maîtrise par partie, tous modes : champions découverts pendant l'historique (comptes cumulés).
      let calibration: ProgressionView["calibration"] = null;
      if (others.length) {
        const games = new Map<number, number[]>();
        for (const g of all) (games.get(g.championId) ?? games.set(g.championId, []).get(g.championId)!).push(g.startMs);
        for (const g of others) (games.get(g.championId) ?? games.set(g.championId, []).get(g.championId)!).push(g.startMs);
        const start = Math.min(...[...games.values()].flat());
        const ratios = [...games].filter(([c, ts]) => ts.length >= 5 && Math.min(...ts) - start > 60 * DAY && (points.get(c) ?? 0) > 0).map(([c, ts]) => points.get(c)! / ts.length).sort((a, b) => a - b);
        if (ratios.length >= 3) calibration = { champions: ratios.length, median: ratios[Math.floor(ratios.length / 2)], low: ratios[Math.floor(ratios.length / 4)], high: ratios[Math.floor((ratios.length * 3) / 4)] };
      }

      // Suivi : les champions de progression du pool conseillé, et ceux que tu as choisis.
      const tracked = new Map<number, TrackEntry["source"]>();
      for (const e of core.candidates.slice(0, 2)) tracked.set(e.championId, "advice");
      for (const [c, f] of fm) if (f === "progress") tracked.set(c, "flag");
      const track = ([c, source]: [number, TrackEntry["source"]]): TrackEntry => {
        const ranked = all.filter((g) => g.championId === c);
        const rift = others.filter((g) => g.championId === c && RIFT_QUEUES.has(g.queue));
        const draft = normals.filter((g) => g.championId === c && g.role === "JUNGLE");
        const rankedJ = ranked.filter((g) => g.role === "JUNGLE");
        const standard = radarOf([...rankedJ, ...draft], ref);
        const rankedRadar = radarOf(rankedJ, ref);
        const r = readiness({ experience: ranked.length + rift.length, standard, ranked: rankedRadar, rankedGames: rankedJ.length });
        return { championId: c, source, experience: ranked.length + rift.length, draftNormal: draft.length, rankedGames: rankedJ.length, standard, ranked: rankedRadar, ...r };
      };
      const tracking = [...tracked].map(track);
      // Repère de chaque champion de progression (tous, hors confort) : pour l'analyse d'après-partie.
      const readinessAll = core.candidates.map((e) => track([e.championId, tracked.get(e.championId) ?? "advice"]));
      void STANDARD_QUEUES;

      return {
        goal, weights: { ...WEIGHTS }, reference: this.refInfo(["JUNGLE"], tier), patches: this.patches(3),
        masteryGames: this.cached("jungleMastery", META_TTL, () => readJungleMastery(this.dbFile)).length,
        candidates: core.candidates.slice(0, 15).map((e) => ({ ...e, myGames: core.mine.get(e.championId)?.games ?? 0, myWins: core.mine.get(e.championId)?.wins ?? 0 })),
        comfort: core.comfort, notForMe: core.notForMe, learningSpeed: firstGamesEffect(groups), tau: core.tau, calibration, tracking,
        myAxes: radarOf(all.filter((g) => g.role === "JUNGLE" && g.season === core.season), ref)?.values ?? [],
        readinessAll,
      };
    });
  }

/**
   * Analyses d'après-partie de tes dernières parties (classées et normales en draft), les plus récentes d'abord.
   * Pour chaque partie, les points à travailler et ta moyenne ne viennent que des parties d'avant.
   */
  postGames(excluded: number[], tier: RefTier = DEFAULT_REF_TIER, userTargets: Record<string, number> = {}, limit = 10, flags: Record<string, ChampionFlag> = {}): PostGame[] {
    // Cibles : les tiennes, sinon celles par défaut des objectifs.
    const target = (k: string) => userTargets[k] ?? DEFAULT_GOALS.flatMap((g) => g.metrics).find((m) => m.key === k)?.target ?? 0;
    const targets = { uncompensatedEarly: target("uncompensatedEarly"), deathsBeforeObj: target("deathsBeforeObj"), cs10: target("cs10") };
    return this.memo(`postGames:${excluded.join(",")}:${tier}:${JSON.stringify(targets)}:${limit}:${JSON.stringify(flags)}`, () => {
      const ranked = this.analysisGames(excluded);
      const normals = this.draftNormals().filter((g) => !excluded.includes(g.championId));
      const rankedKeys = new Set(ranked.map((g) => `${g.matchId}|${g.account}`));
      const all = [...ranked, ...normals].sort((a, b) => b.startMs - a.startMs);
      const tracking = new Map(this.progression(excluded, tier, "progress", flags).readinessAll.map((t) => [t.championId, t]));
      let db: DatabaseSync | null = null;
      const out: PostGame[] = [];
      try {
        db = new DatabaseSync(this.dbFile, { readOnly: true });
        const get = db.prepare("select data from my_detail where match_id = ? and account = ?");
        for (const g of all) {
          if (out.length >= limit) break;
          const row = get.get(g.matchId, g.account) as { data: Uint8Array } | undefined;
          if (!row) continue;
          const d = unpackDetail(row.data);
          const before = all.filter((h) => h.startMs < g.startMs);
          const ref = this.metaRef([g.role], tier);
          const t = tracking.get(g.championId);
          out.push(postGame({
            game: g, detail: d, queue: rankedKeys.has(`${g.matchId}|${g.account}`) ? "ranked" : d.match.queue === 440 ? "flex" : "draftNormal",
            metrics: gameMetrics(d, new Set([420, 440, 400])), targets,
            sameChampion: before.filter((h) => h.championId === g.championId && h.role === g.role && h.season === g.season),
            recent: before.filter((h) => h.role === g.role), ref, refName: REF_TIERS[tier].short, progression: t ? `${STAGE_LABEL[t.stage]} : ${t.text}` : null,
          }));
        }
      } finally { db?.close(); }
      return out;
    });
  }

  /** Classement par potentiel : radar de chaque champion (saison en cours et précédente, dans le rôle) et groupes. */
  private potential(reco: ReturnType<typeof recommend>, excluded: number[], tier: RefTier): Record<string, PotentialGroups> {
    const all = this.analysisGames(excluded);
    const season = Math.max(0, ...all.map((g) => g.season ?? 0));
    const recent = all.filter((g) => (g.season ?? 0) >= season - 1);
    const out: Record<string, PotentialGroups> = {};
    for (const role of reco.roles) {
      const inRole = recent.filter((g) => g.role === role.role);
      const ref = this.metaRef([role.role], tier);
      const byChamp = new Map<number, typeof inRole>();
      for (const g of inRole) (byChamp.get(g.championId) ?? byChamp.set(g.championId, []).get(g.championId)!).push(g);
      const radars = new Map([...byChamp].map(([id, gs]) => [id, radarOf(gs, ref)]));
      const inPool = new Set(role.pool.map((p) => p.championId));
      const tried = [...byChamp].filter(([id, gs]) => !inPool.has(id) && gs.length >= 5).map(([id, gs]) => ({ championId: id, games: gs.length, wins: gs.filter((g) => g.win).length }));
      out[role.role] = potentialGroups(role.pool, tried, radars, REF_TIERS[tier].short);
    }
    return out;
  }

  // ---------- Draft ----------

  /** Rôles, choix du champion, plan de partie et page de runes pour une draft. */
  draftExtras(snap: DraftSnapshot, view: DraftView, excluded: number[], ctx: DraftContext = DEFAULT_DRAFT_CONTEXT): Pick<DraftView, "lanes" | "picks" | "plan" | "runePage" | "strategy"> {
    const lanes = this.safe("Rôles de la draft", () => this.lanes(snap, view));
    const plan = this.safe("Plan d'avant-partie", () => this.plan(snap, lanes));
    return {
      lanes,
      picks: this.safe("Choix de draft", () => this.picks(snap, lanes, excluded, ctx)),
      plan,
      strategy: this.safe("Plan de partie", () => this.strategyFor(snap, lanes, plan, excluded, ctx)),
      runePage: this.safe("Page de runes", () => this.runePage(snap, view)),
    };
  }

  /** Tes rappels personnels : tes objectifs de la semaine (valeur depuis le début du suivi si ≥ 5 parties, sinon d'avant). */
  private reminders(excluded: number[], ctx: DraftContext): Reminder[] {
    if (ctx.goalsStartMs == null) return [];
    const g = this.goals(ctx.goalsStartMs, ctx.targets, excluded);
    return remindersFrom(g.goals.filter((x) => x.horizon === "week").flatMap((x) => x.metrics.filter((m) => !m.info)).map((m) => {
      const s = m.since.n >= 5 ? m.since : m.before;
      return { key: m.key, label: m.label, unit: m.unit, better: m.better, target: m.target, value: s.value, n: s.n };
    }));
  }

  private strategyMemo: { key: string; value: Strategy | null } | null = null;
  /** Plan de partie : dès que ton champion est choisi (survolé ou verrouillé), provisoire tant que la draft n'est pas complète. */
  private strategyFor(snap: DraftSnapshot, lanes: LaneRow<ChampLite>[] | null, plan: GamePlan | null, excluded: number[], ctx: DraftContext): Strategy | null {
    const me = snap.me.championId || snap.me.intentId;
    if (!lanes || !me) return null;
    const myRow = lanes.find((r) => r.me);
    const myLane = (ALL_ROLES[snap.me.position] as Lane | undefined) ?? myRow?.lane;
    if (!myLane) return null;
    const keyOf = (c: ChampLite | null | undefined) => (c ? findChamp(c.id)?.key ?? 0 : 0);
    const allies: Partial<Record<Lane, number>> = {}, enemies: Partial<Record<Lane, number>> = {};
    for (const r of lanes) {
      if (r.me) allies[r.lane] = me;
      else if (keyOf(r.ally)) allies[r.lane] = keyOf(r.ally);
      if (keyOf(r.enemy)) enemies[r.lane] = keyOf(r.enemy);
    }
    const complete = snap.allies.filter((a) => a.championId).length >= 4 && snap.enemies.filter((e) => e.championId).length >= 5 && !!snap.me.championId;
    const key = JSON.stringify([me, myLane, allies, enemies, snap.side, complete, !!plan, excluded, ctx.goalsStartMs, ctx.targets]);
    if (this.strategyMemo?.key === key) return this.strategyMemo.value;
    const value = strategy({
      me: { championId: me, lane: myLane }, allies, enemies, side: snap.side,
      metaParts: this.recentMeta().parts, index: this.pairs(), plan, reminders: this.reminders(excluded, ctx), complete,
    });
    this.strategyMemo = { key, value };
    return value;
  }

  private safe<T>(label: string, fn: () => T): T | null {
    try { return fn(); } catch (e) { console.error(`${label} :`, e); return null; }
  }

  private lanes(snap: DraftSnapshot, view: DraftView): LaneRow<ChampLite>[] {
    const allies = [
      { champ: view.me.champion, position: snap.me.position, me: true },
      ...snap.allies.slice(0, 4).map((a, i) => ({ champ: view.allies[i], position: a.position })),
    ];
    const enemies = snap.enemies.slice(0, 5).flatMap((e, i) => (e.championId && view.enemies[i] ? [{ id: e.championId, champ: view.enemies[i]! }] : []));
    return laneRows(allies, enemies, this.shares());
  }

  private picksMemo: { key: string; at: number; value: DraftPicks | null } | null = null;
  private picks(snap: DraftSnapshot, lanes: LaneRow<ChampLite>[] | null, excluded: number[], ctx: DraftContext = DEFAULT_DRAFT_CONTEXT): DraftPicks | null {
    const role = DRAFT_ROLES[snap.me.position];
    if (!role) return null;
    // Le client envoie la session très souvent : on ne recalcule que si la draft a changé (ou après 1 min).
    const key = JSON.stringify([role, snap.myTurn, snap.allies.map((a) => a.championId), snap.enemies.map((e) => e.championId), snap.unavailable, excluded, snap.queueId, ctx.goal, ctx.flags, ctx.tier]);
    if (this.picksMemo && this.picksMemo.key === key && Date.now() - this.picksMemo.at < 60_000) return this.picksMemo.value;
    const enemyLanes = new Map<number, Lane>();
    snap.enemies.forEach((e) => {
      const row = lanes?.find((r) => r.enemy && (findChamp(r.enemy.id)?.key ?? 0) === e.championId);
      if (row && e.championId) enemyLanes.set(e.championId, row.lane);
    });
    const reco = this.reco(excluded);
    const r = reco.roles.find((x) => x.role === role);
    const value = r ? draftPicks({
      role, myTurn: snap.myTurn,
      allies: snap.allies.map((a) => a.championId).filter(Boolean),
      enemies: snap.enemies.map((e) => e.championId).filter(Boolean),
      enemyLanes, unavailable: snap.unavailable, excluded,
      pool: r.pool, meta: this.metaView(RECO_PATCHES).champions, index: this.pairs(), provisional: reco.provisional,
      ...(ctx.goal === "progress" && role === "JUNGLE" ? progressPriority(snap.queueId, this.progression(excluded, ctx.tier, "progress", ctx.flags)) : {}),
    }) : null;
    this.picksMemo = { key, at: Date.now(), value };
    return value;
  }

  private planMemo: { key: string; value: GamePlan | null } | null = null;
  private plan(snap: DraftSnapshot, lanes: LaneRow<ChampLite>[] | null): GamePlan | null {
    const me = snap.me.championId || snap.me.intentId;
    if (!lanes || !me || snap.me.position !== "jungle") return null;
    const key = JSON.stringify([me, snap.side, snap.allies.map((a) => a.championId), snap.enemies.map((e) => e.championId)]);
    if (this.planMemo?.key === key) return this.planMemo.value;
    const data = this.ganks();
    const value = gamePlan({ meChampion: me, side: snap.side, lanes, kills: data.kills, parts: data.parts, index: this.pairs() });
    this.planMemo = { key, value };
    return value;
  }

  /** Page de runes : guide pour Kayn (forme connue), sinon la méta récente dans ton rôle (ou son rôle le plus joué). */
  private runePage(snap: DraftSnapshot, view: DraftView): (RecommendedPage & { championName: string }) | null {
    const id = snap.me.championId || snap.me.intentId;
    const ch = id ? champByKey(id) : undefined;
    if (!ch) return null;
    if (view.isKayn && view.form) {
      const g = guidePage(view.form.value);
      if (g) return { ...g, championName: ch.name };
    }
    const rows = this.recentMeta().parts.filter((p) => p.championId === id);
    let role = ALL_ROLES[snap.me.position];
    if (!role || rows.filter((r) => r.role === role).length < 20) {
      const counts = new Map<string, number>();
      for (const r of rows) if (r.role) counts.set(r.role, (counts.get(r.role) ?? 0) + 1);
      role = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? role;
    }
    const page = metaPage(rows.filter((r) => r.role === role), ch.nameEn ?? ch.name);
    return page ? { ...page, championName: ch.name } : null;
  }

  // ---------- En jeu ----------

  /** Build statistique de ton champion (autre que Kayn) ; `draftPosition` : ton poste de la draft de cette partie. */
  /** Build statistique d'après les champions de la partie seulement (jamais l'état de la partie). */
  statBuild(m: MatchChampions, draftPosition: string | null): StatBuild | null {
    const ch = m.me ? findChamp(m.me) : undefined;
    if (!ch?.key || ch.id === "Kayn") return null;
    const enemies = m.enemies.map((e) => (e ? findChamp(e) ?? null : null));
    const fromDraft = draftPosition ? ALL_ROLES[draftPosition] : undefined;
    const meta = this.recentMeta();
    const rows = meta.parts.filter((p) => p.championId === ch.key);
    let role = fromDraft;
    if (!role || rows.filter((r) => r.role === role).length < 20) {
      const counts = new Map<string, number>();
      for (const r of rows) if (r.role) counts.set(r.role, (counts.get(r.role) ?? 0) + 1);
      role = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    if (!role) return null;
    return statBuild({ parts: rows.filter((r) => r.role === role), builds: meta.builds.filter((b) => b.championId === ch.key && b.role === role), role, enemies, shop: SHOP });
  }
}
