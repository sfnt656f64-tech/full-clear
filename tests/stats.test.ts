// npm run stats : lecture des parties, agrégats, rapport. Parties INVENTÉES uniquement.
import { describe, expect, it } from "vitest";
import itemIndexJson from "../src/data/generated/item-index.json";
import { champ } from "../src/data/champions";
import { ITEMS } from "../src/data/items";
import { EXAMPLE_DRAFTS } from "../src/data/guides";
import { aggregate, bootsBase, compareGame, completedItems, type ItemIndex } from "../scripts/riot/aggregate";
import { KAYN_CHAMPION_ID, purchaseOrder, summarizeMatch, type GameRecord, type MatchDto, type TimelineDto } from "../scripts/riot/matches";
import { consoleSummary, renderHtml } from "../scripts/riot/report";
import { parseSince, SEASON_START } from "../scripts/riot/stats";

const index = itemIndexJson as ItemIndex;
const id = (k: keyof typeof ITEMS) => Number(ITEMS[k].id);
const key = (name: string) => champ(name).key!;
const COMPONENT = 1036; // Long Sword : composant, ignoré
const CRIMSON_LUCIDITY = 3171, LUCIDITY = 3158;

/** Partie inventée : moi (« moi ») sur Kayn, équipe 100. */
function fakeMatch(o: { kayn?: boolean; transform?: number; win?: boolean; remake?: boolean; enemies?: string[]; allies?: string[]; items?: number[] } = {}): MatchDto {
  const allies = o.allies ?? ["Ornn", "Syndra", "Kaisa", "Nautilus"], enemies = o.enemies ?? ["Gnar", "Viego", "Ahri", "Jinx", "Lulu"];
  const items = [...(o.items ?? []), 0, 0, 0, 0, 0, 0];
  const p = (puuid: string, teamId: number, championId: number, extra = {}) => ({
    puuid, participantId: 0, teamId, championId, win: teamId === 100 ? !!o.win : !o.win,
    item0: 0, item1: 0, item2: 0, item3: 0, item4: 0, item5: 0, item6: 3340, ...extra,
  });
  const parts = [
    p("moi", 100, o.kayn === false ? key("Zed") : KAYN_CHAMPION_ID, {
      championTransform: o.transform ?? 0, gameEndedInEarlySurrender: !!o.remake,
      item0: items[0], item1: items[1], item2: items[2], item3: items[3], item4: items[4], item5: items[5],
    }),
    ...allies.map((c, i) => p(`a${i}`, 100, key(c))),
    ...enemies.map((c, i) => p(`e${i}`, 200, key(c))),
  ].map((x, i) => ({ ...x, participantId: i + 1 }));
  return { metadata: { matchId: "EUW1_TEST" }, info: { gameCreation: SEASON_START + 86_400_000, gameDuration: 1800, gameVersion: "16.22.123.4567", queueId: 420, participants: parts } };
}

const timeline = (events: TimelineDto["info"]["frames"][number]["events"]): TimelineDto => ({ info: { frames: [{ events }] } });
const buy = (itemId: number, participantId = 1) => ({ type: "ITEM_PURCHASED", participantId, itemId, timestamp: 0 });

describe("lecture d'une partie", () => {
  it("ordre d'achat : une annulation (ITEM_UNDO) retire l'achat, les autres joueurs sont ignorés", () => {
    const tl = timeline([buy(COMPONENT), buy(id("serylda"), 2), buy(id("voltaic")), { type: "ITEM_UNDO", participantId: 1, beforeId: id("voltaic"), timestamp: 0 }, buy(id("hubris")), buy(id("voltaic"))]);
    expect(purchaseOrder(tl, 1)).toEqual([COMPONENT, id("hubris"), id("voltaic")]);
  });

  it("partie sur un autre champion : ignorée", () => {
    expect(summarizeMatch(fakeMatch({ kayn: false }), null, "moi")).toEqual({ v: 1, id: "EUW1_TEST", kayn: false });
  });

  it("partie sur Kayn : forme, équipes, inventaire, patch", () => {
    const r = summarizeMatch(fakeMatch({ transform: 2, win: true, items: [id("voltaic"), id("hubris"), LUCIDITY] }), null, "moi") as GameRecord;
    expect(r).toMatchObject({ kayn: true, form: "blue", win: true, patch: "16.22", remake: false, purchases: null });
    expect(r.allies).toHaveLength(4);
    expect(r.enemies).toEqual(["Gnar", "Viego", "Ahri", "Jinx", "Lulu"].map(key));
    expect(r.finalItems).toEqual([id("voltaic"), id("hubris"), LUCIDITY]);
    expect((summarizeMatch(fakeMatch({ transform: 1 }), null, "moi") as GameRecord).form).toBe("red");
    expect((summarizeMatch(fakeMatch({ transform: 0 }), null, "moi") as GameRecord).form).toBe("none");
  });

  it("le résumé ne garde ni PUUID ni nom de joueur", () => {
    const r = JSON.stringify(summarizeMatch(fakeMatch(), timeline([]), "moi"));
    expect(r).not.toMatch(/"moi"|"a0"|"e0"|puuid/);
  });
});

describe("items terminés", () => {
  it("légendaires dans l'ordre, sans doublons ni composants ; bottes de niveau 3 ramenées au niveau 2", () => {
    const r = completedItems([COMPONENT, LUCIDITY, id("voltaic"), id("voltaic"), id("hubris"), CRIMSON_LUCIDITY, id("axiom")], index);
    expect(r).toEqual({ legendaries: [id("voltaic"), id("hubris"), id("axiom")], boots: LUCIDITY });
    expect(bootsBase(CRIMSON_LUCIDITY, index)).toBe(LUCIDITY);
  });
});

describe("comparaison avec le build recommandé", () => {
  const [en, al] = EXAMPLE_DRAFTS["Frontline lourde"];
  const rec = (purchases: number[], transform = 1, win = true) =>
    summarizeMatch(fakeMatch({ enemies: en, allies: al, transform, win }), timeline(purchases.map((x) => buy(x))), "moi") as GameRecord;

  it("même compo que l'exemple « Frontline lourde » : recommandé rouge, Cleaver › Voltaic › Serylda, Mercury's", () => {
    const c = compareGame(rec([id("cleaver"), id("mercury"), id("voltaic"), id("dd")]), index)!;
    expect(c.recommendedForm).toBe("red");
    expect(c.recommended.core).toEqual([id("cleaver"), id("voltaic"), id("serylda")]);
    expect(c.recommended.boots).toBe(id("mercury"));
    expect(c).toMatchObject({ firstMatch: true, coreOverlap: 2, followed: true, bootsMatch: true });
  });

  it("build différent : non suivi ; forme jouée différente de la recommandée", () => {
    const c = compareGame(rec([id("voltaic"), id("hubris"), id("axiom"), LUCIDITY], 2), index)!;
    expect(c.buildForm).toBe("blue");
    expect(c.recommendedForm).toBe("red");
    expect(c.followed).toBe(c.coreOverlap >= 2);
  });

  it("sans transformation : comparé au build de la forme recommandée", () => {
    expect(compareGame(rec([id("cleaver")], 0), index)!.buildForm).toBe("red");
  });
});

describe("agrégats", () => {
  const g = (o: Parameters<typeof fakeMatch>[0], purchases: number[]) => ({
    ...(summarizeMatch(fakeMatch(o), timeline(purchases.map((x) => buy(x))), "moi") as GameRecord),
    id: Math.random().toString(36),
  });
  const blueBuild = [id("voltaic"), id("hubris"), LUCIDITY];
  const records = [
    g({ transform: 2, win: true, items: blueBuild }, blueBuild),
    g({ transform: 2, win: false, items: blueBuild }, blueBuild),
    g({ transform: 1, win: true, items: [id("voltaic"), id("cleaver")] }, [id("voltaic"), id("cleaver")]),
    g({ transform: 2, win: true, remake: true, items: blueBuild }, blueBuild),
  ];
  const r = aggregate(records, index, SEASON_START);

  it("remakes exclus, win rate global et par forme", () => {
    expect(r.games).toBe(3);
    expect(r.remakes).toBe(1);
    expect(r.overall).toEqual({ n: 3, wins: 2 });
    expect(r.byForm).toEqual({ blue: { n: 2, wins: 1 }, red: { n: 1, wins: 1 }, none: { n: 0, wins: 0 } });
  });

  it("win rate par item de l'inventaire final, trié par nombre de parties", () => {
    expect(r.byItem[0]).toMatchObject({ id: id("voltaic"), name: "Voltaic Cyclosword", w: { n: 3, wins: 2 } });
    expect(r.byItem.find((i) => i.id === LUCIDITY)!.w).toEqual({ n: 2, wins: 1 });
    expect(r.byFirstItem[0]).toMatchObject({ id: id("voltaic"), w: { n: 3, wins: 2 } });
  });

  it("chaque partie est comparée au build recommandé", () => {
    expect(r.comparison.compared).toBe(3);
    const c = r.comparison;
    expect(c.followed.n + c.notFollowed.n).toBe(3);
    expect(c.firstMatched.n + c.firstDiffered.n).toBe(3);
  });

  it("rapport HTML et console : pas de PUUID, texte échappé, mention légale", () => {
    const html = renderHtml(r, index, "16.23.1");
    expect(html).not.toMatch(/"moi"|puuid/i);
    expect(html).toContain("Shadow Assassin");
    expect(html).toContain("isn't endorsed by Riot Games");
    expect(consoleSummary(r)).toMatch(/Win rate global\s+66,7 %\s+\(2\/3\)/);
  });
});

describe("période", () => {
  it("saison en cours par défaut : 8 janvier 2026 (patch 26.01)", () => {
    expect(new Date(parseSince(undefined)).toISOString()).toBe("2026-01-08T00:00:00.000Z");
    expect(new Date(parseSince("2026-06-01")).toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(() => parseSince("01/06/2026")).toThrow(/AAAA-MM-JJ/);
  });
});

describe("npm run stats de bout en bout (fausse API Riot)", async () => {
  const { mkdtempSync, readFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { RiotClient } = await import("../scripts/riot/client");
  const { RateLimiter } = await import("../scripts/riot/rate-limiter");
  const { runStats } = await import("../scripts/riot/stats");

  /** 120 parties Solo/Duo inventées, 1 sur 4 sur Kayn. */
  const ids = Array.from({ length: 120 }, (_, i) => `EUW1_${1000 + i}`);
  function fakeApi() {
    const hits: string[] = [];
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    const f = (async (url: string) => {
      const u = new URL(url);
      hits.push(u.pathname);
      if (u.pathname.includes("/accounts/by-riot-id/")) return json({ puuid: "moi", gameName: "Test", tagLine: "EUW" });
      if (u.pathname.endsWith("/ids")) {
        const start = Number(u.searchParams.get("start")), count = Number(u.searchParams.get("count"));
        expect(u.searchParams.get("queue")).toBe("420");
        return json(ids.slice(start, start + count));
      }
      const m = u.pathname.match(/matches\/(EUW1_\d+)(\/timeline)?$/);
      if (m) {
        const n = Number(m[1].slice(5));
        if (m[2]) return json(timeline([buy(id("voltaic")), buy(id("hubris")), buy(LUCIDITY)]));
        const match = fakeMatch({ kayn: n % 4 === 0, transform: 2, win: n % 8 === 0, items: [id("voltaic"), id("hubris"), LUCIDITY] });
        match.metadata.matchId = m[1];
        return json(match);
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;
    return { f, hits };
  }
  const clock = { t: 0, now: () => clock.t, sleep: async (ms: number) => { clock.t += ms; } };
  const dir = mkdtempSync(join(tmpdir(), "kayn-stats-"));
  const run = (api: ReturnType<typeof fakeApi>) => runStats({
    client: new RiotClient({ apiKey: "RGAPI-00000000-0000-0000-0000-000000000000", fetch: api.f, clock, limiter: new RateLimiter(undefined, clock) }),
    gameName: "Test", tagLine: "EUW", since: SEASON_START, cacheDir: dir, log: () => {}, progress: () => {},
  });

  it("1er lancement : 2 pages d'identifiants, 120 parties, 30 chronologies ; rapport écrit", async () => {
    const api = fakeApi();
    const html = await run(api);
    expect(api.hits.filter((h) => h.endsWith("/ids"))).toHaveLength(2);
    expect(api.hits.filter((h) => /matches\/EUW1_\d+$/.test(h))).toHaveLength(120);
    expect(api.hits.filter((h) => h.endsWith("/timeline"))).toHaveLength(30);
    // 153 requêtes au total : la limite de 100 / 2 min impose au moins 2 minutes (horloge simulée).
    expect(clock.t).toBeGreaterThanOrEqual(120_000);
    expect(html && existsSync(html)).toBe(true);
    const page = readFileSync(html!, "utf8");
    expect(page).toContain("30 parties");
    expect(page).not.toContain('"moi"');
    const stats = JSON.parse(readFileSync(join(dir, "stats.json"), "utf8"));
    expect(stats.games).toBe(30);
    expect(stats.overall).toEqual({ n: 30, wins: 15 });
  });

  it("2e lancement : tout vient du cache (3 requêtes seulement)", async () => {
    const api = fakeApi();
    await run(api);
    expect(api.hits).toHaveLength(3);
  });
});
