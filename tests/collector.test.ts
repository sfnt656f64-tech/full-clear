import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Collector, type CollectorStatus } from "../desktop/collector/collector";
import { accountKey, HANDLERS, historyKey, idsKey, masteryKey, matchKey, scheduleAccounts } from "../desktop/collector/jobs";
import { readMyMastery } from "../desktop/stats/read";
import { at15, patchOf, summarizeMyGame, type MatchV5, type TimelineV5 } from "../desktop/collector/my-games";
import { KeyRefusedError, PRIORITY, RiotScheduler } from "../desktop/collector/scheduler";
import { CollectorStore } from "../desktop/collector/store";

const dirs: string[] = [];
const tmpDb = () => {
  const d = mkdtempSync(join(tmpdir(), "kayn-col-"));
  dirs.push(d);
  return join(d, "riot.db");
};
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* base encore ouverte après un échec : dossier temporaire laissé */ }
  }
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Fenêtres minuscules pour des tests rapides. */
const FAST = [{ limit: 1000, ms: 1000 }];

// ---------- Planificateur ----------

describe("planificateur de requêtes", () => {
  it("sert les priorités dans l'ordre et sépare les quotas par routage", async () => {
    const api = new RiotScheduler({ apiKey: "k", windows: [{ limit: 1, ms: 60 }] });
    const order: string[] = [];
    // Le 1er passe tout de suite ; ensuite, la méta (arrivée avant) doit attendre derrière « mes parties ».
    await api.acquire("europe", PRIORITY.meta);
    const a = api.acquire("europe", PRIORITY.meta).then(() => order.push("meta"));
    const b = api.acquire("europe", PRIORITY.mine).then(() => order.push("mine"));
    // euw1 a son propre quota : pas d'attente.
    const t = Date.now();
    await api.acquire("euw1", PRIORITY.meta);
    expect(Date.now() - t).toBeLessThan(40);
    await Promise.all([a, b]);
    expect(order).toEqual(["mine", "meta"]);
    expect(api.usage()).toEqual({ europe: 3, euw1: 1 });
  });

  it("met les requêtes en attente pendant une pause", async () => {
    const api = new RiotScheduler({ apiKey: "k", windows: FAST });
    api.pause("game");
    let served = false;
    const p = api.acquire("europe", 0).then(() => { served = true; });
    await new Promise((ok) => setTimeout(ok, 30));
    expect(served).toBe(false);
    api.resume("game");
    await p;
    expect(served).toBe(true);
  });

  it("respecte Retry-After sur un 429, et n'écrit jamais la clé dans une erreur", async () => {
    let calls = 0;
    const seen: string[] = [];
    const api = new RiotScheduler({
      apiKey: "RGAPI-secret", windows: FAST,
      fetch: (async (url: string, init: RequestInit) => {
        calls++;
        seen.push((init.headers as Record<string, string>)["X-Riot-Token"]);
        expect(url).not.toContain("RGAPI");
        return calls === 1 ? json({}, 429, { "retry-after": "0.05" }) : json({ ok: 1 });
      }) as typeof fetch,
    });
    expect(await api.get("europe", "/x", 0)).toEqual({ ok: 1 });
    expect(calls).toBe(2);
    expect(seen.every((h) => h === "RGAPI-secret")).toBe(true);

    const bad = new RiotScheduler({ apiKey: "RGAPI-secret", windows: FAST, maxRetries: 0, fetch: (async () => json({}, 500)) as typeof fetch });
    await expect(bad.get("europe", "/boom?k=RGAPI-secret", 0)).rejects.toThrow(/HTTP 500/);
    await expect(bad.get("europe", "/boom?k=RGAPI-secret", 0)).rejects.not.toThrow(/RGAPI-secret/);
  });

  it("s'arrête sur une clé refusée", async () => {
    let refused = 0;
    const api = new RiotScheduler({ apiKey: "k", windows: FAST, onKeyRefused: () => refused++, fetch: (async () => json({}, 403)) as typeof fetch });
    await expect(api.get("europe", "/x", 0)).rejects.toBeInstanceOf(KeyRefusedError);
    expect(refused).toBe(1);
    expect(api.pauseReasons).toEqual(["key"]);
  });
});

// ---------- Base ----------

describe("base de collecte", () => {
  it("dédoublonne les travaux, sert le plus prioritaire, et reprend après fermeture", () => {
    const file = tmpDb();
    let s = new CollectorStore(file);
    expect(s.enqueue("myMatch", "m1", 1, { id: 1 })).toBe(true);
    expect(s.enqueue("myMatch", "m1", 1, { id: 1 })).toBe(false);
    s.enqueue("account", "a1", 0, { r: "x" });
    const first = s.claimNext()!;
    expect(first.key).toBe("a1");
    // Fermeture brutale pendant le travail : il doit revenir en attente.
    s.close();
    s = new CollectorStore(file);
    expect(s.counts()).toEqual({ account: { pending: 1 }, myMatch: { pending: 1 } });
    s.close();
  });

  it("réessaie plus tard après un échec, puis abandonne", () => {
    let now = 1_000;
    const s = new CollectorStore(tmpDb(), () => now);
    s.enqueue("myMatch", "m1", 0, {});
    let j = s.claimNext()!;
    s.failed(j, "oups", 2, 100);
    expect(s.claimNext()).toBeNull(); // pas avant 100 ms
    now += 100;
    j = s.claimNext()!;
    expect(j.attempts).toBe(1);
    s.failed(j, "oups", 2, 100);
    expect(s.counts().myMatch).toEqual({ failed: 1 });
    expect(s.requeue("m1")).toBe(true);
    expect(s.claimNext()?.attempts).toBe(0);
    s.close();
  });
});

// ---------- Résumé d'une partie ----------

const ME = "puuid-me";
function match(id: string, over: Partial<MatchV5["info"]["participants"][number]> = {}, durationS = 1800): MatchV5 {
  const base = {
    participantId: 1, championId: 141, teamPosition: "JUNGLE", win: true, kills: 8, deaths: 2, assists: 6,
    totalMinionsKilled: 40, neutralMinionsKilled: 150, visionScore: 31, totalDamageDealtToChampions: 15000,
    item0: 6699, item1: 6697, item2: 0, item3: 3158, item4: 0, item5: 0, item6: 3364,
    perks: { statPerks: { offense: 5008, flex: 5008, defense: 5011 }, styles: [{ style: 8100, selections: [{ perk: 8128 }, { perk: 8143 }] }, { style: 8300, selections: [{ perk: 8347 }] }] },
  };
  return {
    metadata: { matchId: id },
    info: {
      gameCreation: 1, gameStartTimestamp: 2, gameDuration: durationS, gameVersion: "16.23.734.1", queueId: 420,
      participants: [
        { ...base, puuid: ME, teamId: 100, ...over },
        { ...base, puuid: "autre", participantId: 2, teamId: 200, championId: 1 },
        { ...base, puuid: "allie", participantId: 3, teamId: 100, championId: 2, kills: 4 },
      ],
    },
  };
}
/** Avant 15 min : 1 kill à moi, 1 kill d'un allié avec mon assist, 1 kill allié sans moi, 1 kill ennemi ; après 15 min : 1 kill à moi. */
const KILLS = [
  { type: "CHAMPION_KILL", timestamp: 4 * 60_000, killerId: 1, victimId: 2 },
  { type: "CHAMPION_KILL", timestamp: 6 * 60_000, killerId: 3, victimId: 2, assistingParticipantIds: [1] },
  { type: "CHAMPION_KILL", timestamp: 8 * 60_000, killerId: 3, victimId: 2 },
  { type: "CHAMPION_KILL", timestamp: 9 * 60_000, killerId: 2, victimId: 1 },
  { type: "WARD_PLACED", timestamp: 9 * 60_000 },
  { type: "CHAMPION_KILL", timestamp: 16 * 60_000, killerId: 1, victimId: 2 },
];
const timeline: TimelineV5 = { info: { frames: [0, 1, 15].map((m) => ({
  timestamp: m * 60_000 + 25,
  participantFrames: { 1: { totalGold: 5000 + m, minionsKilled: 10, jungleMinionsKilled: 80 }, 2: { totalGold: 1, minionsKilled: 1, jungleMinionsKilled: 1 } },
  events: m === 1 ? KILLS : [],
})) } };

describe("résumé de mes parties", () => {
  it("garde mes stats, l'or et les CS à 15 min, les items et les runes", () => {
    const g = summarizeMyGame(match("EUW1_1"), timeline, ME, "Moi#EUW")!;
    expect(g).toEqual({
      matchId: "EUW1_1", account: "Moi#EUW", startMs: 2, durationS: 1800, patch: "16.23", season: 2026, championId: 141, role: "JUNGLE",
      win: true, remake: false, kills: 8, deaths: 2, assists: 6, cs: 190, vision: 31, gold15: 5015, cs15: 90,
      teamKills: 12, kills15: 1, assists15: 1, teamKills15: 3,
      damage: 15000, teamDamage: 30000, // toi et ton allié (équipe 100)
      cs10: null, objTeam: 0, objMine: 0, events: [], // événements sans position dans ce jeu d'essai
      items: [6699, 6697, 3158],
      perks: { primary: 8100, sub: 8300, selections: [8128, 8143, 8347], shards: [5008, 5008, 5011] },
    });
    expect(JSON.stringify(g)).not.toContain("autre");
  });

  it("pas d'or à 15 min pour une partie courte ou sans chronologie", () => {
    expect(summarizeMyGame(match("x", {}, 14 * 60), timeline, ME, "a")).toMatchObject({ gold15: null, cs15: null });
    expect(at15(null, 1)).toEqual({ gold15: null, cs15: null });
    expect(summarizeMyGame(match("x", { gameEndedInEarlySurrender: true }), timeline, ME, "a")?.remake).toBe(true);
    expect(summarizeMyGame(match("x"), timeline, "inconnu", "a")).toBeNull();
    expect(patchOf("16.3.1")).toBe("16.3");
  });
});

// ---------- Enchaînement complet ----------

/** Faux serveur Riot : un compte, 150 parties (2 pages), dont une ARAM. */
function fakeRiot(onMatch: (n: number) => void = () => {}) {
  const ids = Array.from({ length: 150 }, (_, i) => `EUW1_${1000 - i}`);
  const calls: string[] = [];
  let matches = 0;
  const f = (async (url: string) => {
    const u = new URL(url);
    calls.push(u.pathname);
    if (/matches\/EUW1_\d+$/.test(u.pathname)) onMatch(++matches);
    if (u.pathname.startsWith("/riot/account/v1/accounts/by-riot-id/Moi/EUW")) return json({ puuid: ME });
    if (u.pathname.endsWith("/ids")) {
      const start = Number(u.searchParams.get("start"));
      // Solo/Duo (queue=420) : sans l'ARAM, comme l'API ; tous les modes (sans filtre) : avec.
      const q = u.searchParams.get("queue");
      expect([null, "420"]).toContain(q);
      const list = q === "420" ? ids.filter((id) => id !== "EUW1_999") : ids;
      return json(list.slice(start, start + Number(u.searchParams.get("count"))));
    }
    const m = u.pathname.match(/matches\/([^/]+)(\/timeline)?$/);
    if (m) {
      if (m[2]) return json(timeline);
      const mm = match(m[1]);
      if (m[1] === "EUW1_999") mm.info.queueId = 450;
      return json(mm);
    }
    return json({}, 404);
  }) as typeof fetch;
  return { f, calls };
}

async function until(cond: () => boolean, ms = 5000) {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error("délai dépassé");
    await new Promise((ok) => setTimeout(ok, 5));
  }
}

describe("collecte de mes parties", () => {
  it("résout le compte, parcourt les pages et enregistre chaque partie (Solo/Duo seulement)", async () => {
    const store = new CollectorStore(tmpDb());
    const { f, calls } = fakeRiot();
    const api = new RiotScheduler({ apiKey: "k", windows: FAST, fetch: f });
    let last: CollectorStatus | null = null;
    const col = new Collector({ store, api, onStatus: (s) => { last = s; }, sleep: () => new Promise((ok) => setTimeout(ok, 5)) });
    col.configure(["Moi#EUW"]);
    col.start();
    await until(() => (store.gameCounts()["Moi#EUW"] ?? 0) === 149);
    col.stop();
    expect(store.get(accountKey("Moi#EUW"))).toBe(ME);
    // 2 pages pour la saison, 2 pour l'historique, puis tous les modes (dont les parties, déjà connues, ne sont pas
    // redemandées).
    await until(() => (store.db.prepare("select count(*) n from my_other_games").get() as { n: number }).n === 1);
    col.stop();
    expect(calls.filter((c) => c.endsWith("/ids")).length).toBeGreaterThanOrEqual(5);
    // L'ARAM (hors Solo/Duo) est gardée comme expérience : champion, mode, victoire, sans chronologie.
    expect(store.db.prepare("select match_id, queue from my_other_games").all()).toEqual([{ match_id: "EUW1_999", queue: 450 }]);
    expect(calls.filter((c) => c.endsWith("/timeline"))).toHaveLength(149); // pas de chronologie pour l'ARAM
    expect(last!.myGames).toEqual({ "Moi#EUW": 149 });
    expect(last!.jobs.find((j) => j.kind === "myMatch")).toMatchObject({ done: 149, failed: 0 });
    store.close();
  });

  it("reprend là où elle s'était arrêtée, sans retélécharger", async () => {
    const file = tmpDb();
    // 1ʳᵉ session : interrompue net après 40 parties demandées (comme une fermeture de l'appli).
    let api: RiotScheduler;
    const { f, calls } = fakeRiot((n) => { if (n === 40) api.pause("fermeture"); });
    let store = new CollectorStore(file);
    api = new RiotScheduler({ apiKey: "k", windows: FAST, fetch: f });
    let col = new Collector({ store, api, sleep: () => new Promise((ok) => setTimeout(ok, 5)) });
    col.configure(["Moi#EUW"]);
    col.start();
    await until(() => (store.gameCounts()["Moi#EUW"] ?? 0) >= 37);
    col.stop();
    await new Promise((ok) => setTimeout(ok, 30));
    store.close();
    const before = calls.filter((c) => /matches\/EUW1_\d+$/.test(c)).length;
    // Interrompue à la 40ᵉ lecture ; jusqu'à 2 lectures déjà parties (3 travaux en parallèle) se terminent quand même.
    expect(before).toBeGreaterThanOrEqual(40);
    expect(before).toBeLessThanOrEqual(42);

    store = new CollectorStore(file);
    api = new RiotScheduler({ apiKey: "k", windows: FAST, fetch: f });
    col = new Collector({ store, api, sleep: () => new Promise((ok) => setTimeout(ok, 5)) });
    col.configure(["Moi#EUW"]);
    col.start();
    await until(() => (store.gameCounts()["Moi#EUW"] ?? 0) === 149);
    col.stop();
    const total = calls.filter((c) => /matches\/EUW1_\d+$/.test(c)).length;
    // Chaque partie téléchargée une fois, à 3 près (travaux interrompus en cours, refaits).
    expect(total).toBeLessThanOrEqual(150 + 3);
    expect(total).toBeGreaterThan(before);
    // Le compte déjà résolu n'est pas redemandé.
    expect(calls.filter((c) => c.includes("by-riot-id"))).toHaveLength(1);
    store.close();
  });

  it("ne relance la recherche de nouvelles parties qu'après le délai de rafraîchissement", () => {
    let now = 0;
    const store = new CollectorStore(tmpDb(), () => now);
    const api = new RiotScheduler({ apiKey: "k", windows: FAST });
    const ctx = { store, api, now: () => now, pool: () => new Set<number>() };
    store.set(accountKey("Moi#EUW"), ME);
    scheduleAccounts(ctx, ["Moi#EUW"]);
    // La saison d'abord, puis la maîtrise, puis l'historique (une seule fois).
    const j = store.claimNext()!;
    expect(j.key).toBe(idsKey(ME, 0));
    store.done(j.id);
    // Maîtrise : une fois par jour, même priorité que tes parties de la saison.
    const m = store.claimNext()!;
    expect(m.key).toBe(masteryKey("Moi#EUW", now));
    store.done(m.id);
    const h = store.claimNext()!;
    expect(h.key).toBe(historyKey(ME, 0));
    store.done(h.id);
    // Tous les modes : seulement à la fin de l'historique classé (lancé par la dernière page de l'historique).
    now += 60_000;
    scheduleAccounts(ctx, ["Moi#EUW"]);
    expect(store.claimNext()).toBeNull();
    now += 20 * 60_000;
    scheduleAccounts(ctx, ["Moi#EUW"]);
    expect(store.claimNext()?.key).toBe(idsKey(ME, 0));
    now += 86_400_000;
    scheduleAccounts(ctx, ["Moi#EUW"]);
    expect(store.claimNext()?.key).toBe(masteryKey("Moi#EUW", now));
    store.close();
  });

  it("liste « tous modes » : ne relit jamais une partie classée, même encore en file (quel que soit l'ordre)", async () => {
    const store = new CollectorStore(tmpDb());
    // EUW1_2 : partie classée en file, pas encore lue ; EUW1_1 : déjà enregistrée comme autre mode.
    store.enqueue("myOldMatch", matchKey("EUW1_2", ME), 1, {});
    store.putOtherGame({ matchId: "EUW1_1", account: "Moi#EUW", startMs: 1, queue: 450, championId: 141, role: "", win: true, remake: false });
    const api = { get: async () => ["EUW1_1", "EUW1_2", "EUW1_3"] };
    await HANDLERS.myAllIds({ store, api, now: () => 0, pool: () => new Set<number>() } as never, { puuid: ME, riotId: "Moi#EUW", start: 0 } as never);
    const queued = (store.db.prepare("select key from jobs where kind = 'myOther'").all() as { key: string }[]).map((j) => j.key);
    expect(queued).toEqual([`myOther:EUW1_3:${ME}`]);
    store.close();
  });

  it("enregistre ma maîtrise de champion (points par compte)", async () => {
    const file = tmpDb();
    const store = new CollectorStore(file);
    const f = (async (url: string) => {
      expect(new URL(url).pathname).toBe(`/lol/champion-mastery/v4/champion-masteries/by-puuid/${ME}`);
      return json([{ championId: 141, championPoints: 250_000, championLevel: 30, lastPlayTime: 5 }, { championId: 233, championPoints: 40_000, championLevel: 9, lastPlayTime: 4 }]);
    }) as typeof fetch;
    const api = new RiotScheduler({ apiKey: "k", windows: FAST, fetch: f });
    await HANDLERS.myMastery({ store, api, now: () => 0, pool: () => new Set<number>() }, { puuid: ME, riotId: "Moi#EUW" } as never);
    store.putMyMastery("Autre#EUW", [{ championId: 141, points: 10_000, level: 3, lastPlayMs: 1 }]);
    store.close();
    expect(readMyMastery(file)).toEqual(new Map([[141, 260_000], [233, 40_000]]));
  });

  it("met le travail de côté et s'arrête sur une clé refusée", async () => {
    const store = new CollectorStore(tmpDb());
    const api = new RiotScheduler({ apiKey: "k", windows: FAST, fetch: (async () => json({}, 401)) as typeof fetch });
    let last: CollectorStatus | null = null;
    const col = new Collector({ store, api, onStatus: (s) => { last = s; }, sleep: () => new Promise((ok) => setTimeout(ok, 5)) });
    col.configure(["Moi#EUW"]);
    col.start();
    await until(() => last?.state === "key-refused");
    col.stop();
    expect(store.counts().account).toEqual({ pending: 1 });
    expect(last!.lastError).toMatch(/Clé API refusée/);
    store.close();
  });
});

describe("anciennes saisons", () => {
  it("parcourt tout l'historique après la saison, et enregistre la saison de chaque partie", async () => {
    const season = Array.from({ length: 30 }, (_, i) => `EUW1_${900 - i}`);
    const old = Array.from({ length: 120 }, (_, i) => `EUW1_${500 - i}`);
    const order: string[] = [];
    const f = (async (url: string) => {
      const u = new URL(url);
      if (u.pathname.includes("by-riot-id")) return json({ puuid: ME });
      if (u.pathname.endsWith("/ids")) {
        // Avec startTime : la saison en cours. Sans : tout l'historique (saison comprise).
        const list = u.searchParams.has("startTime") ? season : [...season, ...old];
        const start = Number(u.searchParams.get("start"));
        return json(list.slice(start, start + 100));
      }
      const m = u.pathname.match(/matches\/([^/]+)(\/timeline)?$/);
      if (m?.[2]) return json(timeline);
      if (m) {
        order.push(m[1]);
        const mm = match(m[1]);
        if (Number(m[1].slice(5)) <= 500) mm.info.gameVersion = "15.20.1.1";
        return json(mm);
      }
      return json({}, 404);
    }) as typeof fetch;
    const store = new CollectorStore(tmpDb());
    const api = new RiotScheduler({ apiKey: "k", windows: FAST, fetch: f });
    let last: CollectorStatus | null = null;
    const col = new Collector({ store, api, onStatus: (s) => { last = s; }, sleep: () => new Promise((ok) => setTimeout(ok, 5)) });
    col.configure(["Moi#EUW"]);
    col.start();
    await until(() => (store.gameCounts()["Moi#EUW"] ?? 0) === 150);
    col.stop();
    // Chaque partie une seule fois, et toutes celles de la saison avant les anciennes.
    // Classées : 150 ; la liste « tous modes » passe après, à 3 travaux près en parallèle (au plus 3 relectures).
    expect(order.length).toBeGreaterThanOrEqual(150);
    expect(order.length).toBeLessThanOrEqual(150 + 3);
    const firstOld = order.findIndex((id) => Number(id.slice(5)) <= 500);
    expect(order.slice(0, firstOld).every((id) => season.includes(id))).toBe(true);
    expect(firstOld).toBeGreaterThanOrEqual(season.length - 3); // 3 travaux en parallèle
    const bySeason = store.db.prepare("select season, count(*) n from my_games group by season order by season").all();
    expect(bySeason).toEqual([{ season: 2025, n: 120 }, { season: 2026, n: 30 }]);
    expect(last!.jobs.find((j) => j.kind === "myOldMatch")).toMatchObject({ done: 120 });
    store.close();
  });
});

describe("parties standard hors Solo/Duo sans détail", () => {
  it("une flexible déjà listée sans détail est relue une fois, avec sa chronologie", async () => {
    const store = new CollectorStore(tmpDb());
    store.set(accountKey("Moi#EUW"), ME);
    store.putOtherGame({ matchId: "EUW1_7", account: "Moi#EUW", startMs: 1, queue: 440, championId: 141, role: "JUNGLE", win: true, remake: false });
    store.putOtherGame({ matchId: "EUW1_8", account: "Moi#EUW", startMs: 1, queue: 450, championId: 141, role: "", win: true, remake: false });
    scheduleAccounts({ store, api: new RiotScheduler({ apiKey: "k", windows: FAST }), now: () => 0, pool: () => new Set<number>() }, ["Moi#EUW"]);
    const keys = (store.db.prepare("select key from jobs where kind = 'myOther'").all() as { key: string }[]).map((j) => j.key);
    expect(keys).toEqual([`myOtherDetail:EUW1_7:${ME}`]); // pas l'ARAM
    store.close();
  });
});
