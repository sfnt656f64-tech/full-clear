// Configuration locale : lue dans .env (jamais commité, voir .gitignore) ou dans les variables d'environnement.
import { existsSync, readFileSync } from "node:fs";
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

/**
 * Lit un .env : lignes CLÉ=valeur, lignes vides et lignes commençant par # ignorées.
 * Contrairement au lecteur intégré à Node, un « # » DANS une valeur est gardé (RIOT_ID=Nom#TAG).
 * Tolère un BOM, les fins de ligne Windows (CRLF) et les guillemets autour de la valeur.
 */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val.endsWith(val[0])) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

/** Charge un .env sans écraser les variables déjà définies. */
export function readEnvFile(file: string, env: NodeJS.ProcessEnv): void {
  for (const [k, v] of Object.entries(parseEnvText(readFileSync(file, "utf8")))) if (env[k] === undefined) env[k] = v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, envFile = resolve(process.cwd(), ".env")): RiotConfig {
  if (existsSync(envFile)) readEnvFile(envFile, env);
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
