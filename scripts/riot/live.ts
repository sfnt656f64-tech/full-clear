// npm run live : détecte ta partie en cours (spectator-v5) et ouvre le simulateur de draft
// pré-rempli avec les deux équipes, toi dans ton équipe.
//
//   npm run live                 une seule vérification
//   npm run live -- --watch      vérifie toutes les 30 s jusqu'à trouver une partie
//   npm run live -- --local      ouvre le serveur de développement (npm run dev) au lieu du site
//   npm run live -- --no-open    affiche seulement le lien
//
// La clé est lue dans .env et n'est envoyée qu'à l'API Riot : le lien ouvert ne contient
// que des identifiants de champions, dans le fragment (#…) que le navigateur n'envoie jamais au serveur.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodeDraft } from "../../src/engine/draft-link.ts";
import { QUEUE_SOLO_DUO, RiotClient, type ActiveGame } from "./client.ts";
import { LOCAL_SITE_URL, loadConfig } from "./config.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const KAYN_ID = "Kayn";

export interface ChampionRef { id: string; name: string }

/** Champions Data Dragon indexés par leur clé numérique (championId de l'API). */
export function loadChampions(file = resolve(ROOT, "src/data/generated/champions.json")): Map<number, ChampionRef> {
  const list = JSON.parse(readFileSync(file, "utf8")) as { id: string; key: number; name: string }[];
  return new Map(list.map((c) => [c.key, { id: c.id, name: c.name }]));
}

export interface LiveDraft {
  en: (string | null)[];
  al: (string | null)[];
  /** Ton champion dans la partie. */
  me: ChampionRef | null;
  warnings: string[];
}

/** Répartit les participants : alliés (hors toi) et adversaires. */
export function buildLiveDraft(game: ActiveGame, myPuuid: string, champions: Map<number, ChampionRef>): LiveDraft {
  const warnings: string[] = [];
  const me = game.participants.find((p) => p.puuid === myPuuid);
  if (!me) throw new Error("Tu n'apparais pas dans la partie renvoyée par l'API.");
  const ref = (championId: number) => {
    const c = champions.get(championId);
    if (!c) warnings.push(`Champion inconnu (id ${championId}) : relance npm run sync pour mettre les données à jour.`);
    return c ?? null;
  };
  const al = game.participants.filter((p) => p.teamId === me.teamId && p !== me).map((p) => ref(p.championId)?.id ?? null);
  const en = game.participants.filter((p) => p.teamId !== me.teamId).map((p) => ref(p.championId)?.id ?? null);
  const mine = ref(me.championId);
  if (mine && mine.id !== KAYN_ID) warnings.push(`Tu joues ${mine.name}, pas Kayn : le simulateur te considère quand même comme Kayn.`);
  if (game.gameQueueConfigId !== QUEUE_SOLO_DUO) warnings.push(`Ce n'est pas une partie Solo/Duo (file ${game.gameQueueConfigId}, mode ${game.gameMode}).`);
  if (en.length > 5 || al.length > 4) warnings.push("Équipes de plus de 5 joueurs : seuls les 5 premiers adversaires et 4 premiers alliés sont gardés.");
  return { en: en.slice(0, 5), al: al.slice(0, 4), me: mine, warnings };
}

export function draftUrl(siteUrl: string, d: LiveDraft): string {
  return `${siteUrl.replace(/#.*$/, "")}#${encodeDraft({ en: d.en, al: d.al, src: "live" })}`;
}

/** Ouvre une URL dans le navigateur par défaut (Windows, macOS, Linux). */
function openBrowser(url: string): void {
  // Windows : commande passée telle quelle (sinon cmd découpe ou échappe l'URL) ; l'URL ne contient ni espace ni guillemet.
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", `start "" "${url}"`]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true, windowsVerbatimArguments: process.platform === "win32" });
  child.on("error", () => console.log("Impossible d'ouvrir le navigateur : ouvre le lien ci-dessus à la main."));
  child.unref();
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const watch = args.has("--watch");
  const intervalArg = process.argv.find((a) => a.startsWith("--interval="));
  const interval = Math.max(15, Number(intervalArg?.split("=")[1] ?? 30)) * 1000;

  const cfg = loadConfig();
  const siteUrl = args.has("--local") ? LOCAL_SITE_URL : cfg.siteUrl;
  const client = new RiotClient({ apiKey: cfg.apiKey, region: cfg.region, platform: cfg.platform });
  const champions = loadChampions();

  const account = await client.account(cfg.gameName, cfg.tagLine);
  if (!account) throw new Error(`Compte ${cfg.gameName}#${cfg.tagLine} introuvable (routage ${cfg.region}). Vérifie RIOT_ID dans .env.`);
  console.log(`Compte : ${account.gameName}#${account.tagLine}`);

  for (;;) {
    const game = await client.activeGame(account.puuid);
    if (game) {
      const d = buildLiveDraft(game, account.puuid, champions);
      const name = (id: string | null) => (id ? [...champions.values()].find((c) => c.id === id)?.name ?? id : "?");
      console.log(`\nPartie en cours (${Math.max(0, Math.round(game.gameLength / 60))} min) :`);
      console.log(`  Ton équipe : ${d.me?.name ?? "?"} (toi), ${d.al.map(name).join(", ")}`);
      console.log(`  En face    : ${d.en.map(name).join(", ")}`);
      for (const w of d.warnings) console.log(`  ⚠️  ${w}`);
      const url = draftUrl(siteUrl, d);
      console.log(`\n${url}`);
      if (!args.has("--no-open")) openBrowser(url);
      return;
    }
    if (!watch) {
      console.log("Pas de partie en cours. Relance une fois l'écran de chargement affiché, ou utilise --watch.");
      process.exitCode = 1;
      return;
    }
    console.log(`Pas de partie en cours, nouvel essai dans ${interval / 1000} s… (Ctrl+C pour arrêter)`);
    await new Promise((ok) => setTimeout(ok, interval));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`❌ ${(e as Error).message}`); process.exit(1); });
}
