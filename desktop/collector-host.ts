// Côté processus principal : lance le processus de collecte, lui transmet la configuration,
// le met en pause pendant les parties et relaie son état à la fenêtre.
import { utilityProcess, type UtilityProcess } from "electron";
import { join } from "node:path";
import type { CollectorStatus } from "./collector/collector.ts";
import type { FromCollector, ToCollector } from "./collector/protocol.ts";

export type HostState =
  | { kind: "off"; reason: "no-key" | "no-account" }
  | { kind: "starting" }
  | { kind: "on"; status: CollectorStatus | null }
  | { kind: "crashed"; message: string };

/** Phases du client pendant lesquelles la collecte se met en pause (chargement → fin de partie). */
export const GAME_PHASES = new Set(["GameStart", "InProgress", "Reconnect", "WaitingForStats", "PreEndOfGame"]);

export class CollectorHost {
  private child: UtilityProcess | null = null;
  private readonly pauses = new Set<string>();
  private config: { apiKey: string | null; accounts: string[]; excluded: number[] } = { apiKey: null, accounts: [], excluded: [] };
  state: HostState = { kind: "off", reason: "no-key" };
  private readonly dir: string;
  private readonly dbFile: string;
  private readonly onChange: () => void;
  private restarts = 0;

  constructor(dir: string, dbFile: string, onChange: () => void) {
    this.dir = dir;
    this.dbFile = dbFile;
    this.onChange = onChange;
  }

  /** Nouvelle configuration (.env relu) : démarre, reconfigure ou arrête la collecte. */
  configure(apiKey: string | null, accounts: string[], excluded: number[] = []): void {
    this.config = { apiKey, accounts, excluded };
    if (!apiKey || !accounts.length) {
      this.stop();
      this.state = { kind: "off", reason: !apiKey ? "no-key" : "no-account" };
      this.onChange();
      return;
    }
    if (!this.child) this.spawn();
    else this.send({ type: "configure", apiKey, accounts, excluded });
  }

  setPaused(reason: string, on: boolean): void {
    if (on === this.pauses.has(reason)) return;
    if (on) this.pauses.add(reason); else this.pauses.delete(reason);
    this.send({ type: on ? "pause" : "resume", reason });
  }

  isPaused(reason: string): boolean { return this.pauses.has(reason); }

  stop(): void {
    if (!this.child) return;
    const c = this.child;
    this.child = null;
    try { c.postMessage({ type: "stop" } satisfies ToCollector); } catch { /* déjà arrêté */ }
    // Filet de sécurité si le processus ne s'arrête pas de lui-même.
    setTimeout(() => { try { c.kill(); } catch { /* déjà arrêté */ } }, 3000).unref();
  }

  private send(m: ToCollector): void {
    try { this.child?.postMessage(m); } catch { /* processus arrêté : la configuration sera renvoyée au redémarrage */ }
  }

  private spawn(): void {
    this.state = { kind: "starting" };
    const child = utilityProcess.fork(join(this.dir, "collector.cjs"), [this.dbFile], { serviceName: "Kayn Sim · collecte", stdio: "ignore" });
    this.child = child;
    child.on("message", (m: FromCollector) => {
      if (m.type === "status") { this.state = { kind: "on", status: m.status }; this.restarts = 0; }
      else if (m.type === "fatal") this.state = { kind: "crashed", message: m.message };
      this.onChange();
    });
    child.on("exit", (code) => {
      if (this.child !== child) return; // arrêt demandé
      this.child = null;
      if (this.state.kind !== "crashed") this.state = { kind: "crashed", message: `Processus de collecte arrêté (code ${code}).` };
      this.onChange();
      // Redémarrage automatique, espacé, sans boucle infinie.
      if (this.restarts++ < 3) setTimeout(() => { if (!this.child && this.config.apiKey) this.spawn(); }, 10_000 * this.restarts).unref();
    });
    for (const reason of this.pauses) this.send({ type: "pause", reason });
    this.send({ type: "configure", apiKey: this.config.apiKey!, accounts: this.config.accounts, excluded: this.config.excluded });
    this.onChange();
  }
}
