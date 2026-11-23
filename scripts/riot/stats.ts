// npm run stats : tes parties Solo/Duo de la saison sur Kayn, analysées en local (rien n'est publié).
//
//   npm run stats                       saison en cours (depuis le patch 26.01)
//   npm run stats -- --since=2026-06-01 depuis une date
//   npm run stats -- --refresh          ignore le cache et retélécharge tout
//   npm run stats -- --no-open          n'ouvre pas le rapport dans le navigateur
//
// Résultat : un résumé dans la console et un rapport HTML dans .cache/riot/rapport.html.
// Les parties déjà analysées sont gardées dans .cache/riot/cache.json (ignoré par git) :
// seules les nouvelles sont téléchargées. Le script peut être interrompu (Ctrl+C) sans perte.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { aggregate, type ItemIndex } from "./aggregate.ts";
import { QUEUE_SOLO_DUO, RiotClient } from "./client.ts";
import { loadConfig } from "./config.ts";
import { RECORD_VERSION, summarizeMatch, type GameRecord, type MatchDto, type SkippedRecord, type TimelineDto } from "./matches.ts";
import { openBrowser } from "./open.ts";
import { consoleSummary, renderHtml } from "./report.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_CACHE_DIR = resolve(ROOT, ".cache/riot");

import { SEASON_START } from "./season.ts";
export { SEASON_START };
/** Parties examinées au plus (garde-fou). */
const MAX_MATCHES = 1000;

type CachedRecord = GameRecord | SkippedRecord;
interface Cache { puuid: string; records: Record<string, CachedRecord> }

function loadCache(dir: string, puuid: string): Cache {
  try {
    const c = JSON.parse(readFileSync(resolve(dir, "cache.json"), "utf8")) as Cache;
    if (c.puuid === puuid) return c;
    console.log("Cache d'un autre compte : il est remplacé.");
  } catch { /* pas encore de cache */ }
  return { puuid, records: {} };
}

function saveCache(dir: string, c: Cache): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "cache.json"), JSON.stringify(c));
}

export function parseSince(arg: string | undefined): number {
  if (!arg) return SEASON_START;
  const t = Date.parse(`${arg}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arg) || Number.isNaN(t)) throw new Error(`Date invalide pour --since : ${arg} (format AAAA-MM-JJ).`);
  return t;
}

const minutes = (requests: number) => Math.max(1, Math.ceil((requests / 100) * 2));

export interface RunOptions {
  client: RiotClient;
  gameName: string;
  tagLine: string;
  since: number;
  cacheDir?: string;
  refresh?: boolean;
  log?: (s: string) => void;
  progress?: (s: string) => void;
}

/** Télécharge (avec cache), agrège et écrit le rapport. Renvoie le chemin du rapport HTML, ou null sans partie. */
export async function runStats(o: RunOptions): Promise<string | null> {
  const log = o.log ?? console.log;
  const progress = o.progress ?? ((s: string) => process.stdout.write(s));
  const dir = o.cacheDir ?? DEFAULT_CACHE_DIR;
  const { client, since } = o;
  const index = JSON.parse(readFileSync(resolve(ROOT, "src/data/generated/item-index.json"), "utf8")) as ItemIndex;
  const ddVersion = (JSON.parse(readFileSync(resolve(ROOT, "src/data/generated/version.json"), "utf8")) as { version: string }).version;

  const account = await client.account(o.gameName, o.tagLine);
  if (!account) throw new Error(`Compte ${o.gameName}#${o.tagLine} introuvable. Vérifie RIOT_ID dans .env.`);
  log(`Compte : ${account.gameName}#${account.tagLine}`);

  // 1. Identifiants des parties Solo/Duo depuis la date choisie (100 par page).
  const ids: string[] = [];
  for (let start = 0; ids.length < MAX_MATCHES; start += 100) {
    const page = await client.matchIds(account.puuid, { queue: QUEUE_SOLO_DUO, startTime: Math.floor(since / 1000), start, count: 100 });
    ids.push(...page);
    if (page.length < 100) break;
  }
  log(`${ids.length} parties Solo/Duo depuis le ${new Date(since).toLocaleDateString("fr-FR")}.`);

  // 2. Détail des parties absentes du cache (+ chronologie pour celles sur Kayn).
  const cache: Cache = o.refresh ? { puuid: account.puuid, records: {} } : loadCache(dir, account.puuid);
  const todo = ids.filter((id) => cache.records[id]?.v !== RECORD_VERSION);
  if (todo.length)
    log(`${todo.length} partie(s) à télécharger : environ ${minutes(todo.length * 1.3)} min au maximum (limite de la clé : 100 requêtes / 2 min). Ctrl+C pour arrêter, la progression est gardée.`);
  let done = 0, kayn = 0;
  const onExit = () => { saveCache(dir, cache); process.exit(130); };
  process.once("SIGINT", onExit);
  try {
    for (const id of todo) {
      const m = await client.match<MatchDto>(id);
      let rec: CachedRecord;
      if (!m || m.info.queueId !== QUEUE_SOLO_DUO) rec = { v: RECORD_VERSION, id, kayn: false };
      else {
        rec = summarizeMatch(m, null, account.puuid);
        if (rec.kayn) {
          kayn++;
          rec = summarizeMatch(m, await client.timeline<TimelineDto>(id), account.puuid);
        }
      }
      cache.records[id] = rec;
      if (++done % 10 === 0 || done === todo.length) {
        saveCache(dir, cache);
        progress(`\r  ${done}/${todo.length} parties analysées, dont ${kayn} sur Kayn…`);
      }
    }
  } finally {
    process.removeListener("SIGINT", onExit);
    saveCache(dir, cache);
  }
  if (todo.length) progress("\n");

  // 3. Agrégats et rapport.
  const records = ids.map((id) => cache.records[id]).filter((r): r is GameRecord => !!r && r.kayn);
  if (!records.length) { log("Aucune partie sur Kayn sur cette période."); return null; }
  const report = aggregate(records, index, since);
  log("\n" + consoleSummary(report));
  const html = resolve(dir, "rapport.html");
  writeFileSync(html, renderHtml(report, index, ddVersion));
  writeFileSync(resolve(dir, "stats.json"), JSON.stringify(report, null, 2));
  log(`\nRapport : ${html}`);
  return html;
}

async function main() {
  const argv = process.argv.slice(2);
  const cfg = loadConfig();
  const html = await runStats({
    client: new RiotClient({ apiKey: cfg.apiKey, region: cfg.region, platform: cfg.platform }),
    gameName: cfg.gameName,
    tagLine: cfg.tagLine,
    since: parseSince(argv.find((a) => a.startsWith("--since="))?.split("=")[1]),
    refresh: argv.includes("--refresh"),
  });
  if (html && !argv.includes("--no-open") && existsSync(html)) openBrowser(pathToFileURL(html).href);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`❌ ${(e as Error).message}`); process.exit(1); });
}
