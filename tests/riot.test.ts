// Client Riot, limiteur de requêtes et npm run live, testés sans réseau.
// Toutes les données de partie sont inventées : aucune vraie partie n'est commitée.
import { describe, expect, it } from "vitest";
import { RateLimiter, type Clock } from "../scripts/riot/rate-limiter";
import { RiotApiError, RiotClient, type ActiveGame } from "../scripts/riot/client";
import { loadConfig, parseRiotId } from "../scripts/riot/config";
import { buildLiveDraft, draftUrl, loadChampions } from "../scripts/riot/live";
import { decodeDraft, encodeDraft } from "../src/engine/draft-link";

/** Horloge simulée : sleep avance le temps instantanément. */
function fakeClock(): Clock & { t: number; slept: number[] } {
  const c = {
    t: 0,
    slept: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => { c.slept.push(ms); c.t += ms; },
  };
  return c;
}

const FAKE_KEY = "RGAPI-00000000-0000-0000-0000-000000000000";

describe("limiteur de requêtes", () => {
  it("20 requêtes par seconde au plus", async () => {
    const clock = fakeClock();
    const rl = new RateLimiter([{ limit: 20, ms: 1000 }, { limit: 100, ms: 120_000 }], clock);
    const times: number[] = [];
    for (let i = 0; i < 45; i++) { await rl.acquire(); times.push(clock.t); }
    for (let i = 20; i < times.length; i++) expect(times[i] - times[i - 20]).toBeGreaterThanOrEqual(1000);
    expect(times.filter((t) => t < 1000)).toHaveLength(20);
  });

  it("100 requêtes par 2 minutes au plus", async () => {
    const clock = fakeClock();
    const rl = new RateLimiter([{ limit: 20, ms: 1000 }, { limit: 100, ms: 120_000 }], clock);
    const times: number[] = [];
    for (let i = 0; i < 230; i++) { await rl.acquire(); times.push(clock.t); }
    for (let i = 100; i < times.length; i++) expect(times[i] - times[i - 100]).toBeGreaterThanOrEqual(120_000);
    // Les deux limites à la fois : jamais plus de 20 dans une seconde quelconque.
    for (let i = 20; i < times.length; i++) expect(times[i] - times[i - 20]).toBeGreaterThanOrEqual(1000);
  });

  it("les limites par défaut ont une marge sur la durée des fenêtres", async () => {
    const clock = fakeClock();
    const rl = new RateLimiter(undefined, clock);
    for (let i = 0; i < 21; i++) await rl.acquire();
    expect(clock.t).toBeGreaterThanOrEqual(1000);
  });

  it("pause() bloque toutes les requêtes (429 + Retry-After)", async () => {
    const clock = fakeClock();
    const rl = new RateLimiter([{ limit: 20, ms: 1000 }], clock);
    rl.pause(5000);
    await rl.acquire();
    expect(clock.t).toBe(5000);
  });

  it("les appels simultanés sont servis dans l'ordre, sans dépasser la limite", async () => {
    const clock = fakeClock();
    const rl = new RateLimiter([{ limit: 2, ms: 1000 }], clock);
    const order: number[] = [];
    await Promise.all([0, 1, 2, 3, 4].map((i) => rl.acquire().then(() => order.push(i))));
    expect(order).toEqual([0, 1, 2, 3, 4]);
    expect(clock.t).toBe(2000);
  });
});

type Call = { url: string; headers: Record<string, string> };
function fakeFetch(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    const r = responses.shift();
    if (!r) throw new Error("plus de réponse simulée");
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("client Riot", () => {
  const client = (responses: (Response | Error)[]) => {
    const { f, calls } = fakeFetch(responses);
    const clock = fakeClock();
    const c = new RiotClient({ apiKey: FAKE_KEY, fetch: f, clock, limiter: new RateLimiter(undefined, clock) });
    return { c, calls, clock };
  };

  it("clé dans l'en-tête X-Riot-Token, jamais dans l'URL ; bons routages", async () => {
    const { c, calls } = client([json({ puuid: "p1", gameName: "Test Joueur", tagLine: "EUW" }), new Response(null, { status: 404 })]);
    expect(await c.account("Test Joueur", "EUW")).toEqual({ puuid: "p1", gameName: "Test Joueur", tagLine: "EUW" });
    expect(await c.activeGame("p1")).toBeNull();
    expect(calls[0].url).toBe("https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/Test%20Joueur/EUW");
    expect(calls[1].url).toBe("https://euw1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/p1");
    for (const call of calls) {
      expect(call.headers["X-Riot-Token"]).toBe(FAKE_KEY);
      expect(call.url).not.toContain("RGAPI");
    }
  });

  it("429 : attend la durée Retry-After puis réessaie", async () => {
    const { c, clock } = client([new Response(null, { status: 429, headers: { "retry-after": "7" } }), json(["EUW1_1"])]);
    expect(await c.matchIds("p1", { queue: 420, count: 100 })).toEqual(["EUW1_1"]);
    expect(clock.t).toBeGreaterThanOrEqual(7000);
  });

  it("erreur serveur : réessaie avec un délai croissant", async () => {
    const { c, calls } = client([new Response(null, { status: 503 }), new Response(null, { status: 502 }), json({ ok: 1 })]);
    expect(await c.match("EUW1_1")).toEqual({ ok: 1 });
    expect(calls).toHaveLength(3);
  });

  it("401/403 : message clair, sans la clé", async () => {
    const { c } = client([new Response(null, { status: 403 })]);
    const err = await c.account("A", "B").catch((e) => e);
    expect(err).toBeInstanceOf(RiotApiError);
    expect(err.status).toBe(403);
    expect(err.message).toContain("RIOT_API_KEY");
    expect(err.message).not.toContain(FAKE_KEY);
  });

  it("erreur réseau : le message ne contient jamais la clé", async () => {
    const { c } = client(Array.from({ length: 6 }, () => new Error(`échec avec ${FAKE_KEY}`)));
    const err = await c.activeGame("p1").catch((e) => e);
    expect(err.message).not.toContain(FAKE_KEY);
    expect(err.message).toContain("[clé masquée]");
  });

  it("paramètres de match-v5 dans l'URL", async () => {
    const { c, calls } = client([json([])]);
    await c.matchIds("p1", { queue: 420, startTime: 1767225600, start: 0, count: 100 });
    expect(calls[0].url).toBe("https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/p1/ids?queue=420&startTime=1767225600&start=0&count=100");
  });
});

describe("configuration (.env)", () => {
  it("Riot ID : nom (avec espaces) et tag", () => {
    expect(parseRiotId("Nom Avec Espaces#EUW")).toEqual(["Nom Avec Espaces", "EUW"]);
    expect(parseRiotId("SansTag")).toBeNull();
    expect(parseRiotId("#EUW")).toBeNull();
    expect(parseRiotId("Nom#")).toBeNull();
  });

  it("valeurs par défaut EUW et site publié", () => {
    const cfg = loadConfig({ RIOT_API_KEY: FAKE_KEY, RIOT_ID: "Test#EUW" });
    expect(cfg).toMatchObject({ gameName: "Test", tagLine: "EUW", region: "europe", platform: "euw1" });
    expect(cfg.siteUrl).toMatch(/^https:\/\/.+\/kayn-sim\/$/);
  });

  it("message clair si la configuration manque, sans afficher la clé", () => {
    expect(() => loadConfig({})).toThrow(/RIOT_API_KEY manquant.*RIOT_ID manquant/s);
    expect(() => loadConfig({ RIOT_API_KEY: FAKE_KEY })).toThrow(/RIOT_ID/);
    try { loadConfig({ RIOT_API_KEY: FAKE_KEY }); } catch (e) { expect((e as Error).message).not.toContain(FAKE_KEY); }
  });
});

describe("npm run live", () => {
  const champions = loadChampions();
  const id = (name: string) => [...champions.entries()].find(([, c]) => c.id === name)![0];
  /** Partie inventée : toi (Kayn) équipe 100, alliés et adversaires. */
  const game = (mine = "Kayn", queue = 420): ActiveGame => ({
    gameId: 1, gameMode: "CLASSIC", gameQueueConfigId: queue, gameLength: 95,
    participants: [
      ...["Ornn", mine, "Syndra", "Kaisa", "Nautilus"].map((c, i) => ({ puuid: i === 1 ? "moi" : `a${i}`, teamId: 100, championId: id(c) })),
      ...["Gnar", "Viego", "Ahri", "Jinx", "Lulu"].map((c, i) => ({ puuid: `e${i}`, teamId: 200, championId: id(c) })),
    ],
  });

  it("toi dans ton équipe, 4 alliés et 5 adversaires", () => {
    const d = buildLiveDraft(game(), "moi", champions);
    expect(d.me?.id).toBe("Kayn");
    expect(d.al).toEqual(["Ornn", "Syndra", "Kaisa", "Nautilus"]);
    expect(d.en).toEqual(["Gnar", "Viego", "Ahri", "Jinx", "Lulu"]);
    expect(d.warnings).toEqual([]);
  });

  it("équipe 200 : les rôles s'inversent", () => {
    const g = game();
    for (const p of g.participants) p.teamId = p.teamId === 100 ? 200 : 100;
    const d = buildLiveDraft(g, "moi", champions);
    expect(d.al).toEqual(["Ornn", "Syndra", "Kaisa", "Nautilus"]);
  });

  it("avertit si tu ne joues pas Kayn, ou hors Solo/Duo", () => {
    expect(buildLiveDraft(game("Zed"), "moi", champions).warnings.join(" ")).toMatch(/pas Kayn/);
    expect(buildLiveDraft(game("Kayn", 400), "moi", champions).warnings.join(" ")).toMatch(/pas une partie Solo\/Duo/);
  });

  it("champion inconnu (données pas à jour) : case vide + avertissement", () => {
    const g = game();
    g.participants[6].championId = 99999;
    const d = buildLiveDraft(g, "moi", champions);
    expect(d.en[1]).toBeNull();
    expect(d.warnings.join(" ")).toMatch(/npm run sync/);
  });

  it("erreur claire si tu n'es pas dans la partie", () => {
    expect(() => buildLiveDraft(game(), "quelqu'un d'autre", champions)).toThrow(/n'apparais pas/);
  });

  it("le lien ne contient que des identifiants de champions, dans le fragment", () => {
    const url = draftUrl("https://exemple.github.io/kayn-sim/", buildLiveDraft(game(), "moi", champions));
    expect(url).toBe("https://exemple.github.io/kayn-sim/#draft=en-Gnar.Viego.Ahri.Jinx.Lulu~al-Ornn.Syndra.Kaisa.Nautilus~src-live");
    expect(url).not.toMatch(/RGAPI|moi|puuid/);
    // Caractères sûrs pour la ligne de commande Windows (pas d'espace, &, ;, ", %, ^).
    expect(url).not.toMatch(/[\s&;"%^]/);
  });
});

describe("lien de draft", () => {
  it("aller-retour, cases vides comprises", () => {
    const d = { en: ["Ahri", null, "Zed", null, null], al: [null, "Ornn", null, null], src: "live" };
    expect(decodeDraft("#" + encodeDraft(d))).toEqual(d);
  });

  it("complète ou tronque à 5 adversaires et 4 alliés", () => {
    expect(encodeDraft({ en: ["Ahri"], al: ["A", "B", "C", "D", "E"] })).toBe("draft=en-Ahri....~al-A.B.C.D");
  });

  it("ignore les identifiants invalides et les fragments sans draft", () => {
    expect(decodeDraft("#draft=en-Ahri.<script>.Zed~al-")!.en).toEqual(["Ahri", null, "Zed", null, null]);
    expect(decodeDraft("#autre")).toBeNull();
    expect(decodeDraft("")).toBeNull();
  });
});
