// Configuration locale : lue dans .env (jamais commité, voir .gitignore) ou dans les variables d'environnement.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface RiotConfig {
  apiKey: string;
  gameName: string;
  tagLine: string;
  region: string;
  platform: string;
  siteUrl: string;
}

export const DEFAULT_SITE_URL = "https://sfnt656f64-tech.github.io/kayn-sim/";
export const LOCAL_SITE_URL = "http://localhost:5173/";

/** « Nom#TAG » → [nom, tag]. Le nom peut contenir des espaces ; le tag est après le dernier #. */
export function parseRiotId(id: string): [string, string] | null {
  const i = id.lastIndexOf("#");
  if (i <= 0 || i === id.length - 1) return null;
  return [id.slice(0, i).trim(), id.slice(i + 1).trim()];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, envFile = resolve(process.cwd(), ".env")): RiotConfig {
  if (env === process.env && existsSync(envFile)) process.loadEnvFile(envFile);
  const problems: string[] = [];
  const apiKey = (env.RIOT_API_KEY ?? "").trim();
  if (!apiKey) problems.push("RIOT_API_KEY manquant");
  const riotId = parseRiotId(env.RIOT_ID ?? "");
  if (!riotId) problems.push("RIOT_ID manquant ou invalide (format attendu : Nom#TAG)");
  if (problems.length)
    throw new Error(`Configuration incomplète : ${problems.join(", ")}.\nCopie .env.example vers .env et remplis-le (le fichier .env n'est jamais commité).`);
  return {
    apiKey,
    gameName: riotId![0],
    tagLine: riotId![1],
    region: env.RIOT_REGION?.trim() || "europe",
    platform: env.RIOT_PLATFORM?.trim() || "euw1",
    siteUrl: env.SITE_URL?.trim() || DEFAULT_SITE_URL,
  };
}
