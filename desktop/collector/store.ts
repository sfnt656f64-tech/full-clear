// Base locale de la collecte (%APPDATA%\kayn-sim\riot.db), SQLite intégré à Node (aucun module natif).
//
// - jobs : file d'attente persistante. Chaque travail a une clé unique (pas de doublon) ; un travail
//   interrompu (appli fermée) repasse en attente au démarrage : la collecte reprend où elle s'était arrêtée.
// - my_games : tes parties (tes comptes uniquement), sous forme compacte.
// - kv : petit stockage clé → valeur (comptes résolus, dates de rafraîchissement…).
// Aucune donnée d'identité d'autres joueurs n'est stockée.
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { MetaGame } from "./meta-parse.ts";

export type JobStatus = "pending" | "running" | "done" | "failed";

export interface Job {
  id: number;
  kind: string;
  key: string;
  priority: number;
  payload: unknown;
  attempts: number;
}

export interface MyGame {
  matchId: string;
  /** Ton compte (« Nom#TAG »). */
  account: string;
  startMs: number;
  durationS: number;
  /** « 16.23 » pour la version 16.23.xxx. */
  patch: string;
  /** Saison (année) : 2026 pour la version 16.x, 2025 pour 15.x… */
  season: number;
  championId: number;
  /** teamPosition de match-v5 : TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY (vide pour un remake). */
  role: string;
  win: boolean;
  remake: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  vision: number;
  /** Or et CS à 15 min (chronologie), null si la partie a duré moins de 15 min ou sans chronologie. */
  gold15: number | null;
  cs15: number | null;
  /** Kills de ton équipe (toute la partie). */
  teamKills: number;
  /** Avant 15 min (chronologie) : tes kills, tes assists, les kills de ton équipe. null sans chronologie. */
  kills15: number | null;
  assists15: number | null;
  teamKills15: number | null;
  items: number[];
  /** Page de runes : style principal, secondaire, runes choisies, fragments. */
  perks: { primary: number; sub: number; selections: number[]; shards: number[] } | null;
}

/** Version du schéma (PRAGMA user_version). */
export const SCHEMA_VERSION = 4;

/**
 * v3 : données de méta, anonymes (aucun PUUID ni pseudo).
 * - meta_games / meta_parts : une partie, 10 lignes (champion, rôle, victoire, KDA, items finaux, runes)
 * - meta_builds : ordre d'achat des items terminés (chronologie), pour les champions de ton pool
 * - meta_mastery : maîtrise du joueur source sur son champion (difficulté de prise en main)
 * - jobs.rank : ordre aléatoire des joueurs à interroger (mélange des rangs dès le début)
 */
const SCHEMA_V3 = `
alter table jobs add column rank real not null default 0;
drop index if exists jobs_next;
create index jobs_next on jobs (status, priority, not_before, rank, id);
create table meta_games (
  match_id text primary key,
  patch text not null,
  start_ms integer not null,
  duration_s integer not null,
  tier text not null,
  remake integer not null
);
create index meta_games_patch on meta_games (patch);
create table meta_parts (
  match_id text not null,
  participant_id integer not null,
  team integer not null,
  champion_id integer not null,
  role text not null,
  win integer not null,
  kills integer not null,
  deaths integer not null,
  assists integer not null,
  items text not null,
  perks text,
  primary key (match_id, participant_id)
);
create index meta_parts_champ on meta_parts (champion_id, role);
create table meta_builds (
  match_id text not null,
  participant_id integer not null,
  champion_id integer not null,
  role text not null,
  win integer not null,
  items text not null,
  primary key (match_id, participant_id)
);
create table meta_mastery (
  match_id text primary key,
  champion_id integer not null,
  role text not null,
  win integer not null,
  points integer not null
);
pragma user_version = 3;`;

/** Schéma initial (v1), gardé tel quel : les versions suivantes s'appliquent par migration. */
export const SCHEMA_V1 = `
create table if not exists kv (key text primary key, value text not null);
create table if not exists jobs (
  id integer primary key,
  kind text not null,
  key text not null unique,
  priority integer not null,
  payload text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  not_before integer not null default 0,
  error text,
  updated_at integer not null
);
create index if not exists jobs_next on jobs (status, priority, not_before, id);
create table if not exists my_games (
  match_id text not null,
  account text not null,
  start_ms integer not null,
  duration_s integer not null,
  patch text not null,
  champion_id integer not null,
  role text not null,
  win integer not null,
  remake integer not null,
  kills integer not null,
  deaths integer not null,
  assists integer not null,
  cs integer not null,
  vision integer not null,
  gold15 integer,
  cs15 integer,
  items text not null,
  perks text,
  primary key (match_id, account)
);
`;

export class CollectorStore {
  readonly db: DatabaseSync;
  private readonly st: Record<string, StatementSync>;
  private readonly now: () => number;

  constructor(file: string, now: () => number = Date.now) {
    this.now = now;
    this.db = new DatabaseSync(file);
    // WAL : les écritures n'empêchent pas les lectures, et un arrêt brutal ne corrompt pas la base.
    this.db.exec("pragma journal_mode = wal; pragma synchronous = normal; pragma busy_timeout = 3000;");
    const v = (this.db.prepare("pragma user_version").get() as { user_version: number }).user_version;
    if (v < 1) this.db.exec(SCHEMA_V1 + "pragma user_version = 1;");
    // v2 : saison de chaque partie (anciennes saisons), complétée d'après le patch pour les parties déjà enregistrées.
    if (v < 2) this.tx(() => this.db.exec(`
      alter table my_games add column season integer not null default 0;
      update my_games set season = 2010 + cast(substr(patch, 1, instr(patch, '.') - 1) as integer);
      pragma user_version = 2;`));
    if (v < 3) this.tx(() => this.db.exec(SCHEMA_V3));
    // v4 : participation aux kills (toute la partie et avant 15 min) et, pour la méta, début de partie
    // (kills, assists, kills d'équipe avant 15 min, or à 15 min) quand la chronologie est lue. Les parties déjà enregistrées
    // sont relues une fois (team_kills null) par la collecte.
    if (v < 4) this.tx(() => this.db.exec(`
      alter table my_games add column team_kills integer;
      alter table my_games add column kills15 integer;
      alter table my_games add column assists15 integer;
      alter table my_games add column team_kills15 integer;
      alter table meta_parts add column kills15 integer;
      alter table meta_parts add column assists15 integer;
      alter table meta_parts add column team_kills15 integer;
      alter table meta_parts add column gold15 integer;
      pragma user_version = 4;`));
    // Travaux interrompus par une fermeture : à refaire.
    this.db.prepare("update jobs set status = 'pending' where status = 'running'").run();
    this.st = {
      enqueue: this.db.prepare("insert or ignore into jobs (kind, key, priority, payload, updated_at, rank) values (?, ?, ?, ?, ?, ?)"),
      requeue: this.db.prepare("update jobs set status = 'pending', attempts = 0, not_before = 0, error = null, updated_at = ? where key = ? and status in ('done', 'failed')"),
      next: this.db.prepare("select id, kind, key, priority, payload, attempts from jobs where status = 'pending' and not_before <= ? order by priority, rank, id limit 1"),
      claim: this.db.prepare("update jobs set status = 'running', updated_at = ? where id = ? and status = 'pending'"),
      done: this.db.prepare("update jobs set status = 'done', error = null, updated_at = ? where id = ?"),
      clearPayload: this.db.prepare("update jobs set payload = '{}' where id = ?"),
      hasMeta: this.db.prepare("select 1 from meta_games where match_id = ?"),
      putMetaGame: this.db.prepare("insert or ignore into meta_games (match_id, patch, start_ms, duration_s, tier, remake) values (?, ?, ?, ?, ?, ?)"),
      putMetaPart: this.db.prepare(`insert or ignore into meta_parts (match_id, participant_id, team, champion_id, role, win, kills, deaths, assists, items, perks)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      putBuild: this.db.prepare("insert or replace into meta_builds (match_id, participant_id, champion_id, role, win, items) values (?, ?, ?, ?, ?, ?)"),
      putEarly: this.db.prepare("update meta_parts set kills15 = ?, assists15 = ?, team_kills15 = ?, gold15 = ? where match_id = ? and participant_id = ?"),
      metaTeams: this.db.prepare("select participant_id, team from meta_parts where match_id = ?"),
      putMastery: this.db.prepare("insert or replace into meta_mastery (match_id, champion_id, role, win, points) values (?, ?, ?, ?, ?)"),
      metaCount: this.db.prepare("select count(*) n, max(patch) p from meta_games"),
      metaPatches: this.db.prepare("select patch, count(*) n from meta_games group by patch"),
      retry: this.db.prepare("update jobs set status = 'pending', attempts = attempts + 1, not_before = ?, error = ?, updated_at = ? where id = ?"),
      fail: this.db.prepare("update jobs set status = 'failed', attempts = attempts + 1, error = ?, updated_at = ? where id = ?"),
      release: this.db.prepare("update jobs set status = 'pending', updated_at = ? where id = ?"),
      jobStatus: this.db.prepare("select status, updated_at from jobs where key = ?"),
      counts: this.db.prepare("select kind, status, count(*) n from jobs group by kind, status"),
      kvGet: this.db.prepare("select value from kv where key = ?"),
      kvSet: this.db.prepare("insert into kv (key, value) values (?, ?) on conflict(key) do update set value = excluded.value"),
      putGame: this.db.prepare(`insert or replace into my_games
        (match_id, account, start_ms, duration_s, patch, season, champion_id, role, win, remake, kills, deaths, assists, cs, vision, gold15, cs15,
         team_kills, kills15, assists15, team_kills15, items, perks)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      toRefresh: this.db.prepare("select match_id, account from my_games where team_kills is null and remake = 0"),
      countGames: this.db.prepare("select account, count(*) n from my_games group by account"),
    };
  }

  close(): void { this.db.close(); }

  /** Transaction : tout ou rien, et beaucoup plus rapide pour plusieurs écritures. */
  tx<T>(fn: () => T): T {
    this.db.exec("begin");
    try {
      const r = fn();
      this.db.exec("commit");
      return r;
    } catch (e) {
      this.db.exec("rollback");
      throw e;
    }
  }

  /** Ajoute un travail s'il n'existe pas déjà (même clé). Renvoie vrai s'il est nouveau. */
  /** `rank` : ordre entre travaux de même priorité (0 par défaut ; aléatoire pour mélanger). */
  enqueue(kind: string, key: string, priority: number, payload: unknown, rank = 0): boolean {
    return Number(this.st.enqueue.run(kind, key, priority, JSON.stringify(payload), this.now(), rank).changes) > 0;
  }

  /** Remet en attente un travail terminé ou abandonné (rafraîchissement). */
  requeue(key: string): boolean {
    return Number(this.st.requeue.run(this.now(), key).changes) > 0;
  }

  jobStatus(key: string): { status: JobStatus; updatedAt: number } | null {
    const r = this.st.jobStatus.get(key) as { status: JobStatus; updated_at: number } | undefined;
    return r ? { status: r.status, updatedAt: r.updated_at } : null;
  }

  /** Prend le prochain travail prêt (le plus prioritaire, puis le plus ancien) et le marque « en cours ». */
  claimNext(): Job | null {
    for (;;) {
      const r = this.st.next.get(this.now()) as { id: number; kind: string; key: string; priority: number; payload: string; attempts: number } | undefined;
      if (!r) return null;
      if (Number(this.st.claim.run(this.now(), r.id).changes)) return { ...r, payload: JSON.parse(r.payload) };
    }
  }

  /** Travail terminé. `forget` : efface son contenu (données d'autres joueurs, devenues inutiles). */
  done(id: number, forget = false): void {
    this.st.done.run(this.now(), id);
    if (forget) this.st.clearPayload.run(id);
  }

  /** Échec : nouvel essai plus tard, ou abandon après `maxAttempts` (contenu effacé si `forget`). */
  failed(job: Job, error: string, maxAttempts = 5, backoffMs = 60_000, forget = false): void {
    if (job.attempts + 1 >= maxAttempts) {
      this.st.fail.run(error, this.now(), job.id);
      if (forget) this.st.clearPayload.run(job.id);
    } else this.st.retry.run(this.now() + backoffMs * 2 ** job.attempts, error, this.now(), job.id);
  }

  /** Rend un travail sans le compter comme un échec (pause, arrêt). */
  release(id: number): void { this.st.release.run(this.now(), id); }

  /** Nombre de travaux par type et par état. */
  counts(): Record<string, Partial<Record<JobStatus, number>>> {
    const out: Record<string, Partial<Record<JobStatus, number>>> = {};
    for (const r of this.st.counts.all() as { kind: string; status: JobStatus; n: number }[]) (out[r.kind] ??= {})[r.status] = r.n;
    return out;
  }

  get(key: string): string | null {
    return (this.st.kvGet.get(key) as { value: string } | undefined)?.value ?? null;
  }

  set(key: string, value: string): void { this.st.kvSet.run(key, value); }

  putGame(g: MyGame): void {
    this.st.putGame.run(g.matchId, g.account, g.startMs, g.durationS, g.patch, g.season, g.championId, g.role, g.win ? 1 : 0, g.remake ? 1 : 0,
      g.kills, g.deaths, g.assists, g.cs, g.vision, g.gold15, g.cs15,
      g.teamKills, g.kills15, g.assists15, g.teamKills15, JSON.stringify(g.items), g.perks ? JSON.stringify(g.perks) : null);
  }

  /** Parties enregistrées avant la v4, à relire une fois (participation aux kills). */
  gamesToRefresh(): { matchId: string; account: string }[] {
    return (this.st.toRefresh.all() as { match_id: string; account: string }[]).map((r) => ({ matchId: r.match_id, account: r.account }));
  }

  // ---------- Méta ----------

  hasMetaGame(matchId: string): boolean { return !!this.st.hasMeta.get(matchId); }

  /** Une partie de méta et ses 10 lignes anonymes. `tier` : rang du joueur par lequel on l'a trouvée. */
  putMetaGame(g: MetaGame, tier: string): void {
    this.tx(() => {
      this.st.putMetaGame.run(g.matchId, g.patch, g.startMs, g.durationS, tier, g.remake ? 1 : 0);
      for (const p of g.parts) {
        this.st.putMetaPart.run(g.matchId, p.participantId, p.team, p.championId, p.role, p.win ? 1 : 0, p.kills, p.deaths, p.assists,
          JSON.stringify(p.items), p.perks ? JSON.stringify(p.perks) : null);
      }
    });
  }

  putBuild(matchId: string, participantId: number, championId: number, role: string, win: boolean, items: number[]): void {
    this.st.putBuild.run(matchId, participantId, championId, role, win ? 1 : 0, JSON.stringify(items));
  }

/** Début de partie (anonyme) des participants d'une partie de méta. */
  putEarly(matchId: string, rows: Map<number, { kills15: number; assists15: number; teamKills15: number; gold15: number | null }>): void {
    for (const [pid, e] of rows) this.st.putEarly.run(e.kills15, e.assists15, e.teamKills15, e.gold15, matchId, pid);
  }

  /** Équipe de chaque participant d'une partie de méta. */
  metaTeams(matchId: string): Map<number, number> {
    return new Map((this.st.metaTeams.all(matchId) as { participant_id: number; team: number }[]).map((r) => [r.participant_id, r.team]));
  }

  putMastery(matchId: string, championId: number, role: string, win: boolean, points: number): void {
    this.st.putMastery.run(matchId, championId, role, win ? 1 : 0, points);
  }

  /** Parties de méta par patch, du plus récent au plus ancien. */
  metaPatches(): { patch: string; games: number }[] {
    const cmp = (a: string, b: string) => { const [a1, a2] = a.split(".").map(Number); const [b1, b2] = b.split(".").map(Number); return b1 - a1 || b2 - a2; };
    return (this.st.metaPatches.all() as { patch: string; n: number }[]).map((r) => ({ patch: r.patch, games: r.n })).sort((a, b) => cmp(a.patch, b.patch));
  }

  /** Supprime la méta des patchs hors de `keep` (les plus récents). */
  purgeMeta(keep: string[]): number {
    if (!keep.length) return 0;
    const marks = keep.map(() => "?").join(",");
    return this.tx(() => {
      const old = `select match_id from meta_games where patch not in (${marks})`;
      for (const t of ["meta_parts", "meta_builds", "meta_mastery"]) this.db.prepare(`delete from ${t} where match_id in (${old})`).run(...keep);
      return Number(this.db.prepare(`delete from meta_games where patch not in (${marks})`).run(...keep).changes);
    });
  }

  /** Parties enregistrées par compte. */
  gameCounts(): Record<string, number> {
    return Object.fromEntries((this.st.countGames.all() as { account: string; n: number }[]).map((r) => [r.account, r.n]));
  }
}
