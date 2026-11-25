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
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { champByKey, findChamp } from "../../src/data/champions";
import { readMyGames, readMyMastery } from "../stats/read.ts";
import { readGankData, readMeta, readMetaMastery, readMetaPatches } from "../meta/read.ts";
import { metaStats } from "../meta/meta-stats.ts";
import { recommend } from "../reco/recommend.ts";
import { draftPicks, pairIndex, type DraftPicks, type PairIndex } from "../reco/draft-pick.ts";
import { laneRows, roleShares, type Lane, type LaneRow, type RoleShares } from "../reco/lanes.ts";
import { potentialGroups, type PotentialGroups } from "../reco/potential.ts";
import { compoStrengths, poolAdvice, type PoolAdvice } from "../reco/pool-advice.ts";
import { metaStyles } from "../reco/recommend.ts";
import type { MetaTrend } from "../ipc.ts";
import { guidePage, metaPage, type RecommendedPage } from "../runes/rune-page.ts";
import { gamePlan, type GamePlan } from "../coach/game-plan.ts";
import { statBuild, type StatBuild } from "../coach/stat-build.ts";
import { readEnemyItems, SHOP } from "../next-item.ts";
import { readAllMyEvents, readAnalysisGames, readMetaMetrics, readMyEvents } from "../analysis/read.ts";
import { analyseGame, type AnalysisGame, type MetaMetricRow, type Values } from "../analysis/analysis.ts";
import { championTable, evolution, filterGames, MetaRef, overview, type OverviewFilter } from "../analysis/overview.ts";
import { radarOf } from "../analysis/radar.ts";
import { DEFAULT_GOALS, gameMetrics, goalsView, type GameMetrics, type GoalsView } from "../analysis/goals.ts";
import { unpackDetail } from "../collector/detail.ts";
import { opponentValues } from "../analysis/opponent.ts";
import type { DraftSnapshot } from "../champ-select.ts";
import type { ChampLite, DraftView } from "../draft-view.ts";
import type { LiveSnapshot } from "../live-client.ts";
import type { AnalysisView, MetaView, OverviewView, RecoView } from "../ipc.ts";
import type { MyGameRow } from "../stats/my-stats.ts";

/** Patchs de méta pour les recommandations : les 2 derniers (équilibrage actuel, assez de parties). */
const RECO_PATCHES = 2;
/** La méta est relue au plus toutes les 10 minutes. */
const META_TTL = 10 * 60_000;
const DRAFT_ROLES: Record<string, string> = { jungle: "JUNGLE", middle: "MIDDLE" };
const ALL_ROLES: Record<string, string> = { top: "TOP", jungle: "JUNGLE", middle: "MIDDLE", bottom: "BOTTOM", utility: "UTILITY" };
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
  private metaRows(role: string): MetaMetricRow[] { return this.cached(`metaRows:${role}`, META_TTL, () => readMetaMetrics(this.dbFile, this.patches(3), role)); }
  private metaRef(roles: string[]): MetaRef {
    const byRole = new Map(roles.map((r) => [r, this.metaRows(r)]));
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

  private detail = new Map<string, { rowid: number; metrics: GameMetrics | null; opp: Values | null }>();
  private detailVersion = "";
  private details(): Map<string, { rowid: number; metrics: GameMetrics | null; opp: Values | null }> {
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
        this.detail.set(key, { rowid: r.rowid, metrics: gameMetrics(d), opp: opponentValues(d) });
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
      this.gamesMemo = { v, games: readAnalysisGames(this.dbFile, -1, []).map((g) => ({ ...g, opp: det.get(`${g.matchId}|${g.account}`)?.opp ?? null })) };
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

  overview(filter: OverviewFilter, compare: number | null, excluded: number[]): OverviewView {
    return this.memo(`overview:${JSON.stringify([filter, compare, excluded])}`, () => {
      const all = this.analysisGames(excluded);
      const games = filterGames(all, filter);
      const ref = this.metaRef([...new Set(games.map((g) => g.role))]);
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
        compare: cmp ? { championId: compare!, radar: radarOf(cmp, this.metaRef([...new Set(cmp.map((g) => g.role))])) } : null,
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

  analysis(key: string | null, filter: OverviewFilter, excluded: number[]): AnalysisView {
    return this.memo(`analysis:${JSON.stringify([key, filter, excluded])}`, () => {
      const all = this.analysisGames(excluded);
      const games = filterGames(all, filter).slice(0, 30);
      const list = games.map((g) => ({ key: `${g.matchId}|${g.account}`, championId: g.championId, win: g.win, kda: `${g.kills}/${g.deaths}/${g.assists}`, startMs: g.startMs, role: g.role }));
      const game = games.find((g) => `${g.matchId}|${g.account}` === key) ?? games[0];
      if (!game) return { games: list, selected: null, analysis: null };
      const ref = this.metaRef([game.role]);
      const analysis = analyseGame(game, readMyEvents(this.dbFile, game.matchId, game.account), games, ref);
      const same = all.filter((g) => g.championId === game.championId && g.role === game.role);
      return { games: list, selected: `${game.matchId}|${game.account}`, analysis, radar: { game: radarOf([game], ref, 1), average: radarOf(same, ref) } };
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

  reco(excluded: number[]): RecoView {
    return this.memo(`reco:${excluded.join(",")}`, () => {
      const patches = this.patches(RECO_PATCHES);
      const input = this.recentMeta();
      const reco = recommend({ myGames: readMyGames(this.dbFile), meta: metaStats(input), metaParts: input.parts, mastery: readMetaMastery(this.dbFile), metaMatches: input.matches, excluded, myMastery: readMyMastery(this.dbFile) });
      const potential = this.potential(reco, excluded);
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
      return { ...reco, patches, potential, advice, trends };
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

  /** Classement par potentiel : radar de chaque champion (saison en cours et précédente, dans le rôle) et groupes. */
  private potential(reco: ReturnType<typeof recommend>, excluded: number[]): Record<string, PotentialGroups> {
    const all = this.analysisGames(excluded);
    const season = Math.max(0, ...all.map((g) => g.season ?? 0));
    const recent = all.filter((g) => (g.season ?? 0) >= season - 1);
    const out: Record<string, PotentialGroups> = {};
    for (const role of reco.roles) {
      const inRole = recent.filter((g) => g.role === role.role);
      const ref = this.metaRef([role.role]);
      const byChamp = new Map<number, typeof inRole>();
      for (const g of inRole) (byChamp.get(g.championId) ?? byChamp.set(g.championId, []).get(g.championId)!).push(g);
      const radars = new Map([...byChamp].map(([id, gs]) => [id, radarOf(gs, ref)]));
      const inPool = new Set(role.pool.map((p) => p.championId));
      const tried = [...byChamp].filter(([id, gs]) => !inPool.has(id) && gs.length >= 5).map(([id, gs]) => ({ championId: id, games: gs.length, wins: gs.filter((g) => g.win).length }));
      out[role.role] = potentialGroups(role.pool, tried, radars);
    }
    return out;
  }

  // ---------- Draft ----------

  /** Rôles, choix du champion, plan d'avant-partie et page de runes pour une draft. */
  draftExtras(snap: DraftSnapshot, view: DraftView, excluded: number[]): Pick<DraftView, "lanes" | "picks" | "plan" | "runePage"> {
    const lanes = this.safe("Rôles de la draft", () => this.lanes(snap, view));
    return {
      lanes,
      picks: this.safe("Choix de draft", () => this.picks(snap, lanes, excluded)),
      plan: this.safe("Plan d'avant-partie", () => this.plan(snap, lanes)),
      runePage: this.safe("Page de runes", () => this.runePage(snap, view)),
    };
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
  private picks(snap: DraftSnapshot, lanes: LaneRow<ChampLite>[] | null, excluded: number[]): DraftPicks | null {
    const role = DRAFT_ROLES[snap.me.position];
    if (!role) return null;
    // Le client envoie la session très souvent : on ne recalcule que si la draft a changé (ou après 1 min).
    const key = JSON.stringify([role, snap.myTurn, snap.allies.map((a) => a.championId), snap.enemies.map((e) => e.championId), snap.unavailable, excluded]);
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
    }) : null;
    this.picksMemo = { key, at: Date.now(), value };
    return value;
  }

  private planMemo: { key: string; value: GamePlan | null } | null = null;
  private plan(snap: DraftSnapshot, lanes: LaneRow<ChampLite>[] | null): GamePlan | null {
    if (!lanes || !snap.me.championId || snap.me.position !== "jungle") return null;
    if (snap.enemies.filter((e) => e.championId).length < 5 || snap.allies.filter((a) => a.championId).length < 4) return null;
    const key = JSON.stringify([snap.me.championId, snap.side, snap.allies.map((a) => a.championId), snap.enemies.map((e) => e.championId)]);
    if (this.planMemo?.key === key) return this.planMemo.value;
    const data = this.ganks();
    const value = gamePlan({ meChampion: snap.me.championId, side: snap.side, lanes, kills: data.kills, parts: data.parts, index: this.pairs() });
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
  statBuild(snap: LiveSnapshot, draftPosition: string | null): StatBuild | null {
    const ch = snap.me.champion ? findChamp(snap.me.champion) : undefined;
    if (!ch?.key || ch.id === "Kayn") return null;
    const enemies = snap.enemies.map((e) => (e.champion ? findChamp(e.champion) ?? null : null));
    const enemyItems = readEnemyItems(snap.enemies, enemies, SHOP);
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
    return statBuild({ parts: rows.filter((r) => r.role === role), builds: meta.builds.filter((b) => b.championId === ch.key && b.role === role), role, enemies, enemyItems, shop: SHOP });
  }
}
