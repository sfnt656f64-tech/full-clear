// Connexion à l'API locale du client LoL (LCU). Tout reste sur 127.0.0.1 : aucune donnée ne sort du PC.
// Identifiants : port + jeton, lus dans la ligne de commande de LeagueClientUx.exe ou dans le fichier « lockfile ».
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Agent, request } from "node:https";
import { join } from "node:path";

export interface LcuCredentials { port: number; token: string }

/** Dossier d'installation par défaut, utilisé si la ligne de commande n'est pas lisible. */
export const DEFAULT_INSTALL_DIRS = ["C:\\Riot Games\\League of Legends"];

/** Extrait un argument « --nom=valeur » (avec ou sans guillemets) d'une ligne de commande Windows. */
export function commandLineArg(cmd: string, name: string): string | null {
  // "--nom=valeur avec espaces" (argument entier entre guillemets) ou --nom=valeur
  const m = cmd.match(new RegExp(`(?:^|\\s)(?:"--${name}=([^"]*)"|--${name}=([^"\\s]+))`));
  return m ? (m[1] ?? m[2]) : null;
}

export function parseCommandLine(cmd: string): (LcuCredentials & { installDir: string | null }) | null {
  const port = Number(commandLineArg(cmd, "app-port"));
  const token = commandLineArg(cmd, "remoting-auth-token");
  if (!Number.isInteger(port) || port <= 0 || port > 65535 || !token) return null;
  return { port, token, installDir: commandLineArg(cmd, "install-directory") };
}

/** lockfile : « LeagueClient:pid:port:motdepasse:https ». */
export function parseLockfile(text: string): LcuCredentials | null {
  const parts = text.trim().split(":");
  if (parts.length < 5) return null;
  const port = Number(parts[2]);
  const token = parts[3];
  if (!Number.isInteger(port) || port <= 0 || port > 65535 || !token) return null;
  return { port, token };
}

/** Lignes de commande des processus LeagueClientUx.exe (vide si le client est fermé). */
export function clientCommandLines(): Promise<string[]> {
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | ForEach-Object { $_.CommandLine }";
  return new Promise((ok) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      ok(err ? [] : stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    });
  });
}

export interface Discovery {
  creds: LcuCredentials;
  /** Dossier d'installation, mémorisé pour relire directement le lockfile la fois suivante. */
  installDir: string | null;
  source: "lockfile" | "process";
}

/**
 * Cherche le client : d'abord les lockfile connus (lecture de fichier, quasi gratuite),
 * puis, si `scanProcesses`, la ligne de commande du processus (lance PowerShell : à espacer).
 */
export async function discover(installDirs: string[], scanProcesses: boolean): Promise<Discovery | null> {
  for (const dir of installDirs) {
    const creds = await readFile(join(dir, "lockfile"), "utf8").then(parseLockfile, () => null);
    if (creds) return { creds, installDir: dir, source: "lockfile" };
  }
  if (!scanProcesses) return null;
  for (const line of await clientCommandLines()) {
    const c = parseCommandLine(line);
    if (c) return { creds: { port: c.port, token: c.token }, installDir: c.installDir, source: "process" };
  }
  return null;
}

// Le client et le jeu utilisent un certificat auto-signé par Riot. On l'accepte uniquement pour 127.0.0.1,
// avec un agent dédié : le reste de l'appli garde la vérification TLS normale.
const localAgent = new Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 4 });

export class LcuError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) { super(message); this.status = status; }
}

/** GET sur l'API locale du client (LCU). Renvoie le JSON, ou null pour un 404 (ex. pas de draft en cours). */
export function lcuGet<T>(creds: LcuCredentials, path: string, timeoutMs = 4000): Promise<T | null> {
  return localGet<T>(creds.port, path, { Authorization: `Basic ${Buffer.from(`riot:${creds.token}`).toString("base64")}` }, timeoutMs);
}

/** GET JSON sur 127.0.0.1 (LCU ou API en jeu du port 2999). null pour un 404. */
export function localGet<T>(port: number, path: string, headers: Record<string, string> = {}, timeoutMs = 4000): Promise<T | null> {
  return new Promise((ok, fail) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path,
      method: "GET",
      agent: localAgent,
      headers: { ...headers, Accept: "application/json" },
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        if (status === 404) return ok(null);
        if (status < 200 || status >= 300) return fail(new LcuError(`${path} : HTTP ${status}`, status));
        const body = Buffer.concat(chunks).toString("utf8");
        try { ok(body ? (JSON.parse(body) as T) : null); } catch { fail(new LcuError(`${path} : réponse illisible`, status)); }
      });
    });
    req.on("timeout", () => req.destroy(new LcuError(`${path} : délai dépassé`, null)));
    req.on("error", (e) => fail(e instanceof LcuError ? e : new LcuError(`${path} : ${e.message}`, null)));
    req.end();
  });
}

/** Phases de /lol-gameflow/v1/gameflow-phase, traduites pour l'affichage. */
export const PHASE_LABELS: Record<string, string> = {
  None: "Dans le client",
  Lobby: "Dans un salon",
  Matchmaking: "Recherche de partie",
  CheckedIntoTournament: "Inscrit à un tournoi",
  ReadyCheck: "Partie trouvée",
  ChampSelect: "Sélection des champions",
  GameStart: "Lancement de la partie",
  FailedToLaunch: "Échec du lancement",
  InProgress: "En jeu",
  Reconnect: "Reconnexion possible",
  WaitingForStats: "Fin de partie (statistiques)",
  PreEndOfGame: "Fin de partie",
  EndOfGame: "Fin de partie",
  TerminatedInError: "Partie interrompue",
};

export const phaseLabel = (phase: string): string => PHASE_LABELS[phase] ?? phase;

/** Ton compte, tel que renvoyé par /lol-summoner/v1/current-summoner (seuls ces champs sont gardés). */
export interface LocalAccount { gameName: string; tagLine: string }

export function toLocalAccount(raw: unknown): LocalAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const gameName = typeof r.gameName === "string" ? r.gameName : "";
  const tagLine = typeof r.tagLine === "string" ? r.tagLine : "";
  return gameName ? { gameName, tagLine } : null;
}

/** Comparaison des Riot ID insensible à la casse (comme côté Riot). null si l'un des deux manque. */
export function sameRiotId(a: LocalAccount | null, b: { gameName: string; tagLine: string } | null): boolean | null {
  if (!a || !b) return null;
  return a.gameName.toLocaleLowerCase() === b.gameName.toLocaleLowerCase() && a.tagLine.toLocaleLowerCase() === b.tagLine.toLocaleLowerCase();
}
