// API en jeu « Live Client Data » (https://127.0.0.1:2999), ouverte par le jeu pendant une partie.
// Elle ne donne que ce que le joueur voit déjà : son or, et le tableau des scores (champions, items).
//
// Confidentialité : /playerlist contient le Riot ID de chaque joueur. Il sert uniquement, dans
// toLiveSnapshot(), à te reconnaître (comparaison avec ton propre Riot ID), puis il est jeté :
// le résultat ne contient que des champions et des numéros d'items.
import { findChamp } from "../src/data/champions";
import { localGet } from "./lcu.ts";

export const LIVE_PORT = 2999;

export interface LiveSnapshot {
  gold: number;
  level: number;
  /** Identifiant Data Dragon de ton champion (ex. "Kayn"), ou null s'il n'est pas reconnu. */
  me: { champion: string | null; items: number[] };
  allies: (string | null)[];
  enemies: { champion: string | null; items: number[] }[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** « game_character_displayname_MonkeyKing » → « MonkeyKing », sinon le nom affiché (localisé). */
export function championOf(p: Obj): string | null {
  const raw = typeof p.rawChampionName === "string" ? p.rawChampionName.match(/displayname_([A-Za-z0-9]+)$/)?.[1] : undefined;
  const byRaw = raw ? findChamp(raw) : undefined;
  if (byRaw?.id) return byRaw.id;
  const byName = typeof p.championName === "string" ? findChamp(p.championName) : undefined;
  return byName?.id ?? null;
}

/** Items de l'inventaire (un identifiant par exemplaire), hors objets sans numéro. */
export function itemsOf(p: Obj): number[] {
  const out: number[] = [];
  for (const it of Array.isArray(p.items) ? p.items : []) {
    if (!isObj(it)) continue;
    const id = num(it.itemID);
    const n = Math.min(10, Math.max(1, Math.trunc(num(it.count)) || 1));
    if (id) for (let i = 0; i < n; i++) out.push(Math.trunc(id));
  }
  return out;
}

const idOf = (p: Obj): string[] =>
  [p.riotId, p.summonerName, typeof p.riotIdGameName === "string" && typeof p.riotIdTagLine === "string" ? `${p.riotIdGameName}#${p.riotIdTagLine}` : null]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .map((s) => s.toLocaleLowerCase());

export function toLiveSnapshot(active: unknown, players: unknown): LiveSnapshot | null {
  if (!isObj(active) || !Array.isArray(players)) return null;
  const list = players.filter(isObj);
  const mine = new Set(idOf(active));
  const me = list.find((p) => idOf(p).some((id) => mine.has(id)));
  if (!me) return null; // spectateur, ou API pas encore prête
  const team = me.team;
  return {
    gold: Math.floor(num(active.currentGold)),
    level: Math.trunc(num(active.level)),
    me: { champion: championOf(me), items: itemsOf(me) },
    allies: list.filter((p) => p !== me && p.team === team).map(championOf),
    enemies: list.filter((p) => p.team !== team).map((p) => ({ champion: championOf(p), items: itemsOf(p) })),
  };
}

const IN_GAME_INTERVAL = 1000;
const IDLE_INTERVAL = 3000;

/** Interroge le port 2999 : toutes les secondes en partie, toutes les 3 s sinon (connexion refusée, quasi gratuit). */
export class LiveWatcher {
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private inGame = false;
  private readonly onSnapshot: (s: LiveSnapshot | null) => void;

  constructor(onSnapshot: (s: LiveSnapshot | null) => void) { this.onSnapshot = onSnapshot; }

  start(): void { if (this.stopped) { this.stopped = false; void this.loop(); } }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async loop(): Promise<void> {
    if (this.stopped) return;
    let snap: LiveSnapshot | null = null;
    try {
      const [active, players] = await Promise.all([
        localGet(LIVE_PORT, "/liveclientdata/activeplayer", {}, 1500),
        localGet(LIVE_PORT, "/liveclientdata/playerlist", {}, 1500),
      ]);
      snap = toLiveSnapshot(active, players);
    } catch { /* pas de partie en cours */ }
    if (snap || this.inGame) this.onSnapshot(snap);
    this.inGame = !!snap;
    if (!this.stopped) this.timer = setTimeout(() => void this.loop(), snap ? IN_GAME_INTERVAL : IDLE_INTERVAL);
  }
}
