// Configuration de l'application de bureau : seul le Riot ID est lu dans le .env.
// La clé API n'est pas nécessaire (l'appli ne parle qu'au client local) : elle n'est ni lue ni transmise.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnvText, parseRiotId } from "../scripts/riot/config.ts";

export interface DesktopConfig {
  /** Fichier .env utilisé, ou null s'il n'y en a aucun. */
  envFile: string | null;
  /** Fichiers cherchés, dans l'ordre. */
  searched: string[];
  riotId: { gameName: string; tagLine: string } | null;
  problems: string[];
}

/**
 * Dossiers où chercher le .env, dans l'ordre : le dépôt (en développement), puis
 * %APPDATA%\kayn-sim (version installée, où le dossier de l'appli est en lecture seule).
 */
export function envCandidates(repoDir: string | null, userDataDir: string): string[] {
  return [...(repoDir ? [join(repoDir, ".env")] : []), join(userDataDir, ".env")];
}

export function loadDesktopConfig(candidates: string[], exists: (f: string) => boolean = existsSync, read =(f: string) => readFileSync(f, "utf8")): DesktopConfig {
  const envFile = candidates.find((f) => exists(f)) ?? null;
  if (!envFile) return { envFile, searched: candidates, riotId: null, problems: ["Aucun fichier .env trouvé."] };
  const env = parseEnvText(read(envFile));
  const id = parseRiotId(env.RIOT_ID ?? "");
  return {
    envFile,
    searched: candidates,
    riotId: id ? { gameName: id[0], tagLine: id[1] } : null,
    problems: id ? [] : ["RIOT_ID manquant ou invalide dans le .env (format attendu : Nom#TAG)."],
  };
}
