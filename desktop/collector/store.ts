// Base locale de la collecte (%APPDATA%\kayn-sim\riot.db), SQLite intégré à Node (aucun module natif).
//
// - jobs : file d'attente persistante. Chaque travail a une clé unique (pas de doublon) ; un travail
//   interrompu (appli fermée) repasse en attente au démarrage : la collecte reprend où elle s'était arrêtée.
// - my_games : tes parties (tes comptes uniquement), sous forme compacte.
// - kv : petit stockage clé → valeur (comptes résolus, dates de rafraîchissement…).
// Aucune donnée d'identité d'autres joueurs n'est stockée.
import { DatabaseSync, type StatementSync } from "node:sqlite";

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
  items: number[];
  /** Page de runes : style principal, secondaire, runes choisies, fragments. */
  perks: { primary: number; sub: number; selections: number[]; shards: number[] } | null;
}

/** Version du schéma (PRAGMA user_version). */
export const SCHEMA_VERSION = 2;

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
    // Travaux interrompus par une fermeture : à refaire.
    this.db.prepare("update jobs set status = 'pending' where status = 'running'").run();
    this.st = {
      enqueue: this.db.prepare("insert or ignore into jobs (kind, key, priority, payload, updated_at) values (?, ?, ?, ?, ?)"),
      requeue: this.db.prepare("update jobs set status = 'pending', attempts = 0, not_before = 0, error = null, updated_at = ? where key = ? and status in ('done', 'failed')"),
      next: this.db.prepare("select id, kind, key, priority, payload, attempts from jobs where status = 'pending' and not_before <= ? order by priority, id limit 1"),
      claim: this.db.prepare("update jobs set status = 'running', updated_at = ? where id = ? and status = 'pending'"),
      done: this.db.prepare("update jobs set status = 'done', error = null, updated_at = ? where id = ?"),
      retry: this.db.prepare("update jobs set status = 'pending', attempts = attempts + 1, not_before = ?, error = ?, updated_at = ? where id = ?"),
      fail: this.db.prepare("update jobs set status = 'failed', attempts = attempts + 1, error = ?, updated_at = ? where id = ?"),
      release: this.db.prepare("update jobs set status = 'pending', updated_at = ? where id = ?"),
      jobStatus: this.db.prepare("select status, updated_at from jobs where key = ?"),
      counts: this.db.prepare("select kind, status, count(*) n from jobs group by kind, status"),
      kvGet: this.db.prepare("select value from kv where key = ?"),
      kvSet: this.db.prepare("insert into kv (key, value) values (?, ?) on conflict(key) do update set value = excluded.value"),
      putGame: this.db.prepare(`insert or replace into my_games
        (match_id, account, start_ms, duration_s, patch, season, champion_id, role, win, remake, kills, deaths, assists, cs, vision, gold15, cs15, items, perks)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
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
  enqueue(kind: string, key: string, priority: number, payload: unknown): boolean {
    return Number(this.st.enqueue.run(kind, key, priority, JSON.stringify(payload), this.now()).changes) > 0;
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

  done(id: number): void { this.st.done.run(this.now(), id); }

  /** Échec : nouvel essai plus tard, ou abandon après `maxAttempts`. */
  failed(job: Job, error: string, maxAttempts = 5, backoffMs = 60_000): void {
    if (job.attempts + 1 >= maxAttempts) this.st.fail.run(error, this.now(), job.id);
    else this.st.retry.run(this.now() + backoffMs * 2 ** job.attempts, error, this.now(), job.id);
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
      g.kills, g.deaths, g.assists, g.cs, g.vision, g.gold15, g.cs15, JSON.stringify(g.items), g.perks ? JSON.stringify(g.perks) : null);
  }

  /** Parties enregistrées par compte. */
  gameCounts(): Record<string, number> {
    return Object.fromEntries((this.st.countGames.all() as { account: string; n: number }[]).map((r) => [r.account, r.n]));
  }
}
