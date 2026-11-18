// Configuration de l'application de bureau, lue dans le .env :
//   RIOT_ID, RIOT_ID_2 (2ᵉ compte, facultatif)  tes comptes
//   RIOT_API_KEY                                 utilisée uniquement par la collecte en arrière-plan,
//                                                envoyée seulement à l'API Riot ; jamais à la fenêtre
//   SITE_URL                                     site du simulateur
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SITE_URL, parseEnvText, parseRiotId } from "../scripts/riot/config.ts";

export interface RiotIdParts { gameName: string; tagLine: string }

export interface DesktopConfig {
  /** Fichier .env utilisé, ou null s'il n'y en a aucun. */
  envFile: string | null;
  /** Fichiers cherchés, dans l'ordre. */
  searched: string[];
  /** Compte principal (RIOT_ID). */
  riotId: RiotIdParts | null;
  /** Tous tes comptes : RIOT_ID puis RIOT_ID_2. */
  riotIds: RiotIdParts[];
  /** Clé personnelle Riot, ou null. Ne quitte jamais le processus principal, sauf vers le processus de collecte. */
  apiKey: string | null;
  /** Site du simulateur, pour « Ouvrir dans le simulateur » (SITE_URL, sinon la version publiée). */
  siteUrl: string;
  problems: string[];
}

export const riotIdText = (r: RiotIdParts): string => `${r.gameName}#${r.tagLine}`;

/**
 * Dossiers où chercher le .env, dans l'ordre : le dépôt (en développement), puis
 * %APPDATA%\kayn-sim (version installée, où le dossier de l'appli est en lecture seule).
 */
export function envCandidates(repoDir: string | null, userDataDir: string): string[] {
  return [...(repoDir ? [join(repoDir, ".env")] : []), join(userDataDir, ".env")];
}

export function loadDesktopConfig(candidates: string[], exists: (f: string) => boolean = existsSync, read = (f: string) => readFileSync(f, "utf8")): DesktopConfig {
  const envFile = candidates.find((f) => exists(f)) ?? null;
  if (!envFile) return { envFile, searched: candidates, riotId: null, riotIds: [], apiKey: null, siteUrl: DEFAULT_SITE_URL, problems: ["Aucun fichier .env trouvé."] };
  const env = parseEnvText(read(envFile));
  const problems: string[] = [];
  const id = parseRiotId(env.RIOT_ID ?? "");
  if (!id) problems.push("RIOT_ID manquant ou invalide dans le .env (format attendu : Nom#TAG).");
  const raw2 = (env.RIOT_ID_2 ?? "").trim();
  const id2 = raw2 ? parseRiotId(raw2) : null;
  if (raw2 && !id2) problems.push("RIOT_ID_2 invalide dans le .env (format attendu : Nom#TAG).");
  const toParts = (p: [string, string]): RiotIdParts => ({ gameName: p[0], tagLine: p[1] });
  const riotIds = [id, id2].filter((x): x is [string, string] => !!x).map(toParts);
  const key = (env.RIOT_API_KEY ?? "").trim();
  return {
    envFile,
    searched: candidates,
    riotId: id ? toParts(id) : null,
    riotIds,
    apiKey: key && !key.includes("xxxx") ? key : null,
    siteUrl: /^https?:\/\//.test(env.SITE_URL?.trim() ?? "") ? env.SITE_URL!.trim() : DEFAULT_SITE_URL,
    problems,
  };
}
