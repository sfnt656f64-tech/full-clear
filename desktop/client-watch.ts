// Surveille le client LoL : détection, compte connecté, phase (salon, draft, en jeu…).
// Client fermé : lockfile relu toutes les 3 s, processus inspecté toutes les 12 s au plus.
// Client ouvert : phase relue toutes les 2 s.
import { DEFAULT_INSTALL_DIRS, discover, lcuGet, phaseLabel, sameRiotId, toLocalAccount, type LcuCredentials, type LocalAccount } from "./lcu.ts";
import { queueOf, toDraftSnapshot, type DraftSnapshot } from "./champ-select.ts";
import type { ClientStatus } from "./ipc.ts";

const CLOSED_INTERVAL = 3000;
const SCAN_EVERY = 4; // 4 × 3 s
const CONNECTED_INTERVAL = 2000;
const CHAMP_SELECT_INTERVAL = 1000;

export class ClientWatcher {
  private creds: LcuCredentials | null = null;
  private account: LocalAccount | null = null;
  private installDirs = [...DEFAULT_INSTALL_DIRS];
  private tick = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private last = "";
  status: ClientStatus = { kind: "closed" };

  /** Tes comptes (.env) : le compte connecté doit être l'un d'eux. */
  private readonly expected: () => { gameName: string; tagLine: string }[];
  private readonly onChange: (s: ClientStatus, creds: LcuCredentials | null) => void;
  private readonly onDraft: (d: DraftSnapshot) => void;
  private lastDraft = "";
  private queueId = 0;

  constructor(
    expected: () => { gameName: string; tagLine: string }[],
    onChange: (s: ClientStatus, creds: LcuCredentials | null) => void,
    /** Appelé à chaque changement de la draft (pendant la sélection des champions seulement). */
    onDraft: (d: DraftSnapshot) => void = () => {},
  ) {
    this.expected = expected;
    this.onChange = onChange;
    this.onDraft = onDraft;
  }

  start(): void { this.stopped = false; void this.loop(); }

  /** Le compte connecté est-il l'un de tes comptes ? null si l'un des deux côtés manque. */
  private matchesEnv(): boolean | null {
    const ids = this.expected();
    if (!this.account || !ids.length) return null;
    return ids.some((id) => sameRiotId(this.account, id) === true);
  }

  /** Dossier d'installation du jeu le plus probable (pour lire Configgame.cfg). */
  get installDir(): string | null { return this.installDirs[0] ?? null; }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Re-publie l'état (ex. après relecture du .env : la comparaison du Riot ID change). */
  refresh(): void { if (this.status.kind === "connected") this.publish({ ...this.status, matchesEnv: this.matchesEnv() }); }

  private publish(s: ClientStatus): void {
    this.status = s;
    const key = JSON.stringify(s);
    if (key === this.last) return;
    this.last = key;
    this.onChange(s, this.creds);
  }

  private async loop(): Promise<void> {
    if (this.stopped) return;
    let delay = CLOSED_INTERVAL;
    try {
      if (!this.creds) {
        const found = await discover(this.installDirs, this.tick++ % SCAN_EVERY === 0);
        if (found) {
          this.creds = found.creds;
          this.account = null;
          if (found.installDir && !this.installDirs.includes(found.installDir)) this.installDirs.unshift(found.installDir);
        } else {
          this.publish({ kind: "closed" });
        }
      }
      if (this.creds) {
        delay = CONNECTED_INTERVAL;
        if (!this.account) this.account = toLocalAccount(await lcuGet(this.creds, "/lol-summoner/v1/current-summoner"));
        const phase = (await lcuGet<string>(this.creds, "/lol-gameflow/v1/gameflow-phase")) ?? "None";
        this.publish({
          kind: "connected",
          account: this.account ? `${this.account.gameName}#${this.account.tagLine}` : null,
          matchesEnv: this.matchesEnv(),
          phase,
          phaseLabel: phaseLabel(phase),
        });
        if (phase === "ChampSelect") {
          delay = CHAMP_SELECT_INTERVAL;
          // File de la partie : lue une fois par draft.
          if (!this.queueId) this.queueId = queueOf(await lcuGet(this.creds, "/lol-gameflow/v1/session"));
          const snap = toDraftSnapshot(await lcuGet(this.creds, "/lol-champ-select/v1/session"), this.queueId);
          // Le chrono change à chaque lecture : on ne compare que la composition pour éviter de tout recalculer.
          const key = snap && JSON.stringify({ ...snap, timeLeftMs: 0 });
          if (snap && key !== this.lastDraft) { this.lastDraft = key!; this.onDraft(snap); }
        } else {
          this.lastDraft = "";
          this.queueId = 0;
        }
      }
    } catch {
      // Client fermé entre-temps (connexion refusée) ou en cours de démarrage : on recommence la détection.
      this.creds = null;
      this.account = null;
      this.tick = 0;
      this.publish({ kind: "closed" });
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.loop(), delay);
  }
}
